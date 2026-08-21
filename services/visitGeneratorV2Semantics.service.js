const { effectiveAffinity } = require("./learningV2.service");
const {
  id,
  canonicalKey,
  resolveFeatureToSubjectIds,
  neighbors,
  shortestSemanticPath,
} = require("./federatedSemanticGraphV2.service");

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function normalizedPosition(definitions, definitionId) {
  const values = definitions || [];
  if (!values.length) return 0.5;
  const index = values.findIndex((entry) => String(entry.definitionId) === String(definitionId));
  if (index < 0) return null;
  return values.length === 1 ? 0.5 : index / (values.length - 1);
}
function subjectRefs(graph, subjectId) { return graph?.nodes.get(id(subjectId))?.subject?.externalRefs || []; }
function sameCanonical(left, right) { return canonicalKey(left) === canonicalKey(right); }
function namespaceFeatureKey(namespaceId, kind, definitionId) { return `${id(namespaceId)}:${kind}:${String(definitionId)}`; }

function featureMatchScore({ feature, candidate, graph }) {
  if (!feature?.kind) return 0;
  const primarySubjectId = id(candidate.item.primarySubjectId);
  if (feature.kind === "subject") {
    if (id(feature.subjectId) === primarySubjectId) return 1;
    return (candidate.variant.semanticFocus || []).some((entry) => id(entry.subjectId) === id(feature.subjectId)) ? 0.85 : 0;
  }
  if (feature.kind === "canonical") {
    const own = subjectRefs(graph, primarySubjectId).some((ref) => sameCanonical(ref, feature));
    if (own) return 0.95;
    for (const focus of candidate.variant.semanticFocus || []) {
      if (subjectRefs(graph, focus.subjectId).some((ref) => sameCanonical(ref, feature))) return 0.75 * (Number(focus.weight) || 1);
    }
    return 0;
  }
  if (id(feature.namespaceId) !== id(candidate.edition.namespaceId)) return 0;
  const definitionId = String(feature.definitionId || "");
  if (feature.kind === "presentation_aspect") {
    const aspect = (candidate.variant.presentationAspects || []).find((entry) => String(entry.definitionId) === definitionId);
    return aspect ? Number(aspect.weight) || 1 : 0;
  }
  if (feature.kind === "selection_signal") {
    const signal = (candidate.revision.selectionSignals || []).find((entry) => String(entry.definitionId) === definitionId);
    return signal ? Number(signal.weight) || 1 : 0;
  }
  if (feature.kind === "subject_class") {
    const binding = graph.bindingsByNamespaceSubject.get(`${id(feature.namespaceId)}:${primarySubjectId}`);
    return (binding?.subjectClassDefinitionIds || []).some((entry) => String(entry) === definitionId) ? 0.9 : 0;
  }
  if (feature.kind === "relation_type") {
    return neighbors(graph, primarySubjectId, { relationType: { namespaceId: feature.namespaceId, definitionId } }).length ? 0.8 : 0;
  }
  return 0;
}

function knownFeature({ feature, graph, namespaceRevisionByNamespaceId }) {
  if (!feature?.kind) return false;
  if (["subject", "canonical", "subject_class", "relation_type"].includes(feature.kind)) {
    if (resolveFeatureToSubjectIds(graph, feature).length) return true;
  }
  if (!["subject_class", "relation_type", "presentation_aspect", "selection_signal"].includes(feature.kind)) return false;
  const revision = namespaceRevisionByNamespaceId.get(id(feature.namespaceId));
  if (!revision) return false;
  const group = feature.kind === "subject_class" ? revision.subjectClasses
    : feature.kind === "relation_type" ? revision.relationTypes
      : feature.kind === "presentation_aspect" ? revision.presentationAspects
        : revision.selectionSignals;
  return (group || []).some((entry) => String(entry.definitionId) === String(feature.definitionId));
}

function resolveGoals({ request, graph, namespaceRevisionByNamespaceId }) {
  const warnings = [], errors = [], semanticGoals = [], relationGoals = [], requiredKeys = [];
  for (const [index, goal] of (request.semanticGoals || []).entries()) {
    const resolved = { ...goal, priority: goal.priority || "preferred", weight: Number(goal.weight ?? 1), key: `semantic:${index}` };
    if (!knownFeature({ feature: goal.feature, graph, namespaceRevisionByNamespaceId })) {
      const target = resolved.priority === "required" ? errors : warnings;
      target.push({ field: `semanticGoals[${index}]`, code: "SEMANTIC_GOAL_UNRESOLVED", message: "Il goal semantico non e risolvibile nell'EditorialScope selezionato" });
      continue;
    }
    semanticGoals.push(resolved);
    if (resolved.priority === "required") requiredKeys.push(resolved.key);
  }
  for (const [index, goal] of (request.relationGoals || []).entries()) {
    const key = `relation:${index}`, priority = goal.priority || "preferred", weight = Number(goal.weight ?? 1), maxDepth = Number(goal.maxDepth) || 3;
    let path = null, targetIds = [];
    if (["relationship", "compare"].includes(goal.kind)) {
      path = shortestSemanticPath(graph, { from: goal.from, to: goal.to, relationType: goal.relationType || null, maxDepth });
    } else if (goal.kind === "follow_relation") {
      const starts = resolveFeatureToSubjectIds(graph, goal.from), allowedTargets = goal.to ? new Set(resolveFeatureToSubjectIds(graph, goal.to)) : null, result = new Set();
      for (const start of starts) {
        for (const edge of neighbors(graph, start, { relationType: goal.relationType })) {
          const targetId = id(edge.toSubjectId);
          if (!allowedTargets || allowedTargets.has(targetId)) result.add(targetId);
        }
      }
      targetIds = [...result];
    }
    const ok = goal.kind === "follow_relation" ? targetIds.length > 0 : Boolean(path);
    if (!ok) {
      const target = priority === "required" ? errors : warnings;
      target.push({ field: `relationGoals[${index}]`, code: "RELATION_GOAL_UNRESOLVED", message: "Il grafo federato non contiene un percorso compatibile" });
      continue;
    }
    const resolved = { ...goal, key, priority, weight, maxDepth, path, targetIds };
    relationGoals.push(resolved);
    if (priority === "required") {
      if (goal.kind === "follow_relation") requiredKeys.push(`${key}:target`);
      else { requiredKeys.push(`${key}:from`); requiredKeys.push(`${key}:to`); }
    }
  }
  return { semanticGoals, relationGoals, requiredKeys, warnings, errors };
}

function scoreCurrentGoals({ goals, candidate, graph }) {
  const requiredCoverageKeys = [], preferenceMatches = [], avoidHits = [];
  for (const goal of goals.semanticGoals || []) {
    const match = featureMatchScore({ feature: goal.feature, candidate, graph });
    const score = match * Math.max(0, goal.weight);
    if (goal.priority === "required" && match > 0) requiredCoverageKeys.push(goal.key);
    if (goal.priority === "preferred") preferenceMatches.push({ key: goal.key, score });
    if (goal.priority === "avoid" && match > 0) avoidHits.push(goal.key);
  }
  const subjectId = id(candidate.item.primarySubjectId);
  for (const goal of goals.relationGoals || []) {
    const fromIds = new Set(resolveFeatureToSubjectIds(graph, goal.from));
    const toIds = new Set(goal.to ? resolveFeatureToSubjectIds(graph, goal.to) : goal.targetIds || []);
    const pathIds = new Set(goal.path?.subjectIds || []);
    if (goal.priority === "required") {
      if (goal.kind === "follow_relation" && (goal.targetIds || []).includes(subjectId)) requiredCoverageKeys.push(`${goal.key}:target`);
      if (goal.kind !== "follow_relation") {
        if (fromIds.has(subjectId)) requiredCoverageKeys.push(`${goal.key}:from`);
        if (toIds.has(subjectId)) requiredCoverageKeys.push(`${goal.key}:to`);
      }
    }
    const match = goal.kind === "follow_relation"
      ? ((goal.targetIds || []).includes(subjectId) ? 1 : fromIds.has(subjectId) ? 0.35 : 0)
      : pathIds.has(subjectId) ? (fromIds.has(subjectId) || toIds.has(subjectId) ? 1 : 0.65) : 0;
    const score = match * Math.max(0, goal.weight);
    if (goal.priority === "preferred") preferenceMatches.push({ key: goal.key, score });
    if (goal.priority === "avoid" && match > 0) avoidHits.push(goal.key);
  }
  const explicitPreference = preferenceMatches.length
    ? clamp(preferenceMatches.reduce((sum, entry) => sum + entry.score, 0) / preferenceMatches.length)
    : 0;
  return { requiredCoverageKeys: [...new Set(requiredCoverageKeys)], preferenceMatches, avoidHits, explicitPreference };
}

function audienceFit(request, variant) {
  const rule = variant.audienceSuitability, audience = request.audience;
  if (!rule || !audience) return 0.5;
  let fit = 1;
  const age = Number(audience.ageYears), maturity = Number(audience.maturity);
  if (Number.isFinite(age)) {
    if (rule.minAgeYears != null && age < Number(rule.minAgeYears)) fit *= 0.2;
    if (rule.maxAgeYears != null && age > Number(rule.maxAgeYears)) fit *= 0.45;
  }
  if (Number.isFinite(maturity)) {
    if (rule.minMaturity != null && maturity < Number(rule.minMaturity)) fit *= 0.25;
    if (rule.maxMaturity != null && maturity > Number(rule.maxMaturity)) fit *= 0.55;
  }
  return clamp(fit);
}

function knowledgeFit({ request, variant, learningState }) {
  const requirements = variant.knowledgeRequirements || [];
  if (!requirements.length) return 0.5;
  const explicit = new Map((request.knowledge || []).map((entry) => [id(entry.subjectId), Number(entry.level)]));
  let total = 0, weight = 0;
  for (const requirement of requirements) {
    const subjectId = id(requirement.subjectId), w = Number(requirement.weight) || 1;
    let level = explicit.get(subjectId);
    if (!Number.isFinite(level)) {
      const learned = learningState?.subjectKnowledgeById?.get(subjectId);
      if (learned && Number(learned.confidence) >= 0.2) level = Number(learned.level);
    }
    let fit = 0.5;
    if (Number.isFinite(level)) {
      const min = Number(requirement.minLevel ?? 0), max = Number(requirement.maxLevel ?? 1);
      fit = level < min ? Math.max(0, 1 - (min - level) * 2) : level > max ? Math.max(0, 1 - (level - max) * 1.5) : 1;
    }
    total += fit * w; weight += w;
  }
  return weight ? clamp(total / weight) : 0.5;
}

function representationPreferenceScore({ request, candidate, learningState }) {
  const durations = candidate.namespaceRevision.durationTypes || [], languages = candidate.namespaceRevision.languageLevels || [];
  const depthPos = normalizedPosition(durations, candidate.representation.durationTypeDefinitionId);
  const languagePos = normalizedPosition(languages, candidate.representation.languageLevelDefinitionId);
  if (depthPos == null || languagePos == null) return { eligible: false, score: 0 };
  const requestedLocale = String(request.locale || "").trim().toLowerCase();
  const locale = String(candidate.representation.locale || "").trim().toLowerCase();
  if (requestedLocale && requestedLocale !== locale) return { eligible: false, score: 0, localeFit: 0 };
  const depthFit = request.depthPreference === undefined ? 0.5 : 1 - Math.abs(depthPos - Number(request.depthPreference));
  const languageFit = request.languageComplexityPreference === undefined ? 0.5 : 1 - Math.abs(languagePos - Number(request.languageComplexityPreference));
  const aFit = audienceFit(request, candidate.variant);
  const kFit = knowledgeFit({ request, variant: candidate.variant, learningState });
  return { eligible: true, depthFit: clamp(depthFit), languageFit: clamp(languageFit), audienceFit: aFit, knowledgeFit: kFit, localeFit: requestedLocale ? 1 : 0.5, score: clamp(depthFit * 0.3 + languageFit * 0.25 + aFit * 0.2 + kFit * 0.2 + (requestedLocale ? 1 : 0.5) * 0.05) };
}

function learnedSemanticScore({ candidate, graph, learningState, now = new Date() }) {
  if (!learningState) return 0;
  const values = [];
  const subjectAffinity = learningState.subjectAffinityById?.get(id(candidate.item.primarySubjectId));
  if (subjectAffinity) values.push(effectiveAffinity(subjectAffinity, now) * 0.95);
  const editionAffinity = learningState.editionAffinityById?.get(id(candidate.edition._id));
  if (editionAffinity) values.push(effectiveAffinity(editionAffinity, now) * 0.85);
  for (const focus of candidate.variant.semanticFocus || []) {
    const affinity = learningState.subjectAffinityById?.get(id(focus.subjectId));
    if (affinity) values.push(effectiveAffinity(affinity, now) * (Number(focus.weight) || 1) * 0.75);
  }
  for (const aspect of candidate.variant.presentationAspects || []) {
    const affinity = learningState.namespaceFeatureAffinityByKey?.get(namespaceFeatureKey(candidate.edition.namespaceId, "presentation_aspect", aspect.definitionId));
    if (affinity) values.push(effectiveAffinity(affinity, now) * (Number(aspect.weight) || 1) * 0.65);
  }
  for (const signal of candidate.revision.selectionSignals || []) {
    const affinity = learningState.namespaceFeatureAffinityByKey?.get(namespaceFeatureKey(candidate.edition.namespaceId, "selection_signal", signal.definitionId));
    if (affinity) values.push(effectiveAffinity(affinity, now) * (Number(signal.weight) || 1) * 0.45);
  }
  for (const edge of neighbors(graph, candidate.item.primarySubjectId)) {
    const affinity = learningState.namespaceFeatureAffinityByKey?.get(namespaceFeatureKey(edge.namespaceId, "relation_type", edge.relationTypeDefinitionId));
    if (affinity) values.push(effectiveAffinity(affinity, now) * 0.35 * (Number(edge.traversalWeight) || 0.5));
  }
  const usable = values.filter((value) => Number.isFinite(value) && value !== 0);
  return usable.length ? Math.max(-1, Math.min(1, usable.reduce((sum, value) => sum + value, 0) / usable.length)) : 0;
}

function buildReasons(option) {
  const reasons = [];
  if (option.requiredCoverageKeys?.length) reasons.push({ source: "current_request", message: "Soddisfa un vincolo richiesto", confidence: 1 });
  if (option.explicitPreference > 0.05) reasons.push({ source: "current_request", message: "Coerente con i goal dichiarati", confidence: clamp(option.explicitPreference) });
  if (option.learnedInterest > 0.05) reasons.push({ source: "learned_history", message: "Coerente con interessi appresi", confidence: clamp(Math.abs(option.learnedInterest)) });
  if (option.noveltyScore > 0.5) reasons.push({ source: "discovery", message: "Introduce contenuto poco o mai fruito", confidence: clamp(option.noveltyScore) });
  if (option.target) reasons.push({ source: "physical_scope", message: "Associato a un VenueTarget disponibile nel PhysicalScope", confidence: 1 });
  return reasons;
}

module.exports = {
  clamp,
  normalizedPosition,
  namespaceFeatureKey,
  featureMatchScore,
  resolveGoals,
  scoreCurrentGoals,
  representationPreferenceScore,
  learnedSemanticScore,
  buildReasons,
};
