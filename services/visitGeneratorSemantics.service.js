const { semanticAffinityScore, aspectAffinityScore } = require("./interestProfile.service");

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function id(value) { return String(value?._id || value || ""); }
function semanticKey(ref) { return `${String(ref?.scheme || "").toLowerCase()}::${String(ref?.id || ref?.refId || "")}`; }
function semanticRefStrength(ref) { return ref?.matchType === "exact" ? 1 : ref?.matchType === "close" ? 0.8 : 0.5; }
function interestWeight(interest) { const value = Number(interest?.weight); return Number.isFinite(value) ? clamp(value, -1, 1) : 1; }
function itemTypeRefs(vocabulary, itemType) { return (vocabulary?.itemTypeDefinitions || []).find((entry) => entry.key === itemType)?.semanticRefs || []; }
function relationTypesByKey(vocabulary) { return new Map((vocabulary?.relationTypes || []).map((entry) => [entry.key, entry])); }

function explicitFeatureScore({ interest, item, revision, variant, vocabulary = {} }) {
  const weight = interestWeight(interest);
  if (interest.kind === "item" && id(interest.itemId) === id(item._id)) return weight;
  if (interest.kind === "item_type" && interest.key === item.itemType) return weight * 0.8;
  if (interest.kind === "canonical") {
    const target = semanticKey(interest);
    const own = (revision.semanticRefs || []).find((ref) => semanticKey(ref) === target);
    if (own) return weight * semanticRefStrength(own);
    const typeRef = itemTypeRefs(vocabulary, item.itemType).find((ref) => semanticKey(ref) === target);
    if (typeRef) return weight * 0.7 * semanticRefStrength(typeRef);
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "canonical" && semanticKey(focus) === target)) return weight * 0.8;
    const relationTypes = relationTypesByKey(vocabulary);
    for (const relation of revision.relations || []) {
      const ref = (relationTypes.get(relation.relationTypeKey)?.semanticRefs || []).find((candidate) => semanticKey(candidate) === target);
      if (ref) return weight * 0.55 * semanticRefStrength(ref);
    }
  }
  if (interest.kind === "relation_type") {
    if ((revision.relations || []).some((relation) => relation.relationTypeKey === interest.key)) return weight * 0.7;
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "relation_type" && focus.key === interest.key)) return weight * 0.8;
  }
  if (interest.kind === "item") {
    if ((revision.relations || []).some((relation) => id(relation.target) === id(interest.itemId))) return weight * 0.65;
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "item" && id(focus.itemId) === id(interest.itemId))) return weight * 0.85;
  }
  if (interest.kind === "tag" && (revision.tags || []).some((tag) => String(tag).toLowerCase() === String(interest.key || "").toLowerCase())) return weight * 0.45;
  return 0;
}

function learnedSemanticScore({ profile, museumId, item, revision, variant, vocabulary = {} }) {
  let total = 0;
  total += semanticAffinityScore(profile, { kind: "item", itemId: item._id });
  total += semanticAffinityScore(profile, { kind: "item_type", museumId, key: item.itemType }) * 0.7;
  for (const ref of itemTypeRefs(vocabulary, item.itemType)) {
    total += semanticAffinityScore(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }) * 0.6 * semanticRefStrength(ref);
  }
  for (const ref of revision.semanticRefs || []) {
    total += semanticAffinityScore(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }) * 0.8 * semanticRefStrength(ref);
  }
  const relationTypes = relationTypesByKey(vocabulary);
  for (const relation of revision.relations || []) {
    total += semanticAffinityScore(profile, { kind: "relation_type", museumId, key: relation.relationTypeKey }) * 0.35;
    for (const ref of relationTypes.get(relation.relationTypeKey)?.semanticRefs || []) {
      total += semanticAffinityScore(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }) * 0.35 * semanticRefStrength(ref);
    }
    total += semanticAffinityScore(profile, { kind: "item", itemId: relation.target }) * 0.3;
  }
  for (const focus of variant?.semanticFocus || []) {
    total += semanticAffinityScore(profile, { ...focus, museumId }) * (Number(focus.weight) || 1) * 0.8;
  }
  return total;
}

function aspectScores({ context, vocabulary, variant }) {
  const definitions = new Map((vocabulary.presentationAspects || []).map((entry) => [entry.key, entry]));
  let explicit = 0;
  let learned = 0;
  for (const aspect of variant.presentationAspects || []) {
    explicit += context.explicitInterests
      .filter((interest) => interest.kind === "presentation_aspect" && interest.key === aspect.key)
      .reduce((sum, interest) => sum + interestWeight(interest), 0) * (Number(aspect.weight) || 1);
    const definition = definitions.get(aspect.key);
    learned += aspectAffinityScore(
      context.userProfile,
      { museumId: context.museumId, key: aspect.key, semanticRefs: definition?.semanticRefs || [] },
    ) * (Number(aspect.weight) || 1);
  }
  return { explicit, learned };
}

function representationPreferenceScore({ representation, context, durationPositions, languagePositions }) {
  const depth = durationPositions.get(representation.durationKey);
  const language = languagePositions.get(representation.languageLevelKey);
  const depthFit = Number.isFinite(depth) ? 1 - Math.abs(depth - context.dimensions.depth.value) : 0;
  const languageFit = Number.isFinite(language) ? 1 - Math.abs(language - context.dimensions.language.value) : 0;
  return { depthFit, languageFit, score: depthFit * 0.35 + languageFit * 0.25 };
}

function relationCoherence(fromCandidate, toCandidate) {
  if (!fromCandidate) return 0;
  const fromRelations = fromCandidate.revision.relations || [];
  const toRelations = toCandidate.revision.relations || [];
  if (fromRelations.some((relation) => id(relation.target) === id(toCandidate.item._id)) || toRelations.some((relation) => id(relation.target) === id(fromCandidate.item._id))) return 0.7;
  const left = new Set(fromRelations.map((relation) => id(relation.target)));
  const right = new Set(toRelations.map((relation) => id(relation.target)));
  const overlap = [...left].filter((entry) => right.has(entry)).length;
  return overlap ? Math.min(0.4, overlap * 0.12) : 0;
}

function statePriority(state, mustCount) { return state.utility + state.mustCovered * 1000 - Math.max(0, mustCount - state.mustCovered) * 2; }
function pruneBeam(states, mustCount, width) {
  states.sort((a, b) => statePriority(b, mustCount) - statePriority(a, mustCount) || a.elapsedSeconds - b.elapsedSeconds);
  return states.slice(0, width);
}

function buildReasons(option) {
  const reasons = [];
  if (option.scoreBreakdown.explicitInterest > 0) reasons.push({ source: "current_request", message: "La tappa corrisponde agli interessi indicati per questa visita", confidence: 1 });
  if (option.scoreBreakdown.learnedInterest > 0.05) reasons.push({ source: "user_history", message: "La tappa e coerente con preferenze apprese dalle visite precedenti", confidence: clamp(Math.abs(option.scoreBreakdown.learnedInterest)) });
  if (option.scoreBreakdown.discovery > 0) reasons.push({ source: "discovery", message: "Introduce un elemento nuovo coerente con la preferenza di scoperta", confidence: 1 });
  return reasons;
}

module.exports = {
  id,
  semanticKey,
  semanticRefStrength,
  interestWeight,
  explicitFeatureScore,
  learnedSemanticScore,
  aspectScores,
  representationPreferenceScore,
  relationCoherence,
  pruneBeam,
  buildReasons,
};
