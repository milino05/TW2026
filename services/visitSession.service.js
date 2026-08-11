const User = require("../models/user");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const VisitSession = require("../models/visitSession.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { buildLogisticsPlan } = require("./logisticsPlan.service");
const { estimateConnectionSeconds } = require("./graphRouting.service");
const { getLearnedResidualByConnection, updateRoutingProfiles } = require("./routingLearning.service");
const { updateEstimate, computeTransitionReliability, computeObservationReliability, summarizeSession } = require("./adaptiveLearning.service");
const { updatePopulationFromSession } = require("./populationLearning.service");
const { updateItemObservationProfiles, updateVisitTimingProfile } = require("./timingLearning.service");

async function startSession({ userId, visitId, movementPacePreference }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const plan = await buildLogisticsPlan({ userId, visitId, navigationOverride: Number.isFinite(Number(movementPacePreference)) ? { movementPacePreference: Number(movementPacePreference) } : {} });
  return VisitSession.create({ userId, visitId, visitRevisionId: visit.publishedRevisionId, movementPacePreference: plan.navigation.movementPacePreference, initialMovementBaselineMps: plan.movementBaselineMps, initialPaceFactor: plan.paceFactor, sessionMovementSpeedMps: plan.effectiveMovementSpeedMps, initialObservationSeconds: plan.observationBaselineSeconds, initialBaseEstimatedTotalSeconds: plan.estimatedBaseTotalSeconds, initialEstimatedTotalSeconds: plan.estimatedTotalSeconds, adaptivePolicyVersion: policy.version });
}

async function recordTransition({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const observedSeconds = Number(payload.observedSeconds);
  if (!Number.isFinite(observedSeconds) || observedSeconds <= 0 || observedSeconds > 60 * 60) throw new AppError("observedSeconds non valido", 400);
  const layoutRevision = await MuseumLayoutRevision.findById(payload.layoutRevisionId).lean();
  if (!layoutRevision) throw new AppError("Layout revision non trovata", 404);
  const connection = (layoutRevision.connections || []).find((entry) => String(entry._id) === String(payload.connectionId));
  if (!connection) throw new AppError("Connection non appartenente al layout indicato", 400);
  const residualMap = await getLearnedResidualByConnection(layoutRevision);
  const learnedResidualSeconds = residualMap[String(connection._id)] || 0;
  const predictedSeconds = estimateConnectionSeconds(connection, { speedMps: session.sessionMovementSpeedMps || session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps, learnedResidualSeconds });
  const knownNonMovementSeconds = Math.max(0, (Number(connection.additionalDelaySeconds) || 0) + learnedResidualSeconds);
  const observedMovementSeconds = Math.max(0.1, observedSeconds - knownNonMovementSeconds);
  const observedMovementSpeedMps = Number(connection.distanceMeters) > 0 ? Number(connection.distanceMeters) / observedMovementSeconds : null;
  const data = { connectionId: connection._id, layoutRevisionId: layoutRevision._id, distanceMeters: Number(connection.distanceMeters), predictedSeconds, observedSeconds, observedMovementSpeedMps: Number.isFinite(observedMovementSpeedMps) ? observedMovementSpeedMps : null };
  const reliability = computeTransitionReliability(data);
  session.transitionObservations.push({ ...data, reliability });
  if (reliability >= policy.learning.minimumReliability && Number.isFinite(observedMovementSpeedMps) && observedMovementSpeedMps >= policy.movement.minSpeedMps && observedMovementSpeedMps <= policy.movement.maxSpeedMps) session.sessionMovementSpeedMps = session.sessionMovementSpeedMps ? session.sessionMovementSpeedMps * 0.75 + observedMovementSpeedMps * 0.25 : observedMovementSpeedMps;
  await session.save();
  return { session, observation: session.transitionObservations.at(-1) };
}

async function recordStop({ sessionId, userId, payload }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  const visitRevision = await VisitRevision.findById(session.visitRevisionId).lean();
  if (!visitRevision || !(visitRevision.stops || []).some((stop) => String(stop.itemId) === String(payload.itemId))) throw new AppError("itemId non appartiene alla visita della sessione", 400);
  const data = { itemId: payload.itemId, contentSeconds: Number(payload.contentSeconds), totalStopSeconds: Number(payload.totalStopSeconds), postContentObservationSeconds: Number(payload.postContentObservationSeconds) };
  if (![data.contentSeconds, data.totalStopSeconds, data.postContentObservationSeconds].every(Number.isFinite) || data.totalStopSeconds > 2 * 60 * 60) throw new AppError("Tempi di tappa non validi", 400);
  const reliability = computeObservationReliability(data);
  session.stopObservations.push({ ...data, reliability });
  await session.save();
  return { session, observation: session.stopObservations.at(-1) };
}

async function updateUserProfile({ userId, session, summary }) {
  const profile = await UserAdaptiveProfile.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (Number.isFinite(summary.estimatedSpeedMps)) { const normalizedSpeed = summary.estimatedSpeedMps / Math.max(0.1, session.initialPaceFactor || 1); profile.movement.estimatedSpeedMps = updateEstimate(profile.movement.estimatedSpeedMps?.toObject?.() || profile.movement.estimatedSpeedMps, normalizedSpeed, 1); }
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) profile.observation.typicalPostContentObservationSeconds = updateEstimate(profile.observation.typicalPostContentObservationSeconds?.toObject?.() || profile.observation.typicalPostContentObservationSeconds, summary.typicalPostContentObservationSeconds, 1);
  await profile.save();
  return profile;
}

async function completeSession({ sessionId, userId }) {
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: "active" });
  if (!session) throw new AppError("Sessione attiva non trovata", 404);
  session.status = "completed"; session.completedAt = new Date(); await session.save();
  const summary = summarizeSession(session.toObject());
  const user = await User.findById(userId).lean();
  const personalEnabled = user?.learningPreferences?.personalHistory === true;
  const collectiveEnabled = user?.learningPreferences?.collectiveContribution === true;
  let profile = await UserAdaptiveProfile.findOne({ userId });
  if (personalEnabled) profile = await updateUserProfile({ userId, session, summary });
  if (collectiveEnabled) {
    const personalExpectedSpeedMps = Math.max(policy.movement.minSpeedMps, (session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps) * (session.initialPaceFactor || 1));
    const personalObservationBase = session.initialObservationSeconds || policy.coldStart.observationSeconds;
    await Promise.all([
      updateRoutingProfiles({ session, personalExpectedSpeedMps }),
      updateItemObservationProfiles({ session, personalObservationBase }),
      updateVisitTimingProfile({ session, summary }),
      updatePopulationFromSession({ session, summary, personalObservationBase }),
    ]);
  }
  if (!personalEnabled && !collectiveEnabled) { session.transitionObservations = []; session.stopObservations = []; await session.save(); }
  return { session, summary, persistedPersonalHistory: personalEnabled, contributedToCollectiveLearning: collectiveEnabled };
}

module.exports = { startSession, recordTransition, recordStop, completeSession };
