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
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { validateGenerationRequest } = require("./validation/generation.validation");
const { translateRequirements, chooseEntrance } = require("./visitPhysicalRoute.service");
const { optimizeVisit } = require("./visitGeneratorSearch.service");
const { id, explicitFeatureScore, learnedSemanticScore, aspectScores, representationPreferenceScore, relationCoherence, pruneBeam, buildReasons } = require("./visitGeneratorSemantics.service");

function interestKey(interest) {
  if (interest.kind === "item") return `item:${id(interest.itemId)}`;
  if (interest.kind === "canonical") return `canonical:${String(interest.scheme || "").toLowerCase()}:${interest.id || interest.refId}`;
  return `${interest.kind}:${interest.key || ""}`;
}
function itemTypeDefinition(vocabulary, itemType) { return (vocabulary.itemTypeDefinitions || []).find((entry) => entry.key === itemType) || null; }
async function loadGenerationData({ userId, museumId, request }) {
  const [context, vocabulary, layout, items, seenItemIds] = await Promise.all([
    resolveExperienceContext({ userId, museumId, request }),
    getMuseumVocabulary(museumId),
    MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
    Item.find({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
    VisitSession.find({ userId, status: "completed" }).distinct("contentEntryExperiences.itemId"),
  ]);
  const layoutRevision = layout ? await MuseumLayoutRevision.findById(layout.publishedRevisionId).lean() : null;
  if (layoutRevision && layoutRevision.integrity?.status !== "valid") throw new AppError("Il layout pubblicato non e integro", 409);
  const translated = layoutRevision ? translateRequirements(layoutRevision, context.navigationRequirements) : { requirements: [], warnings: [], unsupportedRequired: [] };
  return { context, vocabulary, layoutRevision, items, seen: new Set(seenItemIds.map(id)), requirements: translated.requirements, warnings: translated.warnings };
}

async function buildCandidateOptions({ context, vocabulary, layoutRevision, items, seen }) {
  const placements = new Map((layoutRevision?.itemPlacements || []).map((entry) => [id(entry.itemId), entry]));
  const durationPositions = buildPositionMap(vocabulary.durationTypes), languagePositions = buildPositionMap(vocabulary.languageLevels), durationSeconds = buildDurationSecondsMap(vocabulary.durationTypes);
  const excluded = new Set(context.excludedItemIds.map(id)), options = [];
  for (const item of items) {
    if (excluded.has(id(item._id))) continue;
    const type = itemTypeDefinition(vocabulary, item.itemType);
    const capabilities = new Set(type?.capabilities || []);
    const canContext = capabilities.has("semantic_context"), placement = placements.get(id(item._id));
    const canTarget = capabilities.has("navigation_target") && Boolean(placement?.primaryPlaceId) && Boolean(layoutRevision);
    if (!canContext && !canTarget) continue;
    const revision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!revision || revision.integrity?.status !== "valid") continue;
    const itemProfile = canTarget ? await ItemObservationProfile.findOne({ itemId: item._id }).lean() : null;
    const observationSeconds = canTarget ? Math.max(0, resolveObservationSeconds({ userProfile: context.userProfile, globalProfile: context.globalProfile, museumProfile: context.museumProfile, itemProfile }) * (0.6 + context.dimensions.observationEmphasis.value * 0.8)) : 0;
    const scored = [];
    for (const candidate of listRepresentationCandidates(revision)) {
      let semanticExplicit = 0;
      const coverageKeys = [];
      for (const interest of context.explicitInterests) {
        const score = explicitFeatureScore({ interest, item, revision, variant: candidate, vocabulary });
        semanticExplicit += score;
        if (score > 0) coverageKeys.push(interestKey(interest));
      }
      const semanticLearned = learnedSemanticScore({ profile: context.userProfile, museumId: context.museumId, item, revision, variant: candidate, vocabulary });
      const aspects = aspectScores({ context, vocabulary, variant: candidate });
      const preference = representationPreferenceScore({ representation: candidate.representation, context, durationPositions, languagePositions });
      const targetSeconds = durationSeconds.get(candidate.representation.durationKey);
      if (!Number.isFinite(targetSeconds)) continue;
      const unseenBonus = seen.has(id(item._id)) ? 0 : context.dimensions.discovery.value * 0.35;
      const explicitTotal = semanticExplicit + aspects.explicit;
      const learnedTotal = semanticLearned + aspects.learned;
      const densityPenalty = context.dimensions.visitDensity.value * (targetSeconds / Math.max(context.timeBudgetSeconds, 1));
      const common = { item, revision, variantKey: candidate.variantKey, representation: candidate.representation, semanticFocus: candidate.semanticFocus, presentationAspects: candidate.presentationAspects, targetSeconds, coverageKeys: [...new Set(coverageKeys)], scoreBreakdown: { explicitInterest: explicitTotal, learnedInterest: learnedTotal, depthFit: preference.depthFit, languageFit: preference.languageFit, discovery: unseenBonus } };
      const nonExplicitBase = learnedTotal + preference.score + unseenBonus - densityPenalty;
      if (canContext) scored.push({ ...common, spatialMode: "context", placement: null, observationSeconds: 0, explicitUtility: explicitTotal * 2, nonExplicitUtility: nonExplicitBase, baseUtility: explicitTotal * 2 + nonExplicitBase });
      if (canTarget) {
        const inSitu = policy.generator.inSituUtilityWeight * (0.5 + context.dimensions.observationEmphasis.value) + policy.generator.targetDensityUtilityWeight * context.dimensions.visitDensity.value;
        scored.push({ ...common, spatialMode: "target", placement, observationSeconds, explicitUtility: explicitTotal * 2, nonExplicitUtility: nonExplicitBase + inSitu, baseUtility: explicitTotal * 2 + nonExplicitBase + inSitu, scoreBreakdown: { ...common.scoreBreakdown, inSitu } });
      }
    }
    scored.sort((a, b) => b.baseUtility - a.baseUtility || a.targetSeconds - b.targetSeconds);
    const byMode = new Map();
    for (const option of scored) {
      const count = byMode.get(option.spatialMode) || 0;
      if (count < 3) { options.push(option); byMode.set(option.spatialMode, count + 1); }
    }
  }
  return { options };
}

async function generateVisitPlan({ userId, museumId, request, persist = true }) {
  const requestErrors = validateGenerationRequest(request || {});
  if (requestErrors.length) throw new AppError("Richiesta di generazione non valida", 400, requestErrors);
  const data = await loadGenerationData({ userId, museumId, request });
  const { context, vocabulary, layoutRevision, requirements, warnings } = data;
  const { options } = await buildCandidateOptions(data);
  if (!options.length) throw new AppError("Nessun contenuto compatibile disponibile per la generazione", 409);
  if (layoutRevision && requirements.length === 0 && context.navigationRequirements.some((entry) => entry.priority === "required")) warnings.push({ code: "REQUIRED_ROUTING_ATTRIBUTE_NOT_RESOLVED" });
  const startPlaceId = layoutRevision ? chooseEntrance(layoutRevision, context.startPlaceId) : null;
  const learnedResidualByConnection = layoutRevision ? await getLearnedResidualByConnection(layoutRevision) : new Map();
  const { best, reservedSeconds } = optimizeVisit({ options, context, layoutRevision, requirements, learnedResidualByConnection, startPlaceId });
  const contentEntries = best.entries.map((entry) => {
    const option = entry.option;
    const itemId = id(option.item._id);
    return {
      _id: entry._id,
      itemId: option.item._id,
      itemRevisionId: option.revision._id,
      museumId,
      role: (context.mustIncludeItemIds || []).map(id).includes(itemId) || (context.mustVisitItemIds || []).map(id).includes(itemId) ? "core" : "recommended",
      spatialMode: option.spatialMode,
      deliveryAnchorId: entry.deliveryAnchorId,
      variantKey: option.variantKey,
      representationId: option.representation._id || null,
      durationKey: option.representation.durationKey,
      languageLevelKey: option.representation.languageLevelKey,
      estimatedContentSeconds: Math.round(option.targetSeconds),
      utilityScore: option.baseUtility,
      scoreBreakdown: option.scoreBreakdown,
      reasons: buildReasons(option),
    };
  });
  const physicalRoute = { anchors: best.anchors, legs: best.legs };
  const document = {
    userId,
    museumId,
    requestSnapshot: { ...request, timeBudgetSeconds: context.timeBudgetSeconds },
    contextSnapshot: { dimensions: context.dimensions, movementBaselineMps: context.movementBaselineMps, paceFactor: context.paceFactor, effectiveMovementSpeedMps: context.effectiveMovementSpeedMps, observationBaselineSeconds: context.observationBaselineSeconds, navigationRequirements: context.navigationRequirements },
    sourceVocabularyRevisionId: vocabulary.vocabularyRevisionId || null,
    sourceLayoutRevisionId: layoutRevision?._id || null,
    adaptivePolicyVersion: policy.version,
    contentEntries,
    physicalRoute,
    estimatedTiming: { contentSeconds: Math.round(best.contentSeconds), observationSeconds: Math.round(best.observationSeconds), logisticsSeconds: Math.round(best.logisticsSeconds), totalSeconds: Math.round(best.elapsedSeconds), reservedSeconds },
    utilityScore: best.utility,
    explanation: { warnings: [...warnings, ...(!layoutRevision ? [{ code: "NO_LAYOUT_CONTEXT_ONLY_GENERATION" }] : [])], usedLearnedHistory: Boolean(context.userProfile), currentRequestPriority: true, generatedBy: "adaptive_content_route_beam_v3" },
  };
  return persist ? GeneratedVisitPlan.create(document) : document;
}
async function getGeneratedPlan({ planId, userId }) { const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId }); if (!plan) throw new AppError("Piano generato non trovato", 404); return plan; }
async function acceptGeneratedPlan({ planId, userId }) { const plan = await getGeneratedPlan({ planId, userId }); plan.status = "accepted"; plan.acceptedAt = new Date(); await plan.save(); return plan; }

module.exports = { explicitFeatureScore, learnedSemanticScore, relationCoherence, pruneBeam, buildCandidateOptions, generateVisitPlan, getGeneratedPlan, acceptGeneratedPlan };
