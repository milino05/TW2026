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
const { translateRequirements } = require("./logisticsPlan.service");
const { validateGenerationRequest } = require("./validation/generation.validation");
const { optimizeVisit } = require("./visitGeneratorSearch.service");
const {
  id,
  explicitFeatureScore,
  learnedSemanticScore,
  aspectScores,
  representationPreferenceScore,
  relationCoherence,
  pruneBeam,
  buildReasons,
} = require("./visitGeneratorSemantics.service");

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
  if (translated.unsupportedRequired.length) {
    throw new AppError("Il museo non dichiara attributi necessari per la visita richiesta", 409, translated.unsupportedRequired.map((attributeKey) => ({
      field: "navigationRequirements",
      code: "REQUIRED_ATTRIBUTE_UNSUPPORTED",
      message: `Attributo richiesto non supportato: ${attributeKey}`,
    })));
  }
  return {
    context,
    vocabulary,
    layoutRevision,
    items,
    seen: new Set(seenItemIds.map(id)),
    requirements: translated.requirements,
    warnings: translated.warnings,
  };
}

async function buildCandidateOptions({ context, vocabulary, layoutRevision, items, seen }) {
  const placements = new Map((layoutRevision.itemPlacements || []).map((entry) => [id(entry.itemId), entry]));
  const typeDefinitions = new Map((vocabulary.itemTypeDefinitions || []).map((entry) => [entry.key, entry]));
  const durationPositions = buildPositionMap(vocabulary.durationTypes);
  const languagePositions = buildPositionMap(vocabulary.languageLevels);
  const durationSeconds = buildDurationSecondsMap(vocabulary.durationTypes);
  const excluded = new Set(context.excludedItemIds.map(id));
  const options = [];

  for (const item of items) {
    const placement = placements.get(id(item._id));
    if (!placement || excluded.has(id(item._id))) continue;
    const itemType = typeDefinitions.get(item.itemType);
    if (!itemType || !(itemType.capabilities || []).includes("visit_stop")) continue;
    const revision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!revision || revision.integrity?.status !== "valid") continue;
    const itemProfile = await ItemObservationProfile.findOne({ itemId: item._id }).lean();
    const baseObservation = resolveObservationSeconds({
      userProfile: context.userProfile,
      globalProfile: context.globalProfile,
      museumProfile: context.museumProfile,
      itemProfile,
    });
    const observationSeconds = Math.max(0, baseObservation * (0.6 + context.dimensions.observationEmphasis.value * 0.8));
    const scored = [];

    for (const candidate of listRepresentationCandidates(revision)) {
      const semanticExplicit = context.explicitInterests.reduce((sum, interest) => sum + explicitFeatureScore({ interest, item, revision, variant: candidate, vocabulary }), 0);
      const semanticLearned = learnedSemanticScore({ profile: context.userProfile, museumId: context.museumId, item, revision, variant: candidate, vocabulary });
      const aspects = aspectScores({ context, vocabulary, variant: candidate });
      const preference = representationPreferenceScore({ representation: candidate.representation, context, durationPositions, languagePositions });
      const targetSeconds = durationSeconds.get(candidate.representation.durationKey);
      if (!Number.isFinite(targetSeconds)) continue;
      const unseenBonus = seen.has(id(item._id)) ? 0 : context.dimensions.discovery.value * 0.35;
      const explicitTotal = semanticExplicit + aspects.explicit;
      const learnedTotal = semanticLearned + aspects.learned;
      const densityPenalty = context.dimensions.visitDensity.value * (targetSeconds / Math.max(context.timeBudgetSeconds, 1));
      scored.push({
        item,
        revision,
        placement,
        variantKey: candidate.variantKey,
        representation: candidate.representation,
        semanticFocus: candidate.semanticFocus,
        presentationAspects: candidate.presentationAspects,
        targetSeconds,
        observationSeconds,
        baseUtility: explicitTotal * 2 + learnedTotal + preference.score + unseenBonus - densityPenalty,
        scoreBreakdown: {
          explicitInterest: explicitTotal,
          learnedInterest: learnedTotal,
          depthFit: preference.depthFit,
          languageFit: preference.languageFit,
          discovery: unseenBonus,
        },
      });
    }
    scored.sort((a, b) => b.baseUtility - a.baseUtility || a.targetSeconds - b.targetSeconds);
    options.push(...scored.slice(0, 3));
  }
  return { options };
}

async function generateVisitPlan({ userId, museumId, request, persist = true }) {
  const requestErrors = validateGenerationRequest(request || {});
  if (requestErrors.length) throw new AppError("Richiesta di generazione non valida", 400, requestErrors);
  const data = await loadGenerationData({ userId, museumId, request });
  const { context, vocabulary, layoutRevision, requirements, warnings } = data;
  const { options } = await buildCandidateOptions(data);
  if (!options.length) throw new AppError("Nessun Item con capability visit_stop e placement compatibile nel layout pubblicato", 409);

  const startPlaceId = chooseStartPlace(layoutRevision, context.startPlaceId);
  const learnedResidualByConnection = await getLearnedResidualByConnection(layoutRevision);
  const { best, reservedSeconds } = optimizeVisit({
    options,
    context,
    layoutRevision,
    requirements,
    learnedResidualByConnection,
    startPlaceId,
  });
  const stops = best.stops.map((option) => ({
    itemId: option.item._id,
    itemRevisionId: option.revision._id,
    variantKey: option.variantKey,
    representationId: option.representation._id || null,
    durationKey: option.representation.durationKey,
    languageLevelKey: option.representation.languageLevelKey,
    estimatedContentSeconds: Math.round(option.targetSeconds),
    estimatedObservationSeconds: Math.round(option.observationSeconds),
    utilityScore: option.baseUtility,
    scoreBreakdown: option.scoreBreakdown,
    reasons: buildReasons(option),
  }));
  const document = {
    userId,
    museumId,
    requestSnapshot: { ...request, timeBudgetSeconds: context.timeBudgetSeconds },
    contextSnapshot: {
      dimensions: context.dimensions,
      movementBaselineMps: context.movementBaselineMps,
      paceFactor: context.paceFactor,
      effectiveMovementSpeedMps: context.effectiveMovementSpeedMps,
      observationBaselineSeconds: context.observationBaselineSeconds,
      navigationRequirements: context.navigationRequirements,
    },
    sourceVocabularyRevisionId: vocabulary.vocabularyRevisionId || null,
    sourceLayoutRevisionId: layoutRevision._id,
    adaptivePolicyVersion: policy.version,
    stops,
    transitions: best.transitions,
    estimatedTiming: {
      contentSeconds: Math.round(best.contentSeconds),
      observationSeconds: Math.round(best.observationSeconds),
      logisticsSeconds: Math.round(best.logisticsSeconds),
      totalSeconds: Math.round(best.elapsedSeconds),
      reservedSeconds,
    },
    utilityScore: best.utility,
    explanation: {
      warnings,
      usedLearnedHistory: Boolean(context.userProfile),
      currentRequestPriority: true,
      generatedBy: "adaptive_beam_search_local_improvement_v2",
    },
  };
  return persist ? GeneratedVisitPlan.create(document) : document;
}

async function getGeneratedPlan({ planId, userId }) {
  const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("Piano generato non trovato", 404);
  return plan;
}
async function acceptGeneratedPlan({ planId, userId }) {
  const plan = await getGeneratedPlan({ planId, userId });
  plan.status = "accepted";
  plan.acceptedAt = new Date();
  await plan.save();
  return plan;
}

module.exports = {
  explicitFeatureScore,
  learnedSemanticScore,
  relationCoherence,
  pruneBeam,
  buildCandidateOptions,
  generateVisitPlan,
  getGeneratedPlan,
  acceptGeneratedPlan,
};
