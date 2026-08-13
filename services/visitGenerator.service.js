const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const VisitSession = require("../models/visitSession.model");
const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { resolveExperienceContext } = require("./experienceContext.service");
const { listRepresentationCandidates } = require("./presentationModel.service");
const { buildPositionMap, buildDurationSecondsMap } = require("./vocabularyNormalization.service");
const { resolveObservationSeconds } = require("./adaptiveEstimation.service");
const { semanticAffinityScore, aspectAffinityScore } = require("./interestProfile.service");
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { resolveRoute } = require("./graphRouting.service");
const { translateRequirements } = require("./logisticsPlan.service");
const { validateGenerationRequest } = require("./validation/generation.validation");

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function id(value) { return String(value?._id || value || ""); }
function semanticKey(ref) { return `${String(ref?.scheme || "").toLowerCase()}::${String(ref?.id || ref?.refId || "")}`; }
function interestWeight(interest) { const value = Number(interest?.weight); return Number.isFinite(value) ? Math.max(0, value) : 1; }

function explicitFeatureScore({ interest, item, revision, variant }) {
  const weight = interestWeight(interest); const kind = interest.kind;
  if (kind === "item" && id(interest.itemId) === id(item._id)) return weight;
  if (kind === "item_type" && interest.key === item.itemType) return weight * 0.8;
  if (kind === "canonical") {
    const target = semanticKey(interest);
    if ((revision.semanticRefs || []).some((ref) => semanticKey(ref) === target)) return weight;
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "canonical" && semanticKey(focus) === target)) return weight * 0.8;
  }
  if (kind === "relation_type") {
    if ((revision.relations || []).some((relation) => relation.relationTypeKey === interest.key)) return weight * 0.7;
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "relation_type" && focus.key === interest.key)) return weight * 0.8;
  }
  if (kind === "item") {
    if ((revision.relations || []).some((relation) => id(relation.target) === id(interest.itemId))) return weight * 0.65;
    if ((variant?.semanticFocus || []).some((focus) => focus.kind === "item" && id(focus.itemId) === id(interest.itemId))) return weight * 0.85;
  }
  if (kind === "tag" && (revision.tags || []).some((tag) => String(tag).toLowerCase() === String(interest.key || "").toLowerCase())) return weight * 0.45;
  return 0;
}

function learnedSemanticScore({ profile, museumId, item, revision, variant }) {
  let total = 0;
  total += semanticAffinityScore(profile, { kind: "item", itemId: item._id });
  total += semanticAffinityScore(profile, { kind: "item_type", museumId, key: item.itemType }) * 0.7;
  for (const ref of revision.semanticRefs || []) total += semanticAffinityScore(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }) * (ref.matchType === "exact" ? 0.8 : 0.5);
  for (const relation of revision.relations || []) {
    total += semanticAffinityScore(profile, { kind: "relation_type", museumId, key: relation.relationTypeKey }) * 0.35;
    total += semanticAffinityScore(profile, { kind: "item", itemId: relation.target }) * 0.3;
  }
  for (const focus of variant?.semanticFocus || []) total += semanticAffinityScore(profile, { ...focus, museumId }) * (Number(focus.weight) || 1) * 0.8;
  return total;
}

function aspectScores({ context, vocabulary, variant }) {
  const definitions = new Map((vocabulary.presentationAspects || []).map((entry) => [entry.key, entry]));
  let explicit = 0; let learned = 0;
  for (const aspect of variant.presentationAspects || []) {
    const current = context.explicitInterests.filter((interest) => interest.kind === "presentation_aspect" && interest.key === aspect.key).reduce((sum, interest) => sum + interestWeight(interest), 0);
    explicit += current * (Number(aspect.weight) || 1);
    const definition = definitions.get(aspect.key);
    learned += aspectAffinityScore(context.userProfile, { museumId: context.museumId, key: aspect.key, semanticRefs: definition?.semanticRefs || [] }) * (Number(aspect.weight) || 1);
  }
  return { explicit, learned };
}

function representationPreferenceScore({ representation, context, durationPositions, languagePositions }) {
  const depth = durationPositions.get(representation.durationKey); const language = languagePositions.get(representation.languageLevelKey);
  const depthFit = Number.isFinite(depth) ? 1 - Math.abs(depth - context.dimensions.depth.value) : 0;
  const languageFit = Number.isFinite(language) ? 1 - Math.abs(language - context.dimensions.language.value) : 0;
  return { depthFit, languageFit, score: depthFit * 0.35 + languageFit * 0.25 };
}

function relationCoherence(fromCandidate, toCandidate) {
  if (!fromCandidate) return 0;
  const fromRelations = fromCandidate.revision.relations || []; const toRelations = toCandidate.revision.relations || [];
  if (fromRelations.some((relation) => id(relation.target) === id(toCandidate.item._id)) || toRelations.some((relation) => id(relation.target) === id(fromCandidate.item._id))) return 0.7;
  const left = new Set(fromRelations.map((relation) => id(relation.target))); const right = new Set(toRelations.map((relation) => id(relation.target)));
  const overlap = [...left].filter((entry) => right.has(entry)).length; return overlap ? Math.min(0.4, overlap * 0.12) : 0;
}

function statePriority(state, mustCount) { return state.utility + state.mustCovered * 1000 - Math.max(0, mustCount - state.mustCovered) * 2; }
function pruneBeam(states, mustCount, width) {
  states.sort((a, b) => statePriority(b, mustCount) - statePriority(a, mustCount) || a.elapsedSeconds - b.elapsedSeconds);
  return states.slice(0, width);
}

function chooseStartPlace(layoutRevision, requestStartPlaceId) {
  if (requestStartPlaceId && (layoutRevision.places || []).some((place) => id(place._id) === id(requestStartPlaceId))) return requestStartPlaceId;
  const entranceTypes = new Set((layoutRevision.placeTypes || []).filter((type) => (type.userIntents || []).includes("FIND_ENTRANCE")).map((type) => type.key));
  const entrance = (layoutRevision.places || []).find((place) => entranceTypes.has(place.typeKey));
  return entrance?._id || null;
}

async function loadGenerationData({ userId, museumId, request }) {
  const [context, vocabulary, layout, items, seenItemIds] = await Promise.all([
    resolveExperienceContext({ userId, museumId, request }),
    getMuseumVocabulary(museumId),
    MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
    Item.find({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
    VisitSession.find({ userId, status: "completed" }).distinct("stopObservations.itemId"),
  ]);
  if (!layout) throw new AppError("Il museo non ha un layout pubblicato: impossibile generare una visita fisica", 409);
  const layoutRevision = await MuseumLayoutRevision.findById(layout.publishedRevisionId).lean();
  if (!layoutRevision || layoutRevision.integrity?.status !== "valid") throw new AppError("Il layout pubblicato non e integro", 409);
  const translated = translateRequirements(layoutRevision, context.navigationRequirements);
  if (translated.unsupportedRequired.length) throw new AppError("Il museo non dichiara attributi necessari per la visita richiesta", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "navigationRequirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: `Attributo richiesto non supportato: ${attributeKey}` })));
  return { context, vocabulary, layoutRevision, items, seen: new Set(seenItemIds.map(id)), requirements: translated.requirements, warnings: translated.warnings };
}

async function buildCandidateOptions({ context, vocabulary, layoutRevision, items, seen }) {
  const placements = new Map((layoutRevision.itemPlacements || []).map((entry) => [id(entry.itemId), entry]));
  const typeDefs = new Map((vocabulary.itemTypeDefinitions || []).map((entry) => [entry.key, entry]));
  const durationPositions = buildPositionMap(vocabulary.durationTypes); const languagePositions = buildPositionMap(vocabulary.languageLevels); const durationSeconds = buildDurationSecondsMap(vocabulary.durationTypes);
  const excluded = new Set(context.excludedItemIds.map(id)); const options = []; const itemCache = new Map();
  for (const item of items) {
    const placement = placements.get(id(item._id)); if (!placement || excluded.has(id(item._id))) continue;
    const typeDefinition = typeDefs.get(item.itemType); if (typeDefinition && !(typeDefinition.capabilities || []).includes("visit_stop") && !(typeDefinition.capabilities || []).includes("spatial_placement")) {
      // A placement esplicita rimane fonte autorevole di visitabilita per vocabolari legacy.
      if (typeDefinition.capabilities?.length && !typeDefinition.capabilities.includes("semantic_context")) continue;
    }
    const revision = await ItemRevision.findById(item.publishedRevisionId).lean(); if (!revision || revision.integrity?.status !== "valid") continue;
    const itemProfile = await ItemObservationProfile.findOne({ itemId: item._id }).lean();
    const baseObservation = resolveObservationSeconds({ userProfile: context.userProfile, globalProfile: context.globalProfile, museumProfile: context.museumProfile, itemProfile });
    const observationFactor = 0.6 + context.dimensions.observationEmphasis.value * 0.8; const observationSeconds = Math.max(0, baseObservation * observationFactor);
    const representationCandidates = listRepresentationCandidates(revision); const scored = [];
    for (const candidate of representationCandidates) {
      const semanticExplicit = context.explicitInterests.reduce((sum, interest) => sum + explicitFeatureScore({ interest, item, revision, variant: candidate }), 0);
      const semanticLearned = learnedSemanticScore({ profile: context.userProfile, museumId: context.museumId, item, revision, variant: candidate });
      const aspects = aspectScores({ context, vocabulary, variant: candidate });
      const preference = representationPreferenceScore({ representation: candidate.representation, context, durationPositions, languagePositions });
      const targetSeconds = durationSeconds.get(candidate.representation.durationKey); if (!Number.isFinite(targetSeconds)) continue;
      const unseenBonus = seen.has(id(item._id)) ? 0 : context.dimensions.discovery.value * 0.35;
      const explicitTotal = semanticExplicit + aspects.explicit; const learnedTotal = semanticLearned + aspects.learned;
      const contentScore = explicitTotal * 2 + learnedTotal + preference.score + unseenBonus;
      const densityEfficiency = context.dimensions.visitDensity.value * (targetSeconds / Math.max(context.timeBudgetSeconds, 1));
      scored.push({
        item, revision, placement, variantKey: candidate.variantKey, representation: candidate.representation,
        semanticFocus: candidate.semanticFocus, presentationAspects: candidate.presentationAspects,
        targetSeconds, observationSeconds, baseUtility: contentScore - densityEfficiency,
        scoreBreakdown: { explicitInterest: explicitTotal, learnedInterest: learnedTotal, depthFit: preference.depthFit, languageFit: preference.languageFit, discovery: unseenBonus },
      });
    }
    scored.sort((a, b) => b.baseUtility - a.baseUtility || a.targetSeconds - b.targetSeconds);
    const kept = scored.slice(0, 3); for (const option of kept) options.push(option);
    itemCache.set(id(item._id), { item, revision });
  }
  return { options, itemCache };
}

async function generateVisitPlan({ userId, museumId, request, persist = true }) {
  const requestErrors = validateGenerationRequest(request || {});
  if (requestErrors.length) throw new AppError("Richiesta di generazione non valida", 400, requestErrors);
  const data = await loadGenerationData({ userId, museumId, request }); const { context, vocabulary, layoutRevision, seen, requirements, warnings } = data;
  const { options } = await buildCandidateOptions({ ...data });
  if (!options.length) throw new AppError("Nessun Item visitabile compatibile con il layout pubblicato", 409);
  const must = new Set(context.mustSeeItemIds.map(id)); const availableItems = new Set(options.map((option) => id(option.item._id)));
  const missingMust = [...must].filter((itemId) => !availableItems.has(itemId)); if (missingMust.length) throw new AppError("Alcuni must-see non sono disponibili come tappe visitabili", 409, missingMust.map((itemId) => ({ field: "mustSeeItemIds", code: "MUST_SEE_UNAVAILABLE", message: `Item non disponibile: ${itemId}` })));
  const startPlaceId = chooseStartPlace(layoutRevision, context.startPlaceId); const learnedResidualByConnection = await getLearnedResidualByConnection(layoutRevision); const routeCache = new Map();
  function routeBetween(fromPlaceId, toPlaceId) {
    if (!fromPlaceId) return { reachable: true, path: [], estimatedSeconds: 0, preferencePenalty: 0 };
    const key = `${id(fromPlaceId)}>${id(toPlaceId)}`; if (!routeCache.has(key)) routeCache.set(key, resolveRoute({ connections: layoutRevision.connections, fromPlaceId, toPlaceId, requirements, speedMps: context.effectiveMovementSpeedMps, learnedResidualByConnection })); return routeCache.get(key);
  }
  const reserveRatio = policy.generator.conservativeTimeReserveRatio * (1 - context.dimensions.timeRisk.value); const reservedSeconds = Math.round(context.timeBudgetSeconds * reserveRatio); const usableBudget = Math.max(1, context.timeBudgetSeconds - reservedSeconds);
  let beam = [{ selectedItemIds: new Set(), currentPlaceId: startPlaceId, stops: [], transitions: [], elapsedSeconds: 0, contentSeconds: 0, observationSeconds: 0, logisticsSeconds: 0, utility: 0, mustCovered: 0, itemTypeCounts: new Map(), lastOption: null }];
  const maxStops = Math.min(policy.generator.maxStops, Math.max(1, options.length));
  for (let depth = 0; depth < maxStops; depth += 1) {
    const expanded = [...beam];
    for (const state of beam) {
      const remaining = options.filter((option) => !state.selectedItemIds.has(id(option.item._id))).sort((a, b) => {
        const am = must.has(id(a.item._id)) ? 1 : 0; const bm = must.has(id(b.item._id)) ? 1 : 0; return bm - am || b.baseUtility - a.baseUtility;
      }).slice(0, policy.generator.branchCandidates + must.size);
      for (const option of remaining) {
        const route = routeBetween(state.currentPlaceId, option.placement.primaryPlaceId); if (!route.reachable) continue;
        const stopSeconds = option.targetSeconds + option.observationSeconds; const nextElapsed = state.elapsedSeconds + route.estimatedSeconds + stopSeconds; if (context.hardTimeBudget && nextElapsed > usableBudget) continue;
        const sameTypeCount = state.itemTypeCounts.get(option.item.itemType) || 0; const diversityPenalty = Math.max(0, sameTypeCount - 1) * 0.18; const coherence = relationCoherence(state.lastOption, option); const logisticsPenalty = (route.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight; const utility = state.utility + option.baseUtility + coherence - diversityPenalty - logisticsPenalty;
        const selected = new Set(state.selectedItemIds); selected.add(id(option.item._id)); const counts = new Map(state.itemTypeCounts); counts.set(option.item.itemType, sameTypeCount + 1);
        const transition = { fromStopIndex: state.stops.length - 1, toStopIndex: state.stops.length, fromPlaceId: state.currentPlaceId || null, toPlaceId: option.placement.primaryPlaceId, path: (route.path || []).map((entry) => entry.connectionId), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0 };
        expanded.push({ selectedItemIds: selected, currentPlaceId: option.placement.primaryPlaceId, stops: [...state.stops, option], transitions: [...state.transitions, transition], elapsedSeconds: nextElapsed, contentSeconds: state.contentSeconds + option.targetSeconds, observationSeconds: state.observationSeconds + option.observationSeconds, logisticsSeconds: state.logisticsSeconds + route.estimatedSeconds, utility, mustCovered: state.mustCovered + (must.has(id(option.item._id)) ? 1 : 0), itemTypeCounts: counts, lastOption: option });
      }
    }
    const nextBeam = pruneBeam(expanded, must.size, policy.generator.beamWidth); if (nextBeam.every((state) => state.stops.length <= depth)) break; beam = nextBeam;
  }
  let finals = beam.filter((state) => state.stops.length > 0 && state.mustCovered === must.size);
  if (context.endPlaceId) finals = finals.filter((state) => { const route = routeBetween(state.currentPlaceId, context.endPlaceId); return route.reachable && (!context.hardTimeBudget || state.elapsedSeconds + route.estimatedSeconds <= usableBudget); });
  finals.sort((a, b) => b.utility - a.utility || b.stops.length - a.stops.length || a.elapsedSeconds - b.elapsedSeconds);
  let best = finals[0]; if (!best) throw new AppError("I vincoli richiesti non sono compatibili con il tempo disponibile", 409, [{ field: "timeBudgetSeconds", code: "GENERATION_CONSTRAINT_CONFLICT", message: "Ridurre i must-see, aumentare il tempo o modificare i constraint" }]);

  function evaluateOrder(orderedStops) {
    const transitions = []; const counts = new Map(); let currentPlaceId = startPlaceId; let logisticsSeconds = 0; let contentSeconds = 0; let observationSeconds = 0; let utility = 0; let previous = null;
    for (let index = 0; index < orderedStops.length; index += 1) {
      const option = orderedStops[index]; const route = routeBetween(currentPlaceId, option.placement.primaryPlaceId); if (!route.reachable) return null;
      const sameTypeCount = counts.get(option.item.itemType) || 0; const diversityPenalty = Math.max(0, sameTypeCount - 1) * 0.18; const coherence = relationCoherence(previous, option); const logisticsPenalty = (route.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
      utility += option.baseUtility + coherence - diversityPenalty - logisticsPenalty; counts.set(option.item.itemType, sameTypeCount + 1);
      logisticsSeconds += route.estimatedSeconds; contentSeconds += option.targetSeconds; observationSeconds += option.observationSeconds;
      transitions.push({ fromStopIndex: index - 1, toStopIndex: index, fromPlaceId: currentPlaceId || null, toPlaceId: option.placement.primaryPlaceId, path: (route.path || []).map((entry) => entry.connectionId), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0 });
      currentPlaceId = option.placement.primaryPlaceId; previous = option;
    }
    if (context.endPlaceId) {
      const endRoute = routeBetween(currentPlaceId, context.endPlaceId); if (!endRoute.reachable) return null;
      logisticsSeconds += endRoute.estimatedSeconds; utility -= (endRoute.estimatedSeconds / Math.max(usableBudget, 1)) * policy.generator.logisticsUtilityWeight;
      transitions.push({ fromStopIndex: orderedStops.length - 1, toStopIndex: orderedStops.length, fromPlaceId: currentPlaceId, toPlaceId: context.endPlaceId, path: (endRoute.path || []).map((entry) => entry.connectionId), estimatedSeconds: Math.round(endRoute.estimatedSeconds), preferencePenalty: endRoute.preferencePenalty || 0 });
      currentPlaceId = context.endPlaceId;
    }
    const elapsedSeconds = contentSeconds + observationSeconds + logisticsSeconds; if (context.hardTimeBudget && elapsedSeconds > usableBudget) return null;
    return { selectedItemIds: new Set(orderedStops.map((option) => id(option.item._id))), currentPlaceId, stops: orderedStops, transitions, elapsedSeconds, contentSeconds, observationSeconds, logisticsSeconds, utility, mustCovered: orderedStops.filter((option) => must.has(id(option.item._id))).length, itemTypeCounts: counts, lastOption: orderedStops.at(-1) || null };
  }

  const initialOrdered = evaluateOrder(best.stops); if (initialOrdered) best = initialOrdered;
  for (let pass = 0; pass < policy.generator.localImprovementPasses; pass += 1) {
    let improved = best;
    for (let left = 0; left < best.stops.length - 1; left += 1) {
      for (let right = left + 1; right < best.stops.length; right += 1) {
        const reordered = [...best.stops.slice(0, left), ...best.stops.slice(left, right + 1).reverse(), ...best.stops.slice(right + 1)];
        const candidate = evaluateOrder(reordered); if (!candidate) continue;
        if (candidate.utility > improved.utility + 1e-9 || (Math.abs(candidate.utility - improved.utility) < 1e-9 && candidate.elapsedSeconds < improved.elapsedSeconds)) improved = candidate;
      }
    }
    if (improved === best) break; best = improved;
  }
  const stops = best.stops.map((option) => ({ itemId: option.item._id, itemRevisionId: option.revision._id, variantKey: option.variantKey, representationId: option.representation._id || null, durationKey: option.representation.durationKey, languageLevelKey: option.representation.languageLevelKey, estimatedContentSeconds: Math.round(option.targetSeconds), estimatedObservationSeconds: Math.round(option.observationSeconds), utilityScore: option.baseUtility, scoreBreakdown: option.scoreBreakdown, reasons: buildReasons(option) }));
  const doc = { userId, museumId, requestSnapshot: { ...request, timeBudgetSeconds: context.timeBudgetSeconds }, contextSnapshot: { dimensions: context.dimensions, movementBaselineMps: context.movementBaselineMps, paceFactor: context.paceFactor, effectiveMovementSpeedMps: context.effectiveMovementSpeedMps, navigationRequirements: context.navigationRequirements }, sourceVocabularyRevisionId: vocabulary.vocabularyRevisionId || null, sourceLayoutRevisionId: layoutRevision._id, adaptivePolicyVersion: policy.version, stops, transitions: best.transitions, estimatedTiming: { contentSeconds: Math.round(best.contentSeconds), observationSeconds: Math.round(best.observationSeconds), logisticsSeconds: Math.round(best.logisticsSeconds), totalSeconds: Math.round(best.elapsedSeconds), reservedSeconds }, utilityScore: best.utility, explanation: { warnings, usedLearnedHistory: Boolean(context.userProfile), currentRequestPriority: true, generatedBy: "adaptive_beam_search_local_improvement_v1" } };
  if (!persist) return doc;
  return GeneratedVisitPlan.create(doc);
}

function buildReasons(option) {
  const reasons = [];
  if (option.scoreBreakdown.explicitInterest > 0) reasons.push({ source: "current_request", message: "La tappa corrisponde agli interessi indicati per questa visita", confidence: 1 });
  if (option.scoreBreakdown.learnedInterest > 0.05) reasons.push({ source: "user_history", message: "La tappa e coerente con preferenze apprese dalle visite precedenti", confidence: clamp(Math.abs(option.scoreBreakdown.learnedInterest)) });
  if (option.scoreBreakdown.discovery > 0) reasons.push({ source: "discovery", message: "Introduce un elemento nuovo coerente con la preferenza di scoperta", confidence: 1 });
  return reasons;
}

async function getGeneratedPlan({ planId, userId }) { const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId }); if (!plan) throw new AppError("Piano generato non trovato", 404); return plan; }
async function acceptGeneratedPlan({ planId, userId }) { const plan = await getGeneratedPlan({ planId, userId }); plan.status = "accepted"; plan.acceptedAt = new Date(); await plan.save(); return plan; }

module.exports = { explicitFeatureScore, relationCoherence, pruneBeam, generateVisitPlan, getGeneratedPlan, acceptGeneratedPlan };
