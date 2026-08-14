const User = require("../models/user");
const Visit = require("../models/visit");
const VisitSession = require("../models/visitSession.model");
const GeneratedVisitPlan = require("../models/generatedVisitPlan.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const ItemRevision = require("../models/itemRevision.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { estimateConnectionSeconds } = require("./graphRouting.service");
const { getLearnedResidualByConnection, updateRoutingProfiles } = require("./routingLearning.service");
const {
  updateEstimate,
  computeTransitionReliability,
  computePhysicalObservationReliability,
  computeContentExperienceReliability,
  summarizeSession,
} = require("./adaptiveLearning.service");
const { updatePopulationFromSession } = require("./populationLearning.service");
const { updateItemObservationProfiles, updateVisitTimingProfile } = require("./timingLearning.service");
const { applyInteractionLearning, updateExposureFromSession } = require("./interestProfile.service");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { findAdjacentRepresentation } = require("./presentationPolicy.service");
const {
  visitSourceSnapshot,
  generatedSourceSnapshot,
  createInitialSessionPlan,
  getCurrentSessionPlan,
} = require("./sessionPlan.service");

async function startSession({ userId, visitId, movementPacePreference, timeBudgetSeconds = null }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const source = await visitSourceSnapshot({ userId, visitId, movementPacePreference, timeBudgetSeconds });
  const context = source.contextSnapshot || {};
  const navigation = context.navigation || {};
  const session = await VisitSession.create({
    sourceType: "visit",
    userId,
    visitId,
    visitRevisionId: visit.publishedRevisionId,
    movementPacePreference: navigation.movementPacePreference ?? 0.5,
    initialMovementBaselineMps: context.movementBaselineMps || policy.coldStart.movementSpeedMps,
    initialPaceFactor: context.paceFactor || 1,
    sessionMovementSpeedMps: context.effectiveMovementSpeedMps || policy.coldStart.movementSpeedMps,
    initialObservationSeconds: context.observationBaselineSeconds || null,
    initialBaseEstimatedTotalSeconds: source.estimatedTiming.totalSeconds,
    initialEstimatedTotalSeconds: source.estimatedTiming.totalSeconds,
    adaptivePolicyVersion: policy.version,
  });
  return { session, planRevision: await createInitialSessionPlan({ session, sourceSnapshot: source }) };
}

async function startGeneratedPlanSession({ userId, planId }) {
  const plan = await GeneratedVisitPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("Piano generato non trovato", 404);
  const source = await generatedSourceSnapshot({ userId, planId });
  const context = plan.contextSnapshot || {};
  const session = await VisitSession.create({
    sourceType: "generated_plan",
    userId,
    generatedVisitPlanId: plan._id,
    movementPacePreference: context.dimensions?.movement?.value ?? 0.5,
    initialMovementBaselineMps: context.movementBaselineMps || policy.coldStart.movementSpeedMps,
    initialPaceFactor: context.paceFactor || 1,
    sessionMovementSpeedMps: context.effectiveMovementSpeedMps || policy.coldStart.movementSpeedMps,
    initialObservationSeconds: context.observationBaselineSeconds || null,
    initialBaseEstimatedTotalSeconds: plan.estimatedTiming?.totalSeconds || null,
    initialEstimatedTotalSeconds: plan.estimatedTiming?.totalSeconds || null,
    adaptivePolicyVersion: plan.adaptivePolicyVersion || policy.version,
  });
  return { session, planRevision: await createInitialSessionPlan({ session, sourceSnapshot: source }) };
}

async function activeSession(sessionId, userId, { allowPaused = false, allowRouteCompleted = false } = {}) {
  const statuses = ["active"];
  if (allowPaused) statuses.push("paused");
  if (allowRouteCompleted) statuses.push("route_completed");
  const session = await VisitSession.findOne({ _id: sessionId, userId, status: { $in: statuses } });
  if (!session) throw new AppError("Sessione nello stato richiesto non trovata", 404);
  return session;
}

async function currentEntry({ sessionId, userId, entryId = null, entryIndex = null, allowRouteCompleted = false }) {
  const { session, plan } = await getCurrentSessionPlan({ sessionId, userId, allowCompleted: allowRouteCompleted });
  let index = Number.isInteger(Number(entryIndex)) ? Number(entryIndex) : session.currentEntryIndex;
  if (entryId) index = (plan.contentEntries || []).findIndex((entry) => String(entry._id) === String(entryId));
  const entry = (plan.contentEntries || [])[index];
  if (!entry) throw new AppError("Content entry non trovata nel piano corrente", 404);
  return { session, plan, entry, index };
}

async function currentPlanContainsItem(session, itemId) {
  if (!session.currentPlanRevisionId) return false;
  const { plan } = await getCurrentSessionPlan({ sessionId: session._id, userId: session.userId, allowCompleted: true });
  return (plan.contentEntries || []).some((entry) => String(entry.itemId) === String(itemId));
}

async function recordTransition({ sessionId, userId, payload }) {
  const session = await activeSession(sessionId, userId);
  const observedSeconds = Number(payload.observedSeconds);
  if (!Number.isFinite(observedSeconds) || observedSeconds <= 0 || observedSeconds > 3600) {
    throw new AppError("observedSeconds non valido", 400);
  }
  const layoutRevision = await MuseumLayoutRevision.findById(payload.layoutRevisionId).lean();
  if (!layoutRevision) throw new AppError("Layout revision non trovata", 404);
  const connection = (layoutRevision.connections || []).find((entry) => String(entry._id) === String(payload.connectionId));
  if (!connection) throw new AppError("Connection non appartenente al layout indicato", 400);
  const residualMap = await getLearnedResidualByConnection(layoutRevision);
  const learnedResidualSeconds = residualMap[String(connection._id)] || 0;
  const predictedSeconds = estimateConnectionSeconds(connection, {
    speedMps: session.sessionMovementSpeedMps || session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps,
    learnedResidualSeconds,
  });
  const observedMovementSeconds = Math.max(
    0.1,
    observedSeconds - Math.max(0, (Number(connection.additionalDelaySeconds) || 0) + learnedResidualSeconds),
  );
  const observedMovementSpeedMps = Number(connection.distanceMeters) > 0
    ? Number(connection.distanceMeters) / observedMovementSeconds
    : null;
  const data = {
    connectionId: connection._id,
    layoutRevisionId: layoutRevision._id,
    distanceMeters: Number(connection.distanceMeters),
    predictedSeconds,
    observedSeconds,
    observedMovementSpeedMps: Number.isFinite(observedMovementSpeedMps) ? observedMovementSpeedMps : null,
  };
  const reliability = computeTransitionReliability(data);
  session.transitionObservations.push({ ...data, reliability });
  if (
    reliability >= policy.learning.minimumReliability
    && Number.isFinite(observedMovementSpeedMps)
    && observedMovementSpeedMps >= policy.movement.minSpeedMps
    && observedMovementSpeedMps <= policy.movement.maxSpeedMps
  ) {
    session.sessionMovementSpeedMps = session.sessionMovementSpeedMps
      ? session.sessionMovementSpeedMps * 0.75 + observedMovementSpeedMps * 0.25
      : observedMovementSpeedMps;
  }
  await session.save();
  return { session, observation: session.transitionObservations.at(-1) };
}

async function recordContentEntryExperience({ sessionId, userId, payload }) {
  const { session, entry, index } = await currentEntry({
    sessionId,
    userId,
    entryId: payload.contentEntryId,
    entryIndex: payload.entryIndex,
  });
  if (session.status !== "active") throw new AppError("La visita deve essere attiva", 409);
  const current = currentPresentation(session, entry, payload);
  const data = {
    contentEntryId: entry._id,
    itemId: entry.itemId,
    itemRevisionId: entry.itemRevisionId || null,
    variantKey: current.variantKey || null,
    durationKey: current.durationKey || null,
    languageLevelKey: current.languageLevelKey || null,
    contentSeconds: Number(payload.contentSeconds ?? entry.estimatedContentSeconds),
    experiencedSeconds: Number(payload.experiencedSeconds),
    completionRatio: payload.completionRatio === undefined ? 1 : Number(payload.completionRatio),
  };
  const reliability = computeContentExperienceReliability(data);
  if (!reliability) throw new AppError("Esperienza contenutistica non valida", 400);
  session.contentEntryExperiences.push({ ...data, reliability });
  session.currentEntryIndex = Math.max(session.currentEntryIndex, index);
  await session.save();
  return { session, experience: session.contentEntryExperiences.at(-1) };
}

async function recordPhysicalTargetObservation({ sessionId, userId, payload }) {
  const { session, entry } = await currentEntry({
    sessionId,
    userId,
    entryId: payload.contentEntryId,
    entryIndex: payload.entryIndex,
  });
  if (session.status !== "active") throw new AppError("La visita deve essere attiva", 409);
  if (entry.spatialMode !== "target") throw new AppError("Solo una content entry target puo avere osservazione fisica", 400);
  const data = { contentEntryId: entry._id, itemId: entry.itemId, observedSeconds: Number(payload.observedSeconds) };
  const reliability = computePhysicalObservationReliability(data);
  if (!reliability) throw new AppError("Osservazione fisica non valida", 400);
  session.physicalTargetObservations.push({ ...data, reliability });
  await session.save();
  return { session, observation: session.physicalTargetObservations.at(-1) };
}

async function recordInteraction({ sessionId, userId, payload }) {
  const session = await activeSession(sessionId, userId, { allowRouteCompleted: true });
  const allowed = Object.keys(policy.interests.eventEvidence);
  if (!allowed.includes(payload.type)) throw new AppError("Tipo di interazione non valido", 400);
  let planEntry = null;
  if (payload.contentEntryId) {
    const { plan } = await getCurrentSessionPlan({ sessionId, userId, allowCompleted: true });
    planEntry = (plan.contentEntries || []).find((entry) => String(entry._id) === String(payload.contentEntryId));
    if (!planEntry) throw new AppError("contentEntryId non appartiene al piano corrente", 400);
  }
  const itemId = payload.itemId || planEntry?.itemId || null;
  const mayPointOutsidePlan = ["semantic_drilldown", "manual_add"].includes(payload.type);
  if (itemId && !mayPointOutsidePlan && !(await currentPlanContainsItem(session, itemId))) {
    throw new AppError("itemId non appartiene al piano corrente", 400);
  }
  const metadata = { ...(payload.metadata || {}) };
  if (planEntry) {
    metadata.museumId = metadata.museumId || planEntry.museumId;
    metadata.entryRole = metadata.entryRole || planEntry.role;
    metadata.spatialMode = metadata.spatialMode || planEntry.spatialMode;
  }
  session.interactionEvents.push({
    type: payload.type,
    itemId,
    contentEntryId: payload.contentEntryId || null,
    variantKey: payload.variantKey || planEntry?.variantKey || null,
    metadata: Object.keys(metadata).length ? metadata : null,
    at: new Date(),
  });
  await session.save();
  return { session, event: session.interactionEvents.at(-1) };
}

function currentPresentation(session, entry, payload = {}) {
  const stored = (session.presentationOverrides || []).find(
    (override) => String(override.contentEntryId) === String(entry._id),
  );
  return {
    variantKey: payload.variantKey || stored?.variantKey || entry.variantKey,
    durationKey: payload.durationKey || stored?.durationKey || entry.durationKey,
    languageLevelKey: payload.languageLevelKey || stored?.languageLevelKey || entry.languageLevelKey,
  };
}

function savePresentationOverride(session, entry, representation) {
  const existing = (session.presentationOverrides || []).find(
    (override) => String(override.contentEntryId) === String(entry._id),
  );
  const value = {
    contentEntryId: entry._id,
    variantKey: representation.variantKey,
    durationKey: representation.durationKey,
    languageLevelKey: representation.languageLevelKey,
    updatedAt: new Date(),
  };
  if (existing) Object.assign(existing, value);
  else session.presentationOverrides.push(value);
}

const PRESENTATION_AXES = Object.freeze({
  duration: Object.freeze({
    eventUp: "presentation_depth_increased",
    eventDown: "presentation_depth_decreased",
    commandUp: "PRESENTATION_DEPTH_UP",
    commandDown: "PRESENTATION_DEPTH_DOWN",
    fromKey: "fromDurationKey",
    toKey: "toDurationKey",
    currentKey: "durationKey",
    missingUp: "Non esiste un approfondimento ulteriore per questa variante",
    missingDown: "Non esiste una versione piu breve per questa variante",
  }),
  language: Object.freeze({
    eventUp: "presentation_language_increased",
    eventDown: "presentation_language_decreased",
    commandUp: "PRESENTATION_LANGUAGE_UP",
    commandDown: "PRESENTATION_LANGUAGE_DOWN",
    fromKey: "fromLanguageLevelKey",
    toKey: "toLanguageLevelKey",
    currentKey: "languageLevelKey",
    missingUp: "Non esiste un livello linguistico piu avanzato per questa variante e durata",
    missingDown: "Non esiste un livello linguistico piu semplice per questa variante e durata",
  }),
});

async function changePresentationAxis({ sessionId, userId, payload, axis }) {
  const config = PRESENTATION_AXES[axis];
  if (!config) throw new AppError("Asse di presentazione non valido", 400);
  const { session, entry, index } = await currentEntry({
    sessionId,
    userId,
    entryId: payload.contentEntryId,
    entryIndex: payload.entryIndex,
  });
  if (session.status !== "active") throw new AppError("La visita deve essere attiva", 409);
  const revision = await ItemRevision.findById(entry.itemRevisionId).lean();
  if (!revision) throw new AppError("ItemRevision non trovata", 404);
  const vocabulary = await getMuseumVocabulary(entry.museumId);
  const direction = payload.direction === "down" ? "down" : "up";
  const before = currentPresentation(session, entry, payload);
  const representation = findAdjacentRepresentation({
    source: revision,
    durationTypes: vocabulary.durationTypes,
    languageLevels: vocabulary.languageLevels,
    currentRepresentation: before,
    axis,
    direction,
  });
  if (!representation) throw new AppError(direction === "up" ? config.missingUp : config.missingDown, 409);
  savePresentationOverride(session, entry, representation);
  session.interactionEvents.push({
    type: direction === "up" ? config.eventUp : config.eventDown,
    itemId: entry.itemId,
    contentEntryId: entry._id,
    variantKey: representation.variantKey,
    metadata: {
      museumId: entry.museumId,
      [config.fromKey]: before[config.currentKey],
      [config.toKey]: representation[config.currentKey],
    },
    at: new Date(),
  });
  await session.save();
  return {
    command: direction === "up" ? config.commandUp : config.commandDown,
    entryIndex: index,
    contentEntryId: entry._id,
    representation,
  };
}

async function changePresentationDepth(args) {
  return changePresentationAxis({ ...args, axis: "duration" });
}

async function changePresentationLanguage(args) {
  return changePresentationAxis({ ...args, axis: "language" });
}

async function pauseSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId);
  session.status = "paused";
  session.pauseIntervals.push({ startedAt: new Date(), endedAt: null });
  await session.save();
  return session;
}

async function resumeSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId, { allowPaused: true });
  if (session.status !== "paused") throw new AppError("La sessione non e in pausa", 409);
  const open = [...(session.pauseIntervals || [])].reverse().find((entry) => !entry.endedAt);
  if (open) open.endedAt = new Date();
  session.status = "active";
  await session.save();
  return session;
}

function pausedSeconds(session, now = new Date()) {
  return (session.pauseIntervals || []).reduce(
    (total, interval) => total + Math.max(
      0,
      ((interval.endedAt ? new Date(interval.endedAt) : now).getTime() - new Date(interval.startedAt).getTime()) / 1000,
    ),
    0,
  );
}

function activeElapsedSeconds(session, now = new Date()) {
  return Math.max(0, (now.getTime() - new Date(session.startedAt).getTime()) / 1000 - pausedSeconds(session, now));
}

async function markRouteCompleted({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId);
  const { plan } = await getCurrentSessionPlan({ sessionId, userId });
  session.status = "route_completed";
  session.currentEntryIndex = Math.max(0, (plan.contentEntries || []).length - 1);
  session.routeCompletedAt = new Date();
  await session.save();
  return { session, canExtend: true, currentPlanRevisionId: plan._id };
}

function mean(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

async function updateUserProfile({ userId, session, summary }) {
  const profile = await UserAdaptiveProfile.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (Number.isFinite(summary.estimatedSpeedMps)) {
    profile.movement.estimatedSpeedMps = updateEstimate(
      profile.movement.estimatedSpeedMps?.toObject?.() || profile.movement.estimatedSpeedMps,
      summary.estimatedSpeedMps / Math.max(0.1, session.initialPaceFactor || 1),
      1,
    );
  }
  if (Number.isFinite(summary.typicalPostContentObservationSeconds)) {
    profile.observation.typicalPostContentObservationSeconds = updateEstimate(
      profile.observation.typicalPostContentObservationSeconds?.toObject?.()
        || profile.observation.typicalPostContentObservationSeconds,
      summary.typicalPostContentObservationSeconds,
      1,
    );
  }
  const experiences = (session.contentEntryExperiences || []).filter(
    (entry) => (entry.reliability ?? 1) >= policy.learning.minimumReliability,
  );
  const den = Math.max(1, experiences.length);
  const events = session.interactionEvents || [];
  const rate = (type) => events.filter((event) => event.type === type).length / den;
  const depthUpRate = rate("presentation_depth_increased");
  const depthDownRate = rate("presentation_depth_decreased");
  const languageUpRate = rate("presentation_language_increased");
  const languageDownRate = rate("presentation_language_decreased");
  const optionalSkipRate = events.filter(
    (event) => event.type === "content_entry_skipped"
      && event.metadata?.entryRole === "optional"
      && !["time_pressure", "accessibility", "interrupted"].includes(event.metadata?.skipReason),
  ).length / den;
  const completion = mean(experiences.map((entry) => entry.completionRatio));

  profile.behavior.depthIncreaseRequestRate = updateEstimate(
    profile.behavior.depthIncreaseRequestRate?.toObject?.() || profile.behavior.depthIncreaseRequestRate,
    depthUpRate,
    1,
  );
  profile.behavior.depthDecreaseRequestRate = updateEstimate(
    profile.behavior.depthDecreaseRequestRate?.toObject?.() || profile.behavior.depthDecreaseRequestRate,
    depthDownRate,
    1,
  );
  profile.behavior.languageIncreaseRequestRate = updateEstimate(
    profile.behavior.languageIncreaseRequestRate?.toObject?.() || profile.behavior.languageIncreaseRequestRate,
    languageUpRate,
    1,
  );
  profile.behavior.languageDecreaseRequestRate = updateEstimate(
    profile.behavior.languageDecreaseRequestRate?.toObject?.() || profile.behavior.languageDecreaseRequestRate,
    languageDownRate,
    1,
  );
  profile.behavior.optionalContentEntrySkipRate = updateEstimate(
    profile.behavior.optionalContentEntrySkipRate?.toObject?.() || profile.behavior.optionalContentEntrySkipRate,
    optionalSkipRate,
    1,
  );
  if (Number.isFinite(completion)) {
    profile.behavior.contentCompletionRatio = updateEstimate(
      profile.behavior.contentCompletionRatio?.toObject?.() || profile.behavior.contentCompletionRatio,
      completion,
      1,
    );
  }
  if (depthUpRate || depthDownRate) {
    const inferredDepth = clamp01(0.5 + (depthUpRate - depthDownRate) * 0.35);
    profile.presentation.depthPreference = updateEstimate(
      profile.presentation.depthPreference?.toObject?.() || profile.presentation.depthPreference,
      inferredDepth,
      Math.min(1, depthUpRate + depthDownRate),
    );
  }
  if (languageUpRate || languageDownRate) {
    const inferredLanguageComplexity = clamp01(0.5 + (languageUpRate - languageDownRate) * 0.35);
    profile.presentation.languageComplexityPreference = updateEstimate(
      profile.presentation.languageComplexityPreference?.toObject?.()
        || profile.presentation.languageComplexityPreference,
      inferredLanguageComplexity,
      Math.min(1, languageUpRate + languageDownRate),
    );
  }
  await profile.save();
  await applyInteractionLearning({ userId, session });
  await updateExposureFromSession({ userId, session });
  return profile;
}

async function completeSession({ sessionId, userId }) {
  const session = await activeSession(sessionId, userId, { allowPaused: true, allowRouteCompleted: true });
  const now = new Date();
  if (session.status === "paused") {
    const open = [...(session.pauseIntervals || [])].reverse().find((entry) => !entry.endedAt);
    if (open) open.endedAt = now;
  }
  session.status = "completed";
  session.completedAt = now;
  await session.save();
  const summary = summarizeSession(session.toObject());
  summary.activeElapsedSeconds = activeElapsedSeconds(session, now);
  summary.pausedSeconds = pausedSeconds(session, now);
  const user = await User.findById(userId).lean();
  const personalEnabled = user?.learningPreferences?.personalHistory === true;
  const collectiveEnabled = user?.learningPreferences?.collectiveContribution === true;
  if (personalEnabled) await updateUserProfile({ userId, session, summary });
  if (collectiveEnabled) {
    const personalExpectedSpeedMps = Math.max(
      policy.movement.minSpeedMps,
      (session.initialMovementBaselineMps || policy.coldStart.movementSpeedMps) * (session.initialPaceFactor || 1),
    );
    const personalObservationBase = session.initialObservationSeconds || policy.coldStart.observationSeconds;
    const jobs = [
      updateRoutingProfiles({ session, personalExpectedSpeedMps }),
      updateItemObservationProfiles({ session, personalObservationBase }),
      updatePopulationFromSession({ session, summary, personalObservationBase }),
    ];
    if (session.sourceType === "visit" && session.visitRevisionId) jobs.push(updateVisitTimingProfile({ session, summary }));
    await Promise.all(jobs);
  }
  if (!personalEnabled && !collectiveEnabled) {
    session.transitionObservations = [];
    session.contentEntryExperiences = [];
    session.physicalTargetObservations = [];
    session.interactionEvents = [];
    await session.save();
  }
  return {
    session,
    summary,
    persistedPersonalHistory: personalEnabled,
    contributedToCollectiveLearning: collectiveEnabled,
  };
}

module.exports = {
  startSession,
  startGeneratedPlanSession,
  recordTransition,
  recordContentEntryExperience,
  recordPhysicalTargetObservation,
  recordInteraction,
  changePresentationAxis,
  changePresentationDepth,
  changePresentationLanguage,
  pauseSession,
  resumeSession,
  markRouteCompleted,
  activeElapsedSeconds,
  pausedSeconds,
  completeSession,
};
