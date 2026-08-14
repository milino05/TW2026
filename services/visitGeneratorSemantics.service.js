const {
  affinityScore,
  knowledgeForFeature,
  clamp,
} = require('./interestProfile.service');
const {
  featureKey,
  semanticRefKey,
  resolveFeatureToItemIds,
  shortestSemanticPath,
  neighbors,
} = require('./semanticGraph.service');

function id(value) {
  return String(value?._id || value || '');
}

function semanticKey(ref) {
  return semanticRefKey(ref);
}

function semanticRefStrength(ref) {
  if (ref?.matchType === 'exact') return 1;
  if (ref?.matchType === 'close') return 0.8;
  if (ref?.matchType === 'broader' || ref?.matchType === 'narrower') return 0.55;
  return 0.5;
}

function itemTypeDefinition(vocabulary, itemType) {
  return (vocabulary?.itemTypeDefinitions || []).find((entry) => entry.key === itemType) || null;
}

function strongest(values = []) {
  let best = 0;
  for (const value of values) {
    const numeric = Number(value) || 0;
    if (Math.abs(numeric) > Math.abs(best)) best = numeric;
  }
  return best;
}

function sameCanonical(ref, feature) {
  return semanticKey(ref) === semanticKey(feature);
}

function definitionRefs(vocabulary, kind, key) {
  const group = kind === 'item_type'
    ? vocabulary.itemTypeDefinitions
    : kind === 'relation_type'
      ? vocabulary.relationTypes
      : kind === 'presentation_aspect'
        ? vocabulary.presentationAspects
        : kind === 'selection_signal'
          ? vocabulary.selectionSignals
          : [];
  return (group || []).find((entry) => entry.key === key)?.semanticRefs || [];
}

function vocabularyHasCanonical(vocabulary, feature) {
  for (const group of [
    vocabulary.itemTypeDefinitions || [],
    vocabulary.relationTypes || [],
    vocabulary.presentationAspects || [],
    vocabulary.selectionSignals || [],
  ]) {
    for (const definition of group) {
      if ((definition.semanticRefs || []).some((ref) => sameCanonical(ref, feature))) return true;
    }
  }
  return false;
}

function featureMatchScore({ feature, item, revision, variant, vocabulary = {}, graph = null }) {
  if (!feature?.kind) return 0;
  if (feature.kind === 'item') return id(feature.itemId) === id(item._id) ? 1 : 0;
  if (feature.kind === 'item_type') return feature.key === item.itemType ? 0.9 : 0;
  if (feature.kind === 'tag') {
    return (revision.tags || []).some((tag) => String(tag).toLowerCase() === String(feature.key || '').toLowerCase()) ? 0.55 : 0;
  }
  if (feature.kind === 'presentation_aspect') {
    const aspect = (variant.presentationAspects || []).find((entry) => entry.key === feature.key);
    return aspect ? Number(aspect.weight) || 1 : 0;
  }
  if (feature.kind === 'selection_signal') {
    const signal = (revision.selectionSignals || []).find((entry) => entry.key === feature.key);
    return signal ? Number(signal.weight) || 1 : 0;
  }
  if (feature.kind === 'relation_type') {
    if (graph) return neighbors(graph, item._id, { relationTypeKey: feature.key }).length ? 0.8 : 0;
    return (revision.relations || []).some((relation) => relation.relationTypeKey === feature.key) ? 0.75 : 0;
  }
  if (feature.kind !== 'canonical') return 0;

  const own = (revision.semanticRefs || []).find((ref) => sameCanonical(ref, feature));
  if (own) return 0.95 * semanticRefStrength(own);

  const typeRef = definitionRefs(vocabulary, 'item_type', item.itemType).find((ref) => sameCanonical(ref, feature));
  if (typeRef) return 0.7 * semanticRefStrength(typeRef);

  const focus = (variant.semanticFocus || []).find((entry) => entry.kind === 'canonical' && sameCanonical(entry, feature));
  if (focus) return 0.85 * (Number(focus.weight) || 1);

  for (const aspect of variant.presentationAspects || []) {
    const ref = definitionRefs(vocabulary, 'presentation_aspect', aspect.key).find((entry) => sameCanonical(entry, feature));
    if (ref) return 0.65 * (Number(aspect.weight) || 1) * semanticRefStrength(ref);
  }

  for (const signal of revision.selectionSignals || []) {
    const ref = definitionRefs(vocabulary, 'selection_signal', signal.key).find((entry) => sameCanonical(entry, feature));
    if (ref) return 0.65 * (Number(signal.weight) || 1) * semanticRefStrength(ref);
  }

  if (graph) {
    for (const edge of neighbors(graph, item._id)) {
      const ref = (edge.semanticRefs || []).find((entry) => sameCanonical(entry, feature));
      if (ref) return 0.6 * (edge.traversalWeight || 0.5) * semanticRefStrength(ref);
    }
  } else {
    for (const relation of revision.relations || []) {
      const ref = definitionRefs(vocabulary, 'relation_type', relation.relationTypeKey).find((entry) => sameCanonical(entry, feature));
      if (ref) return 0.55 * semanticRefStrength(ref);
    }
  }
  return 0;
}

function semanticFeatureKeysForCandidate({ item, revision, variant, vocabulary = {}, graph = null }) {
  const keys = new Set([
    featureKey({ kind: 'item', itemId: item._id }),
    featureKey({ kind: 'item_type', key: item.itemType }),
  ]);
  for (const ref of revision.semanticRefs || []) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
  for (const ref of definitionRefs(vocabulary, 'item_type', item.itemType)) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
  for (const relation of revision.relations || []) {
    keys.add(featureKey({ kind: 'relation_type', key: relation.relationTypeKey }));
    for (const ref of definitionRefs(vocabulary, 'relation_type', relation.relationTypeKey)) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
  }
  for (const focus of variant.semanticFocus || []) keys.add(featureKey(focus));
  for (const aspect of variant.presentationAspects || []) {
    keys.add(featureKey({ kind: 'presentation_aspect', key: aspect.key }));
    for (const ref of definitionRefs(vocabulary, 'presentation_aspect', aspect.key)) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
  }
  for (const signal of revision.selectionSignals || []) {
    keys.add(featureKey({ kind: 'selection_signal', key: signal.key }));
    for (const ref of definitionRefs(vocabulary, 'selection_signal', signal.key)) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
  }
  for (const tag of revision.tags || []) keys.add(featureKey({ kind: 'tag', key: String(tag).toLowerCase() }));
  if (graph) {
    for (const edge of neighbors(graph, item._id)) {
      for (const ref of edge.semanticRefs || []) keys.add(featureKey({ kind: 'canonical', scheme: ref.scheme, refId: ref.id }));
    }
  }
  return [...keys];
}

function goalResolution({ context, graph, vocabulary }) {
  const warnings = [];
  const errors = [];
  const semanticGoals = [];
  const relationGoals = [];
  const requiredKeys = [];

  function knownFeature(feature) {
    if (!feature) return false;
    if (feature.kind === 'presentation_aspect') return (vocabulary.presentationAspects || []).some((entry) => entry.key === feature.key);
    if (feature.kind === 'selection_signal') return (vocabulary.selectionSignals || []).some((entry) => entry.key === feature.key);
    if (feature.kind === 'relation_type') return (vocabulary.relationViews || []).some((entry) => entry.viewKey === feature.key || entry.baseRelationTypeKey === feature.key);
    if (feature.kind === 'item_type') return (vocabulary.itemTypes || []).includes(feature.key);
    if (feature.kind === 'canonical') return resolveFeatureToItemIds(graph, feature).length > 0 || vocabularyHasCanonical(vocabulary, feature);
    return resolveFeatureToItemIds(graph, feature).length > 0;
  }

  (context.semanticGoals || []).forEach((goal, index) => {
    const resolved = { ...goal, priority: goal.priority || 'preferred', weight: Number(goal.weight ?? 1), key: `semantic:${index}` };
    if (!knownFeature(goal.feature)) {
      (resolved.priority === 'required' ? errors : warnings).push({
        field: `semanticGoals[${index}]`,
        code: 'SEMANTIC_GOAL_UNRESOLVED',
        message: 'Il museo non contiene dati sufficienti per risolvere il goal semantico',
        context: { feature: goal.feature },
      });
      return;
    }
    semanticGoals.push(resolved);
    if (resolved.priority === 'required') requiredKeys.push(resolved.key);
  });

  (context.relationGoals || []).forEach((goal, index) => {
    const key = `relation:${index}`;
    const priority = goal.priority || 'preferred';
    const weight = Number(goal.weight ?? 1);
    const maxDepth = Number(goal.maxDepth) || 3;
    let path = null;
    let targetIds = [];

    if (['relationship', 'compare'].includes(goal.kind)) {
      path = shortestSemanticPath(graph, { from: goal.from, to: goal.to, relationTypeKey: goal.relationTypeKey || null, maxDepth });
    } else if (goal.kind === 'follow_relation') {
      const starts = resolveFeatureToItemIds(graph, goal.from);
      const allowedTargets = goal.to ? new Set(resolveFeatureToItemIds(graph, goal.to)) : null;
      const set = new Set();
      for (const start of starts) {
        for (const edge of neighbors(graph, start, { relationTypeKey: goal.relationTypeKey })) {
          if (!allowedTargets || allowedTargets.has(id(edge.toItemId))) set.add(id(edge.toItemId));
        }
      }
      targetIds = [...set];
    }

    const resolved = { ...goal, key, priority, weight, maxDepth, path, targetIds };
    const ok = goal.kind === 'follow_relation' ? targetIds.length > 0 : Boolean(path);
    if (!ok) {
      (priority === 'required' ? errors : warnings).push({
        field: `relationGoals[${index}]`,
        code: 'RELATION_GOAL_UNRESOLVED',
        message: 'Il knowledge graph non contiene un percorso compatibile con il relation goal',
      });
      return;
    }
    relationGoals.push(resolved);
    if (priority === 'required') {
      if (goal.kind === 'follow_relation') requiredKeys.push(`${key}:target`);
      else {
        requiredKeys.push(`${key}:from`);
        requiredKeys.push(`${key}:to`);
      }
    }
  });
  return { semanticGoals, relationGoals, requiredKeys, warnings, errors };
}

function scoreCurrentGoals({ goals, item, revision, variant, vocabulary, graph }) {
  const requiredCoverageKeys = [];
  const preferenceMatches = [];
  const avoidHits = [];

  for (const goal of goals.semanticGoals || []) {
    const match = featureMatchScore({ feature: goal.feature, item, revision, variant, vocabulary, graph });
    const score = match * Math.max(0, goal.weight);
    if (goal.priority === 'required' && match > 0) requiredCoverageKeys.push(goal.key);
    if (goal.priority === 'preferred') preferenceMatches.push({ key: goal.key, score });
    if (goal.priority === 'avoid' && match > 0) avoidHits.push(goal.key);
  }

  for (const goal of goals.relationGoals || []) {
    const itemId = id(item._id);
    const pathIds = new Set(goal.path?.itemIds || []);
    const fromIds = new Set(resolveFeatureToItemIds(graph, goal.from));
    const toIds = new Set(goal.to ? resolveFeatureToItemIds(graph, goal.to) : goal.targetIds || []);
    if (goal.priority === 'required') {
      if (goal.kind === 'follow_relation' && (goal.targetIds || []).includes(itemId)) requiredCoverageKeys.push(`${goal.key}:target`);
      if (goal.kind !== 'follow_relation') {
        if (fromIds.has(itemId)) requiredCoverageKeys.push(`${goal.key}:from`);
        if (toIds.has(itemId)) requiredCoverageKeys.push(`${goal.key}:to`);
      }
    }
    const match = goal.kind === 'follow_relation'
      ? ((goal.targetIds || []).includes(itemId) ? 1 : fromIds.has(itemId) ? 0.35 : 0)
      : pathIds.has(itemId) ? (fromIds.has(itemId) || toIds.has(itemId) ? 1 : 0.65) : 0;
    const score = match * Math.max(0, goal.weight);
    if (goal.priority === 'preferred') preferenceMatches.push({ key: goal.key, score });
    if (goal.priority === 'avoid' && match > 0) avoidHits.push(goal.key);
  }

  return {
    requiredCoverageKeys: [...new Set(requiredCoverageKeys)],
    preferenceMatches,
    explicitPreference: preferenceMatches.length ? clamp(preferenceMatches.reduce((sum, entry) => sum + entry.score, 0) / preferenceMatches.length) : 0,
    avoidHits,
  };
}

function learnedSemanticScore({ state, museumId, item, revision, variant, vocabulary = {}, graph = null }) {
  if (!state) return 0;
  const families = [
    affinityScore(state, { kind: 'item', itemId: item._id }),
    affinityScore(state, { kind: 'item_type', museumId, key: item.itemType }) * 0.75,
    strongest((revision.semanticRefs || []).map((ref) => affinityScore(state, { kind: 'canonical', scheme: ref.scheme, refId: ref.id }) * 0.9 * semanticRefStrength(ref))),
    strongest((revision.relations || []).map((relation) => affinityScore(state, { kind: 'relation_type', museumId, key: relation.relationTypeKey }) * 0.5)),
    strongest((variant.semanticFocus || []).map((focus) => affinityScore(state, { ...focus, museumId }) * (Number(focus.weight) || 1) * 0.85)),
    strongest((revision.selectionSignals || []).map((signal) => affinityScore(state, { kind: 'selection_signal', museumId, key: signal.key }) * (Number(signal.weight) || 1) * 0.45)),
    strongest((variant.presentationAspects || []).map((aspect) => affinityScore(state, { kind: 'presentation_aspect', museumId, key: aspect.key }) * (Number(aspect.weight) || 1) * 0.7)),
  ];

  const canonicalRefs = [];
  for (const relation of revision.relations || []) canonicalRefs.push(...definitionRefs(vocabulary, 'relation_type', relation.relationTypeKey));
  for (const aspect of variant.presentationAspects || []) canonicalRefs.push(...definitionRefs(vocabulary, 'presentation_aspect', aspect.key));
  for (const signal of revision.selectionSignals || []) canonicalRefs.push(...definitionRefs(vocabulary, 'selection_signal', signal.key));
  families.push(strongest(canonicalRefs.map((ref) => affinityScore(state, { kind: 'canonical', scheme: ref.scheme, refId: ref.id }) * 0.55 * semanticRefStrength(ref))));

  if (graph) {
    families.push(strongest(neighbors(graph, item._id).map((edge) => {
      const targetAffinity = affinityScore(state, { kind: 'item', itemId: edge.toItemId }) * (edge.traversalWeight || 0) * 0.45;
      const canonicalAffinity = strongest((edge.semanticRefs || []).map((ref) => affinityScore(state, { kind: 'canonical', scheme: ref.scheme, refId: ref.id }) * (edge.traversalWeight || 0) * 0.5));
      return Math.max(targetAffinity, canonicalAffinity);
    })));
  }

  const usable = families.filter((value) => Number.isFinite(value) && value !== 0);
  return usable.length ? clamp(usable.reduce((sum, value) => sum + value, 0) / usable.length, -1, 1) : 0;
}

function audienceFit(context, variant) {
  const rule = variant.audienceSuitability;
  const audience = context.audience;
  if (!rule || !audience) return { fit: 0.5, eligible: true };
  const age = Number(audience.ageYears);
  const maturity = Number(audience.maturity);
  let fit = 1;
  let eligible = true;
  if (Number.isFinite(age)) {
    if (rule.minAgeYears != null && age < Number(rule.minAgeYears)) eligible = false;
    if (rule.maxAgeYears != null && age > Number(rule.maxAgeYears)) fit *= 0.45;
  }
  if (Number.isFinite(maturity)) {
    if (rule.minMaturity != null && maturity < Number(rule.minMaturity)) eligible = false;
    if (rule.maxMaturity != null && maturity > Number(rule.maxMaturity)) fit *= 0.55;
  }
  return { fit, eligible };
}

function knowledgeFit(context, variant) {
  const requirements = variant.knowledgeRequirements || [];
  if (!requirements.length) return { fit: 0.5, eligible: true };
  let total = 0;
  let weightTotal = 0;
  let eligible = true;
  for (const requirement of requirements) {
    const feature = { ...(requirement.feature || {}), museumId: requirement.feature?.museumId || context.museumId };
    const knowledge = knowledgeForFeature(context.semanticState, feature, context.explicitKnowledge);
    const weight = Number(requirement.weight) || 1;
    weightTotal += weight;
    if (knowledge.level == null) {
      total += 0.5 * weight;
      continue;
    }
    const min = Number(requirement.minLevel ?? 0);
    const max = Number(requirement.maxLevel ?? 1);
    const inside = knowledge.level >= min && knowledge.level <= max;
    total += (inside ? 1 : Math.max(0, 1 - Math.min(Math.abs(knowledge.level - min), Math.abs(knowledge.level - max)))) * weight;
    if (knowledge.source === 'current_request' && knowledge.level < min) eligible = false;
  }
  return { fit: weightTotal ? total / weightTotal : 0.5, eligible };
}

function representationPreferenceScore({ representation, context, durationPositions, languagePositions, variant }) {
  const depth = durationPositions.get(representation.durationKey);
  const language = languagePositions.get(representation.languageLevelKey);
  const depthFit = Number.isFinite(depth) ? 1 - Math.abs(depth - context.dimensions.depth.value) : 0;
  const languageFit = Number.isFinite(language) ? 1 - Math.abs(language - context.dimensions.language.value) : 0;
  const audience = audienceFit(context, variant);
  const knowledge = knowledgeFit(context, variant);
  return {
    depthFit,
    languageFit,
    audienceFit: audience.fit,
    knowledgeFit: knowledge.fit,
    eligible: audience.eligible && knowledge.eligible,
    score: depthFit * 0.28 + languageFit * 0.22 + audience.fit * 0.15 + knowledge.fit * 0.15,
  };
}

function relationCoherence(fromCandidate, toCandidate, graph = null) {
  if (!fromCandidate) return 0;
  if (graph) {
    const direct = neighbors(graph, fromCandidate.item._id).filter((edge) => id(edge.toItemId) === id(toCandidate.item._id));
    if (direct.length) return Math.min(0.8, 0.25 + Math.max(...direct.map((edge) => edge.traversalWeight || 0)) * 0.55);
    const left = new Set(neighbors(graph, fromCandidate.item._id).map((edge) => id(edge.toItemId)));
    const right = new Set(neighbors(graph, toCandidate.item._id).map((edge) => id(edge.toItemId)));
    const overlap = [...left].filter((entry) => right.has(entry)).length;
    return overlap ? Math.min(0.35, overlap * 0.1) : 0;
  }
  const fromRelations = fromCandidate.revision.relations || [];
  const toRelations = toCandidate.revision.relations || [];
  return fromRelations.some((relation) => id(relation.target) === id(toCandidate.item._id)) || toRelations.some((relation) => id(relation.target) === id(fromCandidate.item._id)) ? 0.7 : 0;
}

function compareStates(a, b) {
  if (a.hardCovered !== b.hardCovered) return b.hardCovered - a.hardCovered;
  if (a.explicitScore !== b.explicitScore) return b.explicitScore - a.explicitScore;
  if (a.utility !== b.utility) return b.utility - a.utility;
  if (a.entries.length !== b.entries.length) return b.entries.length - a.entries.length;
  return a.elapsedSeconds - b.elapsedSeconds;
}

function pruneBeam(states, requiredCount, width) {
  states.sort((a, b) => compareStates(a, b, requiredCount));
  return states.slice(0, width);
}

function buildReasons(option) {
  const reasons = [];
  if (option.explicitPreference > 0) reasons.push({ source: 'current_request', message: 'Il contenuto risponde ai goal indicati per questa visita', confidence: 1 });
  if (option.requiredCoverageKeys?.length) reasons.push({ source: 'current_request', message: 'Il contenuto soddisfa un vincolo semantico richiesto', confidence: 1 });
  if (option.learnedInterest > 0.05) reasons.push({ source: 'user_history', message: 'Il contenuto e coerente con preferenze apprese', confidence: clamp(Math.abs(option.learnedInterest)) });
  if (option.noveltyScore > 0.45) reasons.push({ source: 'discovery', message: 'Aggiunge un contenuto o un taglio non ancora fruito', confidence: option.noveltyScore });
  return reasons;
}

module.exports = {
  id,
  semanticKey,
  semanticRefStrength,
  featureMatchScore,
  semanticFeatureKeysForCandidate,
  goalResolution,
  scoreCurrentGoals,
  learnedSemanticScore,
  representationPreferenceScore,
  relationCoherence,
  compareStates,
  pruneBeam,
  buildReasons,
};
