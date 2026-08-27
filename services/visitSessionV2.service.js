const User = require("../models/user");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { ACTION_DEFINITIONS, navigationActionDefinition, publicAction } = require("../config/runtimeActions");
const { estimateConnectionSeconds } = require("./graphRouting.service");
const { computeTransitionReliability, computePhysicalObservationReliability, computeContentExperienceReliability } = require("./adaptiveLearning.service");
const { recordContentExposure, recordVenueTargetObservation } = require("./learningV2.service");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const { findAdjacentPresentation, resolvePresentationText, id } = require("./presentationRuntimeV2.service");
const { loadPinnedBundle, routeToIntentInSession } = require("./physicalExecutionV2.service");
const { nextPhysicalLeg } = require("./navigationProjectionV2.service");
const { resolveNavigationOrigin } = require("./navigationOriginV2.service");
const {
  deriveSemanticExplorationActions,
  materializeSemanticPresentation,
} = require("./runtimeSemanticExplorationV2.service");

function effectivePresentation(session, entry) {
  const override = (session.presentationOverrides || []).find((value) => id(value.contentEntryId) === id(entry._id));
  return override ? {
    variantId: override.variantId,
    representationId: override.representationId,
    durationTypeDefinitionId: override.durationTypeDefinitionId,
    languageLevelDefinitionId: override.languageLevelDefinitionId,
    locale: override.locale,
    estimatedContentSeconds: override.estimatedContentSeconds,
  } : entry.baselinePresentation;
}

function anchorMap(plan) { return new Map((plan.visitAnchors || []).map((entry) => [id(entry._id), entry])); }
function effectiveAnchorForIndex(plan, index) {
  const anchors = anchorMap(plan);
  for (let cursor = Math.min(index, (plan.contentEntries || []).length - 1); cursor >= 0; cursor -= 1) {
    const anchorId = plan.contentEntries[cursor]?.deliveryAnchorId;
    if (anchorId && anchors.has(id(anchorId))) return anchors.get(id(anchorId));
  }
  return null;
}

function presentationAspects(revision, namespaceRevision, presentation) {
  const variant = (revision.presentationVariants || []).find((value) => id(value._id) === id(presentation.variantId));
  const aspectById = new Map((namespaceRevision.presentationAspects || []).map((value) => [String(value.definitionId), value]));
  return {
    variant,
    presentationAspects: (variant?.presentationAspects || []).map((value) => ({
      definitionId: value.definitionId,
      label: aspectById.get(String(value.definitionId))?.label || value.definitionId,
      weight: value.weight,
    })),
  };
}

async function entryRuntimeData(session, entry) {
  const [revision, namespaceRevision] = await Promise.all([
    ItemRevisionV2.findById(entry.itemRevisionId).lean(),
    NamespaceRevision.findById(entry.namespaceRevisionId).lean(),
  ]);
  if (!revision || !namespaceRevision) throw new AppError("Snapshot editoriale della Session non disponibile", 409);
  const presentation = effectivePresentation(session, entry);
  const text = resolvePresentationText({ revision, selection: presentation });
  return {
    revision,
    namespaceRevision,
    presentation: { ...presentation, text },
    ...presentationAspects(revision, namespaceRevision, presentation),
    kind: "visit_content",
    subjectId: null,
  };
}

async function semanticRuntimeData(session) {
  const state = session.semanticPresentation;
  if (!state) return null;
  const [revision, namespaceRevision] = await Promise.all([
    ItemRevisionV2.findById(state.itemRevisionId).lean(),
    NamespaceRevision.findById(state.namespaceRevisionId).lean(),
  ]);
  if (!revision || !namespaceRevision) throw new AppError("Presentation semantica della Session non disponibile", 409, [{ code: "SEMANTIC_PRESENTATION_UNAVAILABLE" }]);
  const presentation = state.presentation;
  const text = resolvePresentationText({ revision, selection: presentation });
  return {
    revision,
    namespaceRevision,
    presentation: { ...presentation.toObject?.() || presentation, text },
    ...presentationAspects(revision, namespaceRevision, presentation),
    kind: "semantic_exploration",
    subjectId: state.subjectId,
  };
}

function descriptor(definition, { serverInput = null, context = null } = {}) {
  return { ...definition, serverInput, context: context || {} };
}
function actionContext(entry, anchor) {
  return {
    contentEntryId: entry?._id || null,
    itemEditionId: entry?.itemEditionId || null,
    visitAnchorId: anchor?._id || null,
  };
}

function projectIllustrativeMedia(revision) {
  return (revision?.illustrativeMedia || []).slice(0, 1).map((media) => ({
    id: media._id,
    url: media.url,
    originalUrl: media.originalUrl || null,
    altText: media.altText || "",
    mimeType: media.mimeType || null,
    width: media.width || null,
    height: media.height || null,
    source: media.source || null,
    rights: media.rights || null,
  }));
}

async function navigationActions({ session, anchor, entry }) {
  if (!anchor) return [];
  const bundle = await loadPinnedBundle(session, anchor.venueId);
  const typeByKey = new Map((bundle.layout.placeTypes || []).map((type) => [type.key, type]));
  const intents = new Map();
  for (const place of bundle.layout.places || []) {
    const type = typeByKey.get(place.typeKey);
    for (const intent of type?.userIntents || []) {
      const normalized = String(intent || "").trim().toUpperCase();
      if (normalized && !intents.has(normalized)) intents.set(normalized, type?.label || null);
    }
  }
  const result = [];
  for (const [intent, label] of intents) {
    try {
      await routeToIntentInSession({ session, venueId: anchor.venueId, fromPlaceId: anchor.placeId, intent });
      result.push(descriptor(navigationActionDefinition(intent, label), {
        serverInput: { intent },
        context: actionContext(entry, anchor),
      }));
    } catch (error) {
      if (![404, 409].includes(error?.status)) throw error;
    }
  }
  return result;
}

async function semanticActions({ session, plan, entry, anchor }) {
  if (!entry && !session.semanticPresentation) return [];
  const values = await deriveSemanticExplorationActions({
    plan,
    currentItemId: session.semanticPresentation?.itemId || entry?.itemId || null,
    currentItemRevisionId: session.semanticPresentation?.itemRevisionId || entry?.itemRevisionId || null,
    currentSubjectId: session.semanticPresentation?.subjectId || null,
  });
  const base = actionContext(entry, anchor);
  return values.map((value) => descriptor(value.definition, {
    serverInput: value.serverInput,
    context: {
      ...base,
      semanticSubjectId: value.semanticContext.subjectId,
      semanticItemEditionId: value.semanticContext.itemEditionId,
    },
  }));
}

async function deriveRuntimeActions({ sessionId, userId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId, allowCompleted: true });
  if (["completed", "abandoned"].includes(session.status)) {
    return { session, plan, entry: null, runtime: null, anchor: null, actions: [] };
  }
  const entries = plan.contentEntries || [];
  const index = entries.length ? Math.min(Math.max(0, Number(session.currentEntryIndex) || 0), entries.length - 1) : 0;
  const entry = entries[index] || null;
  const anchor = entries.length ? effectiveAnchorForIndex(plan, index) : null;
  const context = actionContext(entry, anchor);
  const actions = [];

  if (session.status === "route_completed") {
    let completedRuntime = null;
    try {
      const baseRuntime = entry ? await entryRuntimeData(session, entry) : null;
      completedRuntime = session.semanticPresentation ? await semanticRuntimeData(session) : baseRuntime;
    } catch {
      // Il completamento deve restare disponibile anche se l'ultima Representation non e piu risolvibile.
    }
    if (entries.length) actions.push(descriptor(ACTION_DEFINITIONS.PROGRESS_PREVIOUS, { context }));
    actions.push(...await navigationActions({ session, anchor, entry }));
    actions.push(descriptor(ACTION_DEFINITIONS.COMPLETE, { context }));
    return { session, plan, entry, runtime: completedRuntime, anchor, actions };
  }

  const baseRuntime = entry ? await entryRuntimeData(session, entry) : null;
  const runtime = session.semanticPresentation ? await semanticRuntimeData(session) : baseRuntime;

  if (session.status === "paused") {
    actions.push(descriptor(ACTION_DEFINITIONS.RESUME, { context }));
    actions.push(descriptor(ACTION_DEFINITIONS.COMPLETE, { context }));
    return { session, plan, entry, runtime, anchor, actions };
  }

  if (entry && runtime) {
    if (index > 0) actions.push(descriptor(ACTION_DEFINITIONS.PROGRESS_PREVIOUS, { context }));
    actions.push(descriptor(ACTION_DEFINITIONS.PROGRESS_NEXT, { context }));
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "duration", direction: "up" })) {
      actions.push(descriptor(ACTION_DEFINITIONS.PRESENTATION_DEPTH_INCREASE, { context }));
    }
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "duration", direction: "down" })) {
      actions.push(descriptor(ACTION_DEFINITIONS.PRESENTATION_DEPTH_DECREASE, { context }));
    }
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "language", direction: "up" })) {
      actions.push(descriptor(ACTION_DEFINITIONS.PRESENTATION_COMPLEXITY_INCREASE, { context }));
    }
    if (findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis: "language", direction: "down" })) {
      actions.push(descriptor(ACTION_DEFINITIONS.PRESENTATION_COMPLEXITY_DECREASE, { context }));
    }
    if (session.semanticPresentation) actions.push(descriptor(ACTION_DEFINITIONS.SEMANTIC_RETURN, { context }));
    actions.push(...await semanticActions({ session, plan, entry, anchor }));
    if (nextPhysicalLeg(plan, anchor)) actions.push(descriptor(ACTION_DEFINITIONS.CHECK_ROUTE_OBSTACLES, { context }));
    actions.push(...await navigationActions({ session, anchor, entry }));
  }
  actions.push(descriptor(ACTION_DEFINITIONS.PAUSE, { context }));
  actions.push(descriptor(ACTION_DEFINITIONS.COMPLETE, { context }));
  return { session, plan, entry, runtime, anchor, actions };
}

async function currentSessionProjection({ sessionId, userId }) {
  const derived = await deriveRuntimeActions({ sessionId, userId });
  const { session, plan, entry, runtime, anchor, actions } = derived;
  const index = Number(session.currentEntryIndex) || 0;
  return {
    session: {
      id: session._id,
      status: session.status,
      sourceType: session.sourceType,
      currentEntryIndex: index,
      runtimeVersion: session.runtimeVersion,
    },
    planRevisionId: plan._id,
    current: entry && runtime ? {
      contentEntryId: entry._id,
      role: entry.role,
      label: session.semanticPresentation?.label || runtime.revision.label,
      authorCredits: runtime.revision.authorCredits || [],
      license: runtime.revision.metadata?.license || null,
      provenance: runtime.revision.provenance || null,
      illustrativeMedia: projectIllustrativeMedia(runtime.revision),
      presentation: { ...runtime.presentation, kind: runtime.kind },
      presentationAspects: runtime.presentationAspects,
      anchor: anchor ? {
        visitAnchorId: anchor._id,
        venueTargetId: anchor.venueTargetId,
        venueId: anchor.venueId,
      } : null,
    } : null,
    availableActions: actions.map(publicAction),
  };
}

async function advanceSession({ sessionId, userId, direction }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (!["active", "route_completed"].includes(session.status)) throw new AppError("Session non avanzabile nello stato corrente", 409);
  const entries = plan.contentEntries || [];
  if (!entries.length) throw new AppError("SessionPlan senza contenuti", 409);
  session.semanticPresentation = null;
  if (direction === "previous") {
    if (session.status === "route_completed") { session.status = "active"; session.routeCompletedAt = null; }
    else if (session.currentEntryIndex > 0) session.currentEntryIndex -= 1;
    else throw new AppError("Nessun contenuto precedente", 409);
  } else if (direction === "next") {
    if (session.status === "route_completed") throw new AppError("La sequenza della visita e terminata", 409);
    if (session.currentEntryIndex < entries.length - 1) session.currentEntryIndex += 1;
    else { session.status = "route_completed"; session.routeCompletedAt = new Date(); }
  } else throw new AppError("direction deve essere next o previous", 400);
  await session.save();
}

async function changePresentationAxis({ sessionId, userId, axis, direction }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  if (!entry) throw new AppError("ContentEntry corrente non disponibile", 409);
  const runtime = session.semanticPresentation ? await semanticRuntimeData(session) : await entryRuntimeData(session, entry);
  const next = findAdjacentPresentation({ revision: runtime.revision, namespaceRevision: runtime.namespaceRevision, current: runtime.presentation, axis, direction });
  if (!next) throw new AppError("Nessuna Representation adiacente disponibile", 409);
  const value = {
    variantId: next.variantId,
    representationId: next.representationId,
    durationTypeDefinitionId: next.durationTypeDefinitionId,
    languageLevelDefinitionId: next.languageLevelDefinitionId,
    locale: next.locale,
    estimatedContentSeconds: next.estimatedContentSeconds,
  };
  if (session.semanticPresentation) {
    session.semanticPresentation.presentation = value;
  } else {
    const override = { contentEntryId: entry._id, ...value, updatedAt: new Date() };
    const existing = session.presentationOverrides.find((item) => id(item.contentEntryId) === id(entry._id));
    if (existing) Object.assign(existing, override); else session.presentationOverrides.push(override);
  }
  await session.save();
}

async function openSemanticPresentationV2({ sessionId, userId, serverInput, sourceActionId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  if (!entry) throw new AppError("ContentEntry corrente non disponibile", 409);
  const currentRuntime = session.semanticPresentation ? await semanticRuntimeData(session) : await entryRuntimeData(session, entry);
  session.semanticPresentation = await materializeSemanticPresentation({
    plan,
    serverInput,
    currentRuntime,
    sourceActionId,
  });
  await session.save();
}

async function returnFromSemanticPresentationV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active" || !session.semanticPresentation) {
    throw new AppError("Nessun approfondimento semantico attivo", 409, [{ code: "SEMANTIC_PRESENTATION_NOT_ACTIVE" }]);
  }
  session.semanticPresentation = null;
  await session.save();
}

async function recordContentEntryExperience({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  if (!entry) throw new AppError("ContentEntry corrente non disponibile", 409);
  if (payload.contentEntryId && id(payload.contentEntryId) !== id(entry._id)) throw new AppError("contentEntryId non coincide con il contenuto corrente", 409);
  const semantic = session.semanticPresentation;
  const current = semantic ? semantic.presentation : effectivePresentation(session, entry);
  const itemEditionId = semantic?.itemEditionId || entry.itemEditionId;
  const itemRevisionId = semantic?.itemRevisionId || entry.itemRevisionId;
  const contentSeconds = Number(payload.contentSeconds ?? current.estimatedContentSeconds);
  const experiencedSeconds = Number(payload.experiencedSeconds);
  const completionRatio = payload.completionRatio === undefined ? 1 : Number(payload.completionRatio);
  const reliability = computeContentExperienceReliability({ contentSeconds, experiencedSeconds, completionRatio });
  if (!reliability) throw new AppError("Esperienza contenutistica non valida", 400);
  session.contentEntryExperiences.push({
    contentEntryId: entry._id,
    itemEditionId,
    itemRevisionId,
    variantId: current.variantId,
    representationId: current.representationId,
    contentSeconds,
    experiencedSeconds,
    completionRatio,
    reliability,
  });
  if (completionRatio >= 0.95) session.interactionEvents.push({
    category: "telemetry",
    actorUserId: userId,
    actionType: "CONTENT_ENTRY_COMPLETED",
    actionFamily: "content_experience",
    context: {
      contentEntryId: entry._id,
      itemEditionId: entry.itemEditionId,
      visitAnchorId: entry.deliveryAnchorId || null,
      semanticSubjectId: semantic?.subjectId || null,
      semanticItemEditionId: semantic?.itemEditionId || null,
    },
    result: { status: "recorded", code: null },
    metadata: { completionRatio },
    at: new Date(),
  });
  await session.save();
  return { experience: session.contentEntryExperiences.at(-1) };
}

async function recordVenueTargetObservationV2({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const entry = plan.contentEntries?.[session.currentEntryIndex];
  const anchorId = payload.visitAnchorId || entry?.deliveryAnchorId;
  const anchor = (plan.visitAnchors || []).find((value) => id(value._id) === id(anchorId));
  if (!anchor) throw new AppError("VisitAnchor non disponibile per l'osservazione", 409);
  const observedSeconds = Number(payload.observedSeconds);
  const reliability = computePhysicalObservationReliability({ observedSeconds });
  if (!reliability) throw new AppError("Osservazione fisica non valida", 400);
  session.venueTargetObservations.push({ visitAnchorId: anchor._id, venueTargetId: anchor.venueTargetId, observedSeconds, reliability });
  await session.save();
  return { observation: session.venueTargetObservations.at(-1) };
}

async function recordTransitionV2({ sessionId, userId, payload = {} }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("La Session deve essere attiva", 409);
  const currentAnchor = effectiveAnchorForIndex(plan, session.currentEntryIndex);
  const venueId = payload.venueId || currentAnchor?.venueId;
  if (!venueId) throw new AppError("venueId necessario per registrare la transizione", 400);
  const bundle = await loadPinnedBundle(session, venueId);
  const connection = (bundle.layout.connections || []).find((entry) => id(entry._id) === id(payload.connectionId));
  if (!connection) throw new AppError("Connection non appartiene alla LayoutRevision pinzata", 400);
  const observedSeconds = Number(payload.observedSeconds);
  const predictedSeconds = estimateConnectionSeconds(connection, { speedMps: session.sessionMovementSpeedMps, learnedResidualSeconds: 0 });
  const observedMovementSeconds = Math.max(0.1, observedSeconds - Math.max(0, Number(connection.additionalDelaySeconds) || 0));
  const speed = Number(connection.distanceMeters) > 0 ? Number(connection.distanceMeters) / observedMovementSeconds : null;
  const reliability = computeTransitionReliability({ distanceMeters: Number(connection.distanceMeters), predictedSeconds, observedSeconds });
  session.transitionObservations.push({
    venueId: bundle.pin.venueId,
    layoutRevisionId: bundle.pin.layoutRevisionId,
    connectionId: connection._id,
    distanceMeters: Number(connection.distanceMeters),
    predictedSeconds,
    observedSeconds,
    observedMovementSpeedMps: Number.isFinite(speed) ? speed : null,
    reliability,
  });
  if (reliability >= policy.learning.minimumReliability && Number.isFinite(speed) && speed >= policy.movement.minSpeedMps && speed <= policy.movement.maxSpeedMps) {
    session.sessionMovementSpeedMps = session.sessionMovementSpeedMps * 0.75 + speed * 0.25;
  }
  await session.save();
  return { observation: session.transitionObservations.at(-1), sessionMovementSpeedMps: session.sessionMovementSpeedMps };
}

async function routeToIntentV2({ sessionId, userId, intent }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  const origin = resolveNavigationOrigin({ session, plan });
  return routeToIntentInSession({ session, venueId: origin.venueId, fromPlaceId: origin.placeId, intent });
}

async function pauseSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "active") throw new AppError("Solo una Session attiva puo essere sospesa", 409);
  session.status = "paused";
  session.pauseIntervals.push({ startedAt: new Date(), endedAt: null });
  await session.save();
}

async function resumeSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (session.status !== "paused") throw new AppError("Session non in pausa", 409);
  const interval = session.pauseIntervals.at(-1);
  if (interval && !interval.endedAt) interval.endedAt = new Date();
  session.status = "active";
  await session.save();
}

async function completeSessionV2({ sessionId, userId }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (!["active", "paused", "route_completed"].includes(session.status)) throw new AppError("Session non completabile", 409);
  if (session.status === "paused") {
    const interval = session.pauseIntervals.at(-1);
    if (interval && !interval.endedAt) interval.endedAt = new Date();
  }
  session.status = "completed";
  session.completedAt = new Date();
  await session.save();
  const user = await User.findById(userId).select("learningPreferences").lean();
  const learning = { contentExposures: 0, physicalObservations: 0 };
  if (user?.learningPreferences?.personalHistory === true) {
    for (const experience of session.contentEntryExperiences || []) {
      if ((experience.reliability || 0) < policy.learning.minimumReliability) continue;
      await recordContentExposure({
        userId,
        itemEditionId: experience.itemEditionId,
        itemRevisionId: experience.itemRevisionId,
        variantId: experience.variantId,
        representationId: experience.representationId,
        completionRatio: experience.completionRatio,
        now: session.completedAt,
      });
      learning.contentExposures += 1;
    }
  }
  if (user?.learningPreferences?.collectiveContribution === true) {
    for (const observation of session.venueTargetObservations || []) {
      if ((observation.reliability || 0) < policy.learning.minimumReliability) continue;
      const result = await recordVenueTargetObservation({
        userId,
        venueTargetId: observation.venueTargetId,
        observedSeconds: observation.observedSeconds,
        reliability: observation.reliability,
      });
      if (result.accepted) learning.physicalObservations += 1;
    }
  }
  return { learning };
}

module.exports = {
  deriveRuntimeActions,
  currentSessionProjection,
  advanceSession,
  changePresentationDepthV2: (args) => changePresentationAxis({ ...args, axis: "duration" }),
  changePresentationComplexityV2: (args) => changePresentationAxis({ ...args, axis: "language" }),
  openSemanticPresentationV2,
  returnFromSemanticPresentationV2,
  recordContentEntryExperience,
  recordVenueTargetObservationV2,
  recordTransitionV2,
  routeToIntentV2,
  pauseSessionV2,
  resumeSessionV2,
  completeSessionV2,
};
