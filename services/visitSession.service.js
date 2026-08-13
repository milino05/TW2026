const User = require("../models/user");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const VisitSession = require("../models/visitSession.model");
const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
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
const { applyInteractionLearning } = require("./interestProfile.service");

async function startSession({ userId, visitId, movementPacePreference }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const plan = await buildLogisticsPlan({ userId, visitId, navigationOverride: Number.isFinite(Number(movementPacePreference)) ? { movementPacePreference: Number(movementPacePreference) } : {} });
  return VisitSession.create({ sourceType: "visit", userId, visitId, visitRevisionId: visit.publishedRevisionId, movementPacePreference: plan.navigation.movementPacePreference, initialMovementBaselineMps: plan.movementBaselineMps, initialPaceFactor: plan.paceFactor, sessionMovementSpeedMps: plan.effectiveMovementSpeedMps, initialObservationSeconds: plan.observationBaselineSeconds, initialBaseEstimatedTotalSeconds: plan.estimatedBaseTotalSeconds, initialEstimatedTotalSeconds: plan.estimatedTotalSeconds, adaptivePolicyVersion: policy.version });
}

async function startGeneratedPlanSession({ userId, planId }) {
  const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("Piano generato non trovato", 404);
  if (plan.status !== "accepted") throw new AppError("Il piano deve essere accettato prima di iniziare la visita", 409);
  const context = plan.contextSnapshot || {};
  return VisitSession.create({ sourceType: "generated_plan", userId, generatedVisitPlanId: plan._id, movementPacePreference: context.dimensions?.movement?.value ?? 0.5, initialMovementBaselineMps: context.movementBaselineMps || policy.coldStart.movementSpeedMps, initialPaceFactor: context.paceFactor || 1, sessionMovementSpeedMps: context.effectiveMovementSpeedMps || policy.coldStart.movementSpeedMps, initialObservationSeconds: null, initialBaseEstimatedTotalSeconds: plan.estimatedTiming?.totalSeconds || null, initialEstimatedTotalSeconds: plan.estimatedTiming?.totalSeconds || null, adaptivePolicyVersion: plan.adaptivePolicyVersion || policy.version });
}

async function activeSession(sessionId, userId, { allowPaused = false } = {}) {
  const statuses = allowPaused ? ["active", "paused"] : ["active"];
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: { $in: statuses } });
  if (!session) throw new AppError(allowPaused ? "Sessione attiva o in pausa non trovata" : "Sessione attiva non trovata", 404);
  return session;
}

async function recordTransition({ sessionId, userId, payload }) {
  const session = await activeSession(sessionId, userId);
  const observedSeconds = Number(payload.observedSeconds); if (!Number.isFinite(observedSeconds) || observedSeconds <= 0 || observedSeconds > 3600) throw new AppError("observedSeconds non valido", 400);
  const layoutRevision = await MuseumLayoutRevision.findById(payload.layoutRevisionId).lean(); if (!layoutRevision) throw new AppError("Layout revision non trovata", 404);
  const connection = (layoutRevision.connections || []).find((entry) => String(entry._id) === String(payload.connectionId)); if (!connection) throw new AppError("Connection non appartenente al layout indicato", 400);
  const residualMap = await getLearnedResidualByConnection(layoutRevision); const learnedResidualSeconds = residualMap[String(connection._id)] || 0;
  const predictedSeconds = estimateConnectionSeconds(connection, { speedMps: session.sessionMovementSpeedMps || session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps, learnedResidualSeconds });
  const knownNonMovementSeconds = Math.max(0, (Number(connection.additionalDelaySeconds) || 0) + learnedResidualSeconds); const observedMovementSeconds = Math.max(0.1, observedSeconds - knownNonMovementSeconds); const observedMovementSpeedMps = Number(connection.distanceMeters) > 0 ? Number(connection.distanceMeters) / observedMovementSeconds : null;
  const data = { connectionId: connection._id, layoutRevisionId: layoutRevision._id, distanceMeters: Number(connection.distanceMeters), predictedSeconds, observedSeconds, observedMovementSpeedMps: Number.isFinite(observedMovementSpeedMps) ? observedMovementSpeedMps : null };
  const reliability = computeTransitionReliability(data); session.transitionObservations.push({ ...data, reliability });
  if (reliability >= policy.learning.minimumReliability && Number.isFinite(observedMovementSpeedMps) && observedMovementSpeedMps >= policy.movement.minSpeedMps && observedMovementSpeedMps <= policy.movement.maxSpeedMps) session.sessionMovementSpeedMps = session.sessionMovementSpeedMps ? session.sessionMovementSpeedMps * 0.75 + observedMovementSpeedMps * 0.25 : observedMovementSpeedMps;
  await session.save(); return { session, observation: session.transitionObservations.at(-1) };
}

async function sourceContainsItem(session, itemId) {
  if (session.sourceType === "generated_plan") { const plan = await GeneratedVisitPlan.findById(session.generatedVisitPlanId).lean(); return Boolean(plan && (plan.stops || []).some((stop) => String(stop.itemId) === String(itemId))); }
  const revision = await VisitRevision.findById(session.visitRevisionId).lean(); return Boolean(revision && (revision.stops || []).some((stop) => String(stop.itemId) === String(itemId)));
}

async function recordStop({ sessionId, userId, payload }) {
  const session = await activeSession(sessionId, userId); if (!(await sourceContainsItem(session, payload.itemId))) throw new AppError("itemId non appartiene alla visita della sessione", 400);
  const data = { itemId: payload.itemId, variantKey: payload.variantKey || null, contentSeconds: Number(payload.contentSeconds), totalStopSeconds: Number(payload.totalStopSeconds), postContentObservationSeconds: Number(payload.postContentObservationSeconds) };
  if (![data.contentSeconds, data.totalStopSeconds, data.postContentObservationSeconds].every(Number.isFinite) || data.totalStopSeconds > 7200) throw new AppError("Tempi di tappa non validi", 400);
  const reliability = computeObservationReliability(data); session.stopObservations.push({ ...data, reliability }); if (Number.isInteger(payload.stopIndex) && payload.stopIndex >= 0) session.currentStopIndex = payload.stopIndex;
  await session.save(); return { session, observation: session.stopObservations.at(-1) };
}

async function recordInteraction({ sessionId, userId, payload }) {
  const session = await activeSession(sessionId, userId); const allowed = Object.keys(policy.interests.eventEvidence); if (!allowed.includes(payload.type)) throw new AppError("Tipo di interazione non valido", 400);
  if (payload.itemId && !(await sourceContainsItem(session, payload.itemId)) && !["related_opened", "manual_add"].includes(payload.type)) throw new AppError("itemId non appartiene al piano corrente", 400);
  session.interactionEvents.push({ type: payload.type, itemId: payload.itemId || null, variantKey: payload.variantKey || null, metadata: payload.metadata || null, at: new Date() }); await session.save(); return { session, event: session.interactionEvents.at(-1) };
}

async function pauseSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId); session.status = "paused"; session.pauseIntervals.push({ startedAt: new Date(), endedAt: null }); await session.save(); return session;
}
async function resumeSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId, { allowPaused: true }); if (session.status !== "paused") throw new AppError("La sessione non e in pausa", 409);
  const open = [...(session.pauseIntervals || [])].reverse().find((entry) => !entry.endedAt); if (open) open.endedAt = new Date(); session.status = "active"; await session.save(); return session;
}
function pausedSeconds(session, now = new Date()) { return (session.pauseIntervals || []).reduce((total, interval) => total + Math.max(0, ((interval.endedAt ? new Date(interval.endedAt) : now).getTime() - new Date(interval.startedAt).getTime()) / 1000), 0); }
function activeElapsedSeconds(session, now = new Date()) { return Math.max(0, (now.getTime() - new Date(session.startedAt).getTime()) / 1000 - pausedSeconds(session, now)); }

async function updateUserProfile({ userId, session, summary }) {
  const profile = await UserAdaptiveProfile.findOneAndUpdate({ userId }, { $setOnInsert: { userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (Number.isFinite(summary.estimatedSpeedMps)) { const normalizedSpeed = summary.estimatedSpeedMps / Math.max(0.1, session.initialPaceFactor || 1); profile.movement.estimatedSpeedMps = updateEstimate(profile.movement.estimatedSpeedMps?.toObject?.() || profile.movement.estimatedSpeedMps, normalizedSpeed, 1); }
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) profile.observation.typicalPostContentObservationSeconds = updateEstimate(profile.observation.typicalPostContentObservationSeconds?.toObject?.() || profile.observation.typicalPostContentObservationSeconds, summary.typicalPostContentObservationSeconds, 1);
  await applyInteractionLearning({ profile, session }); await profile.save(); return profile;
}

async function completeSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId, { allowPaused: true }); const now = new Date();
  if (session.status === "paused") { const open = [...(session.pauseIntervals || [])].reverse().find((entry) => !entry.endedAt); if (open) open.endedAt = now; }
  session.status = "completed"; session.completedAt = now; await session.save(); const summary = summarizeSession(session.toObject()); summary.activeElapsedSeconds = activeElapsedSeconds(session, now); summary.pausedSeconds = pausedSeconds(session, now);
  const user = await User.findById(userId).lean(); const personalEnabled = user?.learningPreferences?.personalHistory === true; const collectiveEnabled = user?.learningPreferences?.collectiveContribution === true;
  let profile = await UserAdaptiveProfile.findOne({ userId }); if (personalEnabled) profile = await updateUserProfile({ userId, session, summary });
  if (collectiveEnabled) {
    const personalExpectedSpeedMps = Math.max(policy.movement.minSpeedMps, (session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps) * (session.initialPaceFactor || 1)); const personalObservationBase = session.initialObservationSeconds || policy.coldStart.observationSeconds;
    const jobs = [updateRoutingProfiles({ session, personalExpectedSpeedMps }), updateItemObservationProfiles({ session, personalObservationBase }), updatePopulationFromSession({ session, summary, personalObservationBase })];
    if (session.sourceType === "visit" && session.visitRevisionId) jobs.push(updateVisitTimingProfile({ session, summary })); await Promise.all(jobs);
  }
  if (!personalEnabled && !collectiveEnabled) { session.transitionObservations = []; session.stopObservations = []; session.interactionEvents = []; await session.save(); }
  return { session, summary, persistedPersonalHistory: personalEnabled, contributedToCollectiveLearning: collectiveEnabled };
}

module.exports = { startSession, startGeneratedPlanSession, recordTransition, recordStop, recordInteraction, pauseSession, resumeSession, activeElapsedSeconds, pausedSeconds, completeSession };
