const Item = require("../models/item.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const GlobalAdaptiveProfile = require("../models/globalAdaptiveProfile.model");
const MuseumAdaptiveProfile = require("../models/museumAdaptiveProfile.model");
const { updateContributor, aggregate } = require("./collectiveLearning.service");
const { robustMedian } = require("./adaptiveLearning.service");
const { paceBucket } = require("./adaptiveEstimation.service");
function estimateFromAggregate(result) { return { value: result.value, confidence: result.confidence, sampleCount: result.sampleCount, contributorCount: result.contributorCount, updatedAt: result.updatedAt }; }
async function refreshGlobalProfile() { const [movement, observation, calm, normal, fast] = await Promise.all([aggregate("population_speed", "global"), aggregate("population_observation", "global"), aggregate("pace_factor", "global:calm"), aggregate("pace_factor", "global:normal"), aggregate("pace_factor", "global:fast")]); return GlobalAdaptiveProfile.findOneAndUpdate({ key: "global" }, { $set: { movementSpeedMps: estimateFromAggregate(movement), observationSeconds: estimateFromAggregate(observation), "paceFactors.calm": estimateFromAggregate(calm), "paceFactors.normal": estimateFromAggregate(normal), "paceFactors.fast": estimateFromAggregate(fast) } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
async function refreshMuseumProfile(museumId) { const prefix = `museum:${museumId}`; const [movement, observation, calm, normal, fast] = await Promise.all([aggregate("museum_movement_factor", `${prefix}:movement`), aggregate("museum_observation_factor", `${prefix}:observation`), aggregate("pace_factor", `${prefix}:pace:calm`), aggregate("pace_factor", `${prefix}:pace:normal`), aggregate("pace_factor", `${prefix}:pace:fast`)]); return MuseumAdaptiveProfile.findOneAndUpdate({ museumId }, { $set: { movementResidualFactor: estimateFromAggregate(movement), observationFactor: estimateFromAggregate(observation), "paceFactors.calm": estimateFromAggregate(calm), "paceFactors.normal": estimateFromAggregate(normal), "paceFactors.fast": estimateFromAggregate(fast) } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
async function museumIdsForTransitions(session) {
  const byLayout = new Map(); for (const observation of session.transitionObservations || []) { const key = String(observation.layoutRevisionId); if (!byLayout.has(key)) byLayout.set(key, []); byLayout.get(key).push(observation); }
  const result = new Map(); for (const [layoutRevisionId, observations] of byLayout.entries()) { const revision = await MuseumLayoutRevision.findById(layoutRevisionId).lean(); const layout = revision ? await MuseumLayout.findById(revision.layoutId).lean() : null; if (layout) result.set(String(layout.museumId), observations); } return result;
}
async function museumIdsForPhysicalTargets(session) {
  const itemIds = [...new Set((session.physicalTargetObservations || []).map((entry) => String(entry.itemId)))];
  const items = await Item.find({ _id: { $in: itemIds } }).select("_id museumId").lean();
  const itemMuseum = new Map(items.map((item) => [String(item._id), String(item.museumId)])), result = new Map();
  for (const observation of session.physicalTargetObservations || []) { const museumId = itemMuseum.get(String(observation.itemId)); if (!museumId) continue; if (!result.has(museumId)) result.set(museumId, []); result.get(museumId).push(observation); }
  return result;
}
async function updatePopulationFromSession({ session, summary, personalObservationBase }) {
  const userId = session.userId;
  const normalizedSpeed = Number.isFinite(summary.estimatedSpeedMps) ? summary.estimatedSpeedMps / Math.max(0.1, session.initialPaceFactor || 1) : null;
  if (Number.isFinite(normalizedSpeed)) await updateContributor({ userId, metricType: "population_speed", scopeKey: "global", value: normalizedSpeed, sampleCount: summary.validTransitionCount });
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) await updateContributor({ userId, metricType: "population_observation", scopeKey: "global", value: summary.typicalPostContentObservationSeconds, sampleCount: summary.validTargetObservationCount });
  if (Number.isFinite(summary.estimatedSpeedMps) && Number.isFinite(session.initialMovementBaselineMps) && session.initialMovementBaselineMps > 0) { const bucket = paceBucket(session.movementPacePreference); await updateContributor({ userId, metricType: "pace_factor", scopeKey: `global:${bucket}`, value: summary.estimatedSpeedMps / session.initialMovementBaselineMps, sampleCount: summary.validTransitionCount }); }
  await refreshGlobalProfile();
  const transitionMuseums = await museumIdsForTransitions(session), targetMuseums = await museumIdsForPhysicalTargets(session);
  const affected = new Set([...transitionMuseums.keys(), ...targetMuseums.keys()]);
  for (const museumId of affected) {
    const transitions = transitionMuseums.get(museumId) || [];
    const validRatios = transitions.filter((entry) => (entry.reliability || 0) >= 0.5 && entry.predictedSeconds > 0).map((entry) => entry.observedSeconds / entry.predictedSeconds).filter((value) => Number.isFinite(value) && value >= 0.25 && value <= 4);
    const movementFactor = robustMedian(validRatios); if (Number.isFinite(movementFactor)) await updateContributor({ userId, metricType: "museum_movement_factor", scopeKey: `museum:${museumId}:movement`, value: movementFactor, sampleCount: validRatios.length });
    const targets = targetMuseums.get(museumId) || [];
    const observationValues = targets.filter((entry) => (entry.reliability || 0) >= 0.5).map((entry) => Number(entry.observedSeconds)).filter(Number.isFinite);
    const observation = robustMedian(observationValues); if (Number.isFinite(observation) && Number.isFinite(personalObservationBase) && personalObservationBase > 0) await updateContributor({ userId, metricType: "museum_observation_factor", scopeKey: `museum:${museumId}:observation`, value: observation / personalObservationBase, sampleCount: observationValues.length });
    if (Number.isFinite(summary.estimatedSpeedMps) && Number.isFinite(session.initialMovementBaselineMps) && session.initialMovementBaselineMps > 0 && transitions.length) { const bucket = paceBucket(session.movementPacePreference); await updateContributor({ userId, metricType: "pace_factor", scopeKey: `museum:${museumId}:pace:${bucket}`, value: summary.estimatedSpeedMps / session.initialMovementBaselineMps, sampleCount: transitions.length }); }
    await refreshMuseumProfile(museumId);
  }
}
module.exports = { refreshGlobalProfile, refreshMuseumProfile, updatePopulationFromSession };
