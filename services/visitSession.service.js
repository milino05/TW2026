const User = require("../models/user");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const VisitSession = require("../models/visitSession.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const UserVisitPreference = require("../models/userVisitPreference.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const ConnectionLearnedProfile = require("../models/connectionLearnedProfile.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const AppError = require("../utils/AppError");
const { pacePreferenceToSpeed, estimateConnectionSeconds } = require("./graphRouting.service");
const { getLearnedResidualByConnection, updateRoutingAttributePriors } = require("./routingLearning.service");
const { updateEstimate, computeTransitionReliability, computeObservationReliability, summarizeSession, confidenceFromSamples, robustMedian } = require("./adaptiveLearning.service");

async function resolveInitialPace({ userId, visitId, explicitPreference }) {
  const [user, visitPreference, profile] = await Promise.all([
    User.findById(userId).lean(),
    UserVisitPreference.findOne({ userId, visitId }).lean(),
    UserAdaptiveProfile.findOne({ userId }).lean(),
  ]);
  const pace = Number.isFinite(Number(explicitPreference))
    ? Math.max(0, Math.min(1, Number(explicitPreference)))
    : (visitPreference?.navigation?.movementPacePreference ?? user?.defaultNavigationPreference?.movementPacePreference ?? 0.5);
  const declaredSpeed = pacePreferenceToSpeed(pace);
  const historical = profile?.movement?.estimatedSpeedMps;
  const historicalWeight = Math.min(0.5, Number(historical?.confidence) || 0);
  const initialSpeed = Number.isFinite(historical?.value)
    ? declaredSpeed * (1 - historicalWeight) + historical.value * historicalWeight
    : declaredSpeed;
  return { pace, initialSpeed, correctionFactor: profile?.movement?.timeCorrectionFactor?.value || 1 };
}

async function startSession({ userId, visitId, movementPacePreference }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const initial = await resolveInitialPace({ userId, visitId, explicitPreference: movementPacePreference });
  return VisitSession.create({
    userId,
    visitId,
    visitRevisionId: visit.publishedRevisionId,
    movementPacePreference: initial.pace,
    sessionMovementSpeedMps: initial.initialSpeed,
  });
}

async function recordTransition({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const observedSeconds = Number(payload.observedSeconds);
  if (!Number.isFinite(observedSeconds) || observedSeconds <= 0 || observedSeconds > 60 * 60) {
    throw new AppError("observedSeconds non valido", 400);
  }
  const layoutRevision = await MuseumLayoutRevision.findById(payload.layoutRevisionId).lean();
  if (!layoutRevision) throw new AppError("Layout revision non trovata", 404);
  const connection = (layoutRevision.connections || []).find((entry) => String(entry._id) === String(payload.connectionId));
  if (!connection) throw new AppError("Connection non appartenente al layout indicato", 400);
  const [profile, residualMap] = await Promise.all([
    UserAdaptiveProfile.findOne({ userId }).lean(),
    getLearnedResidualByConnection(layoutRevision),
  ]);
  const predictedSeconds = estimateConnectionSeconds(connection, {
    speedMps: session.sessionMovementSpeedMps || 1,
    learnedResidualSeconds: residualMap[String(connection._id)] || 0,
    userCorrectionFactor: profile?.movement?.timeCorrectionFactor?.value || 1,
  });
  const data = {
    connectionId: connection._id,
    layoutRevisionId: layoutRevision._id,
    distanceMeters: Number(connection.distanceMeters),
    predictedSeconds,
    observedSeconds,
  };
  const reliability = computeTransitionReliability(data);
  session.transitionObservations.push({ ...data, reliability });
  if (reliability >= 0.5) {
    const observedSpeed = data.distanceMeters / data.observedSeconds;
    if (observedSpeed >= 0.1 && observedSpeed <= 3) {
      session.sessionMovementSpeedMps = session.sessionMovementSpeedMps
        ? session.sessionMovementSpeedMps * 0.75 + observedSpeed * 0.25
        : observedSpeed;
    }
  }
  await session.save();
  return { session, observation: session.transitionObservations.at(-1) };
}

async function recordStop({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const visitRevision = await VisitRevision.findById(session.visitRevisionId).lean();
  if (!visitRevision || !(visitRevision.stops || []).some((stop) => String(stop.itemId) === String(payload.itemId))) {
    throw new AppError("itemId non appartiene alla visita della sessione", 400);
  }
  const data = {
    itemId: payload.itemId,
    contentSeconds: Number(payload.contentSeconds),
    totalStopSeconds: Number(payload.totalStopSeconds),
    postContentObservationSeconds: Number(payload.postContentObservationSeconds),
  };
  if (![data.contentSeconds, data.totalStopSeconds, data.postContentObservationSeconds].every(Number.isFinite) || data.totalStopSeconds > 2 * 60 * 60) {
    throw new AppError("Tempi di tappa non validi", 400);
  }
  const reliability = computeObservationReliability(data);
  session.stopObservations.push({ ...data, reliability });
  await session.save();
  return { session, observation: session.stopObservations.at(-1) };
}

async function updateUserProfile(userId, summary) {
  const profile = await UserAdaptiveProfile.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (Number.isFinite(summary.estimatedSpeedMps)) profile.movement.estimatedSpeedMps = updateEstimate(profile.movement.estimatedSpeedMps?.toObject?.() || profile.movement.estimatedSpeedMps, summary.estimatedSpeedMps, 1);
  if (Number.isFinite(summary.timeCorrectionFactor)) profile.movement.timeCorrectionFactor = updateEstimate(profile.movement.timeCorrectionFactor?.toObject?.() || profile.movement.timeCorrectionFactor, summary.timeCorrectionFactor, 0.8);
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) profile.observation.typicalPostContentObservationSeconds = updateEstimate(profile.observation.typicalPostContentObservationSeconds?.toObject?.() || profile.observation.typicalPostContentObservationSeconds, summary.typicalPostContentObservationSeconds, 1);
  await profile.save();
  return profile;
}

function groupBy(values, keyFn) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return grouped;
}

async function updateCollectiveProfiles(session, userProfile) {
  const validTransitions = (session.transitionObservations || []).filter((entry) => (entry.reliability || 0) >= 0.5);
  const transitionGroups = groupBy(validTransitions, (entry) => `${entry.layoutRevisionId}:${entry.connectionId}`);
  const userSpeed = userProfile?.movement?.estimatedSpeedMps?.value || session.sessionMovementSpeedMps || 1;
  for (const observations of transitionGroups.values()) {
    const first = observations[0];
    const residuals = observations.map((observation) => observation.observedSeconds - observation.distanceMeters / Math.max(0.1, userSpeed));
    const sessionResidual = robustMedian(residuals);
    if (!Number.isFinite(sessionResidual)) continue;
    const profile = await ConnectionLearnedProfile.findOneAndUpdate(
      { layoutRevisionId: first.layoutRevisionId, connectionId: first.connectionId },
      { $setOnInsert: { layoutRevisionId: first.layoutRevisionId, connectionId: first.connectionId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const previous = profile.contributingSessionCount;
    const alpha = Math.max(0.03, Math.min(0.25, 1 / Math.sqrt(previous + 1)));
    profile.typicalResidualSeconds = previous === 0 ? sessionResidual : profile.typicalResidualSeconds * (1 - alpha) + sessionResidual * alpha;
    profile.sampleCount += 1;
    profile.contributingSessionCount += 1;
    profile.confidence = confidenceFromSamples(profile.sampleCount, profile.contributingSessionCount);
    profile.updatedAt = new Date();
    await profile.save();
  }

  const validStops = (session.stopObservations || []).filter((entry) => (entry.reliability || 0) >= 0.5);
  const stopGroups = groupBy(validStops, (entry) => String(entry.itemId));
  const userTypical = userProfile?.observation?.typicalPostContentObservationSeconds?.value;
  for (const observations of stopGroups.values()) {
    const first = observations[0];
    const sessionObservation = robustMedian(observations.map((entry) => entry.postContentObservationSeconds));
    if (!Number.isFinite(sessionObservation)) continue;
    const profile = await ItemObservationProfile.findOneAndUpdate({ itemId: first.itemId }, { $setOnInsert: { itemId: first.itemId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const previous = profile.contributingSessionCount;
    const alpha = Math.max(0.03, Math.min(0.25, 1 / Math.sqrt(previous + 1)));
    profile.typicalObservationSeconds = previous === 0 ? sessionObservation : profile.typicalObservationSeconds * (1 - alpha) + sessionObservation * alpha;
    if (Number.isFinite(userTypical) && userTypical > 0) {
      const factor = sessionObservation / userTypical;
      profile.observationFactor = previous === 0 ? factor : profile.observationFactor * (1 - alpha) + factor * alpha;
    }
    profile.sampleCount += 1;
    profile.contributingSessionCount += 1;
    profile.confidence = confidenceFromSamples(profile.sampleCount, profile.contributingSessionCount);
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
    await updateRoutingAttributePriors({ session, userSpeedMps: profile.movement.estimatedSpeedMps?.value || session.sessionMovementSpeedMps || 1 });
    return { session, summary, persistedLearning: true };
  }
  session.transitionObservations = [];
  session.stopObservations = [];
  await session.save();
  return { session, summary, persistedLearning: false };
}

module.exports = { startSession, recordTransition, recordStop, completeSession };
