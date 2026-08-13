const User = require("../models/user");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const UserGenerationPreference = require("../models/userGenerationPreference.model");
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
  const [user, profile, declaredGenerator, population] = await Promise.all([User.findOne({ _id: userId, status: "active" }).lean(), UserAdaptiveProfile.findOne({ userId }).lean(), UserGenerationPreference.findOne({ userId }).lean(), loadPopulationProfiles(museumId)]);
  if (!user) throw new AppError("Utente attivo non trovato", 404);
  const timeBudgetSeconds = Number(request.timeBudgetSeconds);
  if (!Number.isFinite(timeBudgetSeconds) || timeBudgetSeconds <= 0) throw new AppError("timeBudgetSeconds deve essere positivo", 400);
  const depth = resolveScalar({ explicit: request.depthPreference, declared: declaredGenerator?.depthPreference ?? user.defaultPresentationPreference?.depthPreference, learned: profile?.presentation?.depthPreference, fallback: 0.5, name: "depthPreference" });
  const language = resolveScalar({ explicit: request.languageComplexityPreference, declared: declaredGenerator?.languageComplexityPreference ?? user.defaultPresentationPreference?.languageComplexityPreference, learned: profile?.presentation?.languageComplexityPreference, fallback: 0.5, name: "languageComplexityPreference" });
  const movement = resolveScalar({ explicit: request.movementPacePreference, declared: declaredGenerator?.movementPacePreference ?? user.defaultNavigationPreference?.movementPacePreference, learned: null, fallback: 0.5, name: "movementPacePreference" });
  const learnedMore = usable(profile?.behavior?.depthIncreaseRequestRate) ? profile.behavior.depthIncreaseRequestRate.value : null;
  const learnedSkip = usable(profile?.behavior?.optionalContentEntrySkipRate) ? profile.behavior.optionalContentEntrySkipRate.value : null;
  const densityFallback = clamp(0.5 + (Number(learnedSkip) || 0) * 0.25 - (Number(learnedMore) || 0) * 0.25);
  const visitDensity = resolveScalar({ explicit: request.visitDensity, declared: declaredGenerator?.visitDensity, learned: null, fallback: densityFallback, name: "visitDensity" });
  if (request.visitDensity === undefined && declaredGenerator?.visitDensity == null && (learnedMore !== null || learnedSkip !== null)) { visitDensity.source = "learned_history"; visitDensity.confidence = Math.max(profile?.behavior?.depthIncreaseRequestRate?.confidence || 0, profile?.behavior?.optionalContentEntrySkipRate?.confidence || 0); }
  const observationEmphasis = resolveScalar({ explicit: request.observationEmphasis, declared: declaredGenerator?.observationEmphasis, learned: null, fallback: 0.5, name: "observationEmphasis" });
  const discovery = resolveScalar({ explicit: request.discoveryPreference, declared: declaredGenerator?.discoveryPreference, learned: null, fallback: 0.25, name: "discoveryPreference" });
  const timeRisk = resolveScalar({ explicit: request.timeRiskTolerance, declared: declaredGenerator?.timeRiskTolerance, learned: null, fallback: 0.25, name: "timeRiskTolerance" });
  const movementBaselineMps = resolveMovementBaseline({ userProfile: profile, globalProfile: population.globalProfile });
  const paceFactor = resolvePaceFactor({ preference: movement.value, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
  const effectiveMovementSpeedMps = Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, movementBaselineMps * paceFactor));
  const learnedObservationSeconds = resolveObservationSeconds({ userProfile: profile, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
  const observationFactor = 0.6 + observationEmphasis.value * 0.8;
  const explicitInterests = Array.isArray(request.interests) ? request.interests : (declaredGenerator?.interests || []);
  const navigationRequirements = Array.isArray(request.navigationRequirements) ? request.navigationRequirements : (declaredGenerator?.navigationRequirements?.length ? declaredGenerator.navigationRequirements : (user.defaultNavigationPreference?.requirements || []));
  return { userId, museumId, timeBudgetSeconds, hardTimeBudget: request.hardTimeBudget !== false, dimensions: { depth, language, movement, visitDensity, observationEmphasis, discovery, timeRisk }, navigationRequirements, explicitInterests, mustIncludeItemIds: Array.isArray(request.mustIncludeItemIds) ? request.mustIncludeItemIds : [], mustVisitItemIds: Array.isArray(request.mustVisitItemIds) ? request.mustVisitItemIds : [], excludedItemIds: Array.isArray(request.excludedItemIds) ? request.excludedItemIds : [], startPlaceId: request.startPlaceId || null, endPlaceId: request.endPlaceId || null, movementBaselineMps, paceFactor, effectiveMovementSpeedMps, observationBaselineSeconds: learnedObservationSeconds * observationFactor, userProfile: profile, globalProfile: population.globalProfile, museumProfile: population.museumProfile };
}
module.exports = { resolveExperienceContext, resolveScalar };
