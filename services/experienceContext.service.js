const User = require("../models/user");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { loadPopulationProfiles, resolveMovementBaseline, resolvePaceFactor, resolveObservationSeconds, usable } = require("./adaptiveEstimation.service");

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function resolveScalar({ explicit, declared, learned, fallback = 0.5, name }) {
  if (numberOrNull(explicit) !== null) return { value: clamp(Number(explicit)), source: "current_request", confidence: 1, name };
  if (numberOrNull(declared) !== null) return { value: clamp(Number(declared)), source: "declared_default", confidence: 1, name };
  if (usable(learned)) return { value: clamp(Number(learned.value)), source: "learned_history", confidence: Number(learned.confidence), name };
  return { value: fallback, source: "fallback", confidence: 0, name };
}

async function resolveExperienceContext({ userId, museumId, request = {} }) {
  const [user, profile, population] = await Promise.all([
    User.findOne({ _id: userId, status: "active" }).lean(),
    UserAdaptiveProfile.findOne({ userId }).lean(),
    loadPopulationProfiles(museumId),
  ]);
  if (!user) throw new AppError("Utente attivo non trovato", 404);
  const timeBudgetSeconds = Number(request.timeBudgetSeconds);
  if (!Number.isFinite(timeBudgetSeconds) || timeBudgetSeconds <= 0) throw new AppError("timeBudgetSeconds deve essere positivo", 400);

  const depth = resolveScalar({ explicit: request.depthPreference, declared: user.defaultPresentationPreference?.depthPreference, learned: profile?.presentation?.depthPreference, fallback: 0.5, name: "depthPreference" });
  const language = resolveScalar({ explicit: request.languageComplexityPreference, declared: user.defaultPresentationPreference?.languageComplexityPreference, learned: profile?.presentation?.languageComplexityPreference, fallback: 0.5, name: "languageComplexityPreference" });
  const movement = resolveScalar({ explicit: request.movementPacePreference, declared: user.defaultNavigationPreference?.movementPacePreference, learned: null, fallback: 0.5, name: "movementPacePreference" });
  const learnedMore = usable(profile?.behavior?.moreDetailRequestRate) ? profile.behavior.moreDetailRequestRate.value : null;
  const learnedSkip = usable(profile?.behavior?.optionalStopSkipRate) ? profile.behavior.optionalStopSkipRate.value : null;
  const densityFallback = clamp(0.5 + (Number(learnedSkip) || 0) * 0.25 - (Number(learnedMore) || 0) * 0.25);
  const visitDensity = resolveScalar({ explicit: request.visitDensity, declared: null, learned: null, fallback: densityFallback, name: "visitDensity" });
  if (request.visitDensity === undefined && (learnedMore !== null || learnedSkip !== null)) { visitDensity.source = "learned_history"; visitDensity.confidence = Math.max(profile?.behavior?.moreDetailRequestRate?.confidence || 0, profile?.behavior?.optionalStopSkipRate?.confidence || 0); }
  const observationEmphasis = resolveScalar({ explicit: request.observationEmphasis, declared: null, learned: null, fallback: 0.5, name: "observationEmphasis" });
  const discovery = resolveScalar({ explicit: request.discoveryPreference, declared: null, learned: null, fallback: 0.25, name: "discoveryPreference" });
  const timeRisk = resolveScalar({ explicit: request.timeRiskTolerance, declared: null, learned: null, fallback: 0.25, name: "timeRiskTolerance" });

  const movementBaselineMps = resolveMovementBaseline({ userProfile: profile, globalProfile: population.globalProfile });
  const paceFactor = resolvePaceFactor({ preference: movement.value, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
  const effectiveMovementSpeedMps = Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, movementBaselineMps * paceFactor));
  const learnedObservationSeconds = resolveObservationSeconds({ userProfile: profile, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
  const observationFactor = 0.6 + observationEmphasis.value * 0.8;

  return {
    userId,
    museumId,
    timeBudgetSeconds,
    hardTimeBudget: request.hardTimeBudget !== false,
    dimensions: { depth, language, movement, visitDensity, observationEmphasis, discovery, timeRisk },
    navigationRequirements: Array.isArray(request.navigationRequirements) ? request.navigationRequirements : (user.defaultNavigationPreference?.requirements || []),
    explicitInterests: Array.isArray(request.interests) ? request.interests : [],
    mustSeeItemIds: Array.isArray(request.mustSeeItemIds) ? request.mustSeeItemIds : [],
    excludedItemIds: Array.isArray(request.excludedItemIds) ? request.excludedItemIds : [],
    startPlaceId: request.startPlaceId || null,
    endPlaceId: request.endPlaceId || null,
    movementBaselineMps,
    paceFactor,
    effectiveMovementSpeedMps,
    observationBaselineSeconds: learnedObservationSeconds * observationFactor,
    userProfile: profile,
    globalProfile: population.globalProfile,
    museumProfile: population.museumProfile,
  };
}

module.exports = { resolveExperienceContext, resolveScalar };
