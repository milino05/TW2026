const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const User = require("../models/user");
const UserVisitPreference = require("../models/userVisitPreference.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const VisitTimingProfile = require("../models/visitTimingProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { buildPresentationPlan } = require("./userPreference.service");
const { loadPopulationProfiles, resolveMovementBaseline, resolvePaceFactor, resolveObservationSeconds } = require("./adaptiveEstimation.service");
const { newObjectId, timingFromPlan } = require("./physicalRoute.service");
const { translateRequirements, materializePhysicalRoute } = require("./visitPhysicalRoute.service");

function mergeNavigationPreference(user, visitPreference, override = {}) {
  const global = user?.defaultNavigationPreference || {};
  const local = visitPreference?.navigation || {};
  return {
    movementPacePreference: Number.isFinite(Number(override.movementPacePreference)) ? Math.max(0, Math.min(1, Number(override.movementPacePreference))) : (Number.isFinite(local.movementPacePreference) ? local.movementPacePreference : (global.movementPacePreference ?? 0.5)),
    requirements: Array.isArray(override.requirements) ? override.requirements : (Array.isArray(local.requirements) && local.requirements.length ? local.requirements : (global.requirements || [])),
    startPlaceId: override.startPlaceId || null,
  };
}

async function buildLogisticsPlan({ userId, visitId, navigationOverride = {} }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
  if (!revision) throw new AppError("Revisione pubblicata della visita non trovata", 404);
  const [user, visitPreference, adaptiveProfile, presentationPlan, timingProfile, globalPopulation] = await Promise.all([
    User.findById(userId).lean(),
    UserVisitPreference.findOne({ userId, visitId }).lean(),
    UserAdaptiveProfile.findOne({ userId }).lean(),
    buildPresentationPlan({ userId, visitId }),
    VisitTimingProfile.findOne({ visitRevisionId: revision._id }).lean(),
    loadPopulationProfiles(null),
  ]);
  const navigation = mergeNavigationPreference(user, visitPreference, navigationOverride);
  const movementBaselineMps = resolveMovementBaseline({ userProfile: adaptiveProfile, globalProfile: globalPopulation.globalProfile });
  const paceFactor = resolvePaceFactor({ preference: navigation.movementPacePreference, globalProfile: globalPopulation.globalProfile });
  const effectiveMovementSpeedMps = Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, movementBaselineMps * paceFactor));
  const observationBaselineSeconds = resolveObservationSeconds({ userProfile: adaptiveProfile, globalProfile: globalPopulation.globalProfile });
  const materialized = presentationPlan.contentEntries.map((entry) => ({
    _id: newObjectId(),
    sourceContentEntryId: entry.sourceContentEntryId,
    itemId: entry.itemId,
    itemRevisionId: entry.itemRevisionId,
    museumId: entry.museumId,
    role: entry.role,
    spatialMode: entry.spatialMode,
    deliveryAnchorId: null,
    variantKey: entry.variantKey,
    representationId: entry.representation?._id || null,
    durationKey: entry.representation.durationKey,
    languageLevelKey: entry.representation.languageLevelKey,
    estimatedContentSeconds: entry.targetSeconds || 0,
    utilityScore: 0,
    scoreBreakdown: {},
    reasons: [{ source: "visit_source", message: visit.kind === "official" ? "Contenuto della visita ufficiale" : "Contenuto della visita community", confidence: 1 }],
  }));
  const routeResult = await materializePhysicalRoute({ contentEntries: materialized, sourceRevision: revision, adaptiveProfile, navigation, defaultMovementSpeedMps: effectiveMovementSpeedMps });
  const timing = timingFromPlan(routeResult.contentEntries, routeResult.physicalRoute);
  const learnedVisitResidual = timingProfile && timingProfile.confidence >= policy.confidence.usableThreshold ? timingProfile.typicalResidualSeconds * Math.min(0.8, timingProfile.confidence) : 0;
  return {
    visitId: visit._id,
    visitRevisionId: revision._id,
    adaptivePolicyVersion: policy.version,
    presentationPlan: { ...presentationPlan, contentEntries: routeResult.contentEntries },
    contentEntries: routeResult.contentEntries,
    physicalRoute: routeResult.physicalRoute,
    sourceLayoutRevisionIds: routeResult.sourceLayoutRevisionIds,
    navigation,
    movementBaselineMps,
    paceFactor,
    effectiveMovementSpeedMps,
    observationBaselineSeconds,
    estimatedContentSeconds: timing.contentSeconds,
    estimatedObservationSeconds: timing.observationSeconds,
    estimatedLogisticsSeconds: timing.logisticsSeconds,
    estimatedBaseTotalSeconds: timing.totalSeconds,
    estimatedVisitResidualSeconds: Math.round(learnedVisitResidual),
    estimatedTotalSeconds: Math.round(Math.max(0, timing.totalSeconds + learnedVisitResidual)),
    typicalVisitRange: timingProfile?.confidence >= policy.confidence.usableThreshold ? { lowerSeconds: timingProfile.lowerTypicalSeconds, upperSeconds: timingProfile.upperTypicalSeconds, confidence: timingProfile.confidence } : null,
    warnings: routeResult.warnings,
  };
}

module.exports = { mergeNavigationPreference, translateRequirements, buildLogisticsPlan };
