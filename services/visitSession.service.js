const User = require("../models/user");
const Visit = require("../models/visit");
const VisitSession = require("../models/visitSession.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const ConnectionLearnedProfile = require("../models/connectionLearnedProfile.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const AppError = require("../utils/AppError");
const { pacePreferenceToSpeed } = require("./graphRouting.service");
const { updateEstimate, computeTransitionReliability, computeObservationReliability, summarizeSession, confidenceFromSamples } = require("./adaptiveLearning.service");

async function startSession({ userId, visitId, movementPacePreference = 0.5 }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const profile = await UserAdaptiveProfile.findOne({ userId }).lean();
  const declaredSpeed = pacePreferenceToSpeed(movementPacePreference);
  const historical = profile?.movement?.estimatedSpeedMps;
  const historicalWeight = Math.min(0.5, Number(historical?.confidence) || 0);
  const initialSpeed = Number.isFinite(historical?.value)
    ? declaredSpeed * (1 - historicalWeight) + historical.value * historicalWeight
    : declaredSpeed;
  return VisitSession.create({ userId, visitId, visitRevisionId: visit.publishedRevisionId, movementPacePreference, sessionMovementSpeedMps: initialSpeed });
}

async function recordTransition({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const data = { connectionId: payload.connectionId, layoutRevisionId: payload.layoutRevisionId, distanceMeters: Number(payload.distanceMeters), predictedSeconds: Number(payload.predictedSeconds), observedSeconds: Number(payload.observedSeconds) };
  const reliability = computeTransitionReliability(data);
  session.transitionObservations.push({ ...data, reliability });
  if (reliability >= 0.5 && data.observedSeconds > 0) {
    const observedSpeed = data.distanceMeters / data.observedSeconds;
    if (observedSpeed >= 0.1 && observedSpeed <= 3) {
      session.sessionMovementSpeedMps = session.sessionMovementSpeedMps ? session.sessionMovementSpeedMps * 0.75 + observedSpeed * 0.25 : observedSpeed;
    }
  }
  await session.save();
  return session;
}

async function recordStop({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const data = { itemId: payload.itemId, contentSeconds: Number(payload.contentSeconds), totalStopSeconds: Number(payload.totalStopSeconds), postContentObservationSeconds: Number(payload.postContentObservationSeconds) };
  const reliability = computeObservationReliability(data);
  session.stopObservations.push({ ...data, reliability });
  await session.save();
  return session;
}

async function updateUserProfile(userId, summary) {
  const profile = await UserAdaptiveProfile.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (Number.isFinite(summary.estimatedSpeedMps)) profile.movement.estimatedSpeedMps = updateEstimate(profile.movement.estimatedSpeedMps?.toObject?.() || profile.movement.estimatedSpeedMps, summary.estimatedSpeedMps, 1);
  if (Number.isFinite(summary.timeCorrectionFactor)) profile.movement.timeCorrectionFactor = updateEstimate(profile.movement.timeCorrectionFactor?.toObject?.() || profile.movement.timeCorrectionFactor, summary.timeCorrectionFactor, 0.8);
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) profile.observation.typicalPostContentObservationSeconds = updateEstimate(profile.observation.typicalPostContentObservationSeconds?.toObject?.() || profile.observation.typicalPostContentObservationSeconds, summary.typicalPostContentObservationSeconds, 1);
  await profile.save();
  return profile;
}

async function updateCollectiveProfiles(session, userProfile) {
  for (const observation of session.transitionObservations || []) {
    if ((observation.reliability || 0) < 0.5) continue;
    const userSpeed = userProfile?.movement?.estimatedSpeedMps?.value || session.sessionMovementSpeedMps || 1;
    const personalExpected = observation.distanceMeters / Math.max(0.1, userSpeed);
    const residual = observation.observedSeconds - personalExpected;
    const profile = await ConnectionLearnedProfile.findOneAndUpdate({ layoutRevisionId: observation.layoutRevisionId, connectionId: observation.connectionId }, { $setOnInsert: { layoutRevisionId: observation.layoutRevisionId, connectionId: observation.connectionId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const previous = profile.sampleCount;
    const alpha = Math.max(0.03, Math.min(0.25, 1 / Math.sqrt(previous + 1)));
    profile.typicalResidualSeconds = previous === 0 ? residual : profile.typicalResidualSeconds * (1 - alpha) + residual * alpha;
    profile.sampleCount += 1;
    profile.distinctUserCount += 1;
    profile.confidence = confidenceFromSamples(profile.sampleCount, profile.distinctUserCount);
    profile.updatedAt = new Date();
    await profile.save();
  }
  const userTypical = userProfile?.observation?.typicalPostContentObservationSeconds?.value;
  for (const observation of session.stopObservations || []) {
    if ((observation.reliability || 0) < 0.5) continue;
    const profile = await ItemObservationProfile.findOneAndUpdate({ itemId: observation.itemId }, { $setOnInsert: { itemId: observation.itemId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const previous = profile.sampleCount;
    const alpha = Math.max(0.03, Math.min(0.25, 1 / Math.sqrt(previous + 1)));
    profile.typicalObservationSeconds = previous === 0 ? observation.postContentObservationSeconds : profile.typicalObservationSeconds * (1 - alpha) + observation.postContentObservationSeconds * alpha;
    if (Number.isFinite(userTypical) && userTypical > 0) {
      const factor = observation.postContentObservationSeconds / userTypical;
      profile.observationFactor = previous === 0 ? factor : profile.observationFactor * (1 - alpha) + factor * alpha;
    }
    profile.sampleCount += 1;
    profile.distinctUserCount += 1;
    profile.confidence = confidenceFromSamples(profile.sampleCount, profile.distinctUserCount);
    profile.updatedAt = new Date();
    await profile.save();
  }
}

async function completeSession({ sessionId, userId }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  session.status = "completed";
  session.completedAt = new Date();
  await session.save();
  const summary = summarizeSession(session.toObject());
  const user = await User.findById(userId).lean();
  if (user?.adaptiveLearningEnabled === true) {
    const profile = await updateUserProfile(userId, summary);
    await updateCollectiveProfiles(session, profile);
    return { session, summary, persistedLearning: true };
  }
  session.transitionObservations = [];
  session.stopObservations = [];
  await session.save();
  return { session, summary, persistedLearning: false };
}

module.exports = { startSession, recordTransition, recordStop, completeSession };
