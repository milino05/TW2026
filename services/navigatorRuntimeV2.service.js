const VisitSessionV2 = require("../models/visitSessionV2.model");
const AppError = require("../utils/AppError");
const {
  ACTION_DEFINITIONS,
  physicalNavigationActionDefinition,
  publicAction,
} = require("../config/runtimeActions");
const {
  deriveRuntimeActions: deriveBaseRuntimeActions,
  currentSessionProjection: currentBaseSessionProjection,
  advanceSession,
} = require("./visitSessionV2.service");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const { resetSynchronizedPlayback } = require("./synchronizedVisitSession.service");
const {
  id,
  loadPinnedBundle,
  routeToPhysicalFeatureInSession,
} = require("./physicalExecutionV2.service");
const {
  EXECUTION_PHASES,
  anchorById,
  deriveVisitExecutionState,
} = require("./visitExecutionRuntimeV2.service");
const {
  resolveLiveRouteV2,
  confirmPhysicalLocationV2,
  correctPhysicalLocationV2,
  advancePhysicalProgressV2,
  startPhysicalDetourV2,
  returnToVisitV2,
  clearPhysicalDetour,
} = require("./visitPhysicalRuntimeV2.service");

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

function personalAction(session, definition, options = {}) {
  return descriptor({
    ...definition,
    runtimeScope: "visit_session",
    runtimeVersion: session.runtimeVersion,
  }, options);
}

function groupAction(synchronizedSession, definition, options = {}) {
  return descriptor({
    ...definition,
    runtimeScope: "synchronized_visit_session",
    runtimeVersion: synchronizedSession.runtimeVersion,
  }, options);
}

function stableActionKey(action) {
  return `${action.runtimeScope || ""}:${action.actionId}`;
}

function dedupeActions(actions = []) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = stableActionKey(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function baseActionsByFamilies(actions, allowedFamilies) {
  return (actions || []).filter((action) => allowedFamilies.has(action.family));
}

function visitStopHasContent(plan, visitAnchorId) {
  return (plan?.contentEntries || []).some((entry) => id(entry.deliveryAnchorId) === id(visitAnchorId));
}

function visitStopIndex(plan, visitAnchorId) {
  return (plan?.contentEntries || []).findIndex((entry) => id(entry.deliveryAnchorId) === id(visitAnchorId));
}

function stopSelectionDefinition(plan) {
  return (plan?.visitAnchors || []).some((anchor) => visitStopHasContent(plan, anchor._id))
    ? ACTION_DEFINITIONS.VISIT_STOP_SELECT
    : null;
}

async function physicalFeatureActions({ session, routingSession, execution, entry }) {
  const knownLocation = execution.knownLocation;
  if (!knownLocation?.venueId || !knownLocation?.placeId) return [];
  const bundle = await loadPinnedBundle(routingSession, knownLocation.venueId);
  const definitionsById = new Map((bundle.physicalVocabularyRevision.placeTypes || [])
    .map((definition) => [definition.definitionId, definition]));
  const availableDefinitionIds = new Set();
  for (const place of bundle.layout.places || []) {
    const definition = definitionsById.get(place.placeTypeDefinitionId);
    if (definition?.metadata?.navigationTarget === true) availableDefinitionIds.add(definition.definitionId);
  }
  const result = [];
  for (const definitionId of availableDefinitionIds) {
    const definition = definitionsById.get(definitionId);
    const physicalFeatureRef = {
      kind: "local",
      physicalVocabularyId: bundle.physicalVocabulary._id,
      definitionId,
    };
    try {
      await routeToPhysicalFeatureInSession({
        session: routingSession,
        venueId: knownLocation.venueId,
        fromPlaceId: knownLocation.placeId,
        physicalFeatureRef,
      });
      result.push(personalAction(session, physicalNavigationActionDefinition(definition), {
        serverInput: { physicalFeatureRef },
        context: actionContext(entry, execution.contextAnchor),
      }));
    } catch (error) {
      if (![404, 409].includes(error?.status)) throw error;
    }
  }
  return result;
}

function synchronizedPlaybackOverridesPhysicalGate({ synchronizedSession, entry }) {
  if (!synchronizedSession || !entry) return false;
  if (!["playing", "paused"].includes(synchronizedSession.playback?.state)) return false;
  return id(synchronizedSession.playback?.contentEntryId) === id(entry._id);
}

async function deriveNavigatorRuntimeActions({ sessionId, userId }) {
  const base = await deriveBaseRuntimeActions({ sessionId, userId });
  const {
    session,
    plan,
    synchronizedSession,
    membership,
    effectiveStatus,
    physicalSession: routingSession,
  } = base;
  if (!plan || ["completed", "abandoned", "cancelled"].includes(effectiveStatus)) return base;
  if (synchronizedSession?.status === "lobby" || synchronizedSession?.status === "quiz") return base;
  if (!synchronizedSession && session.status === "paused") return base;

  const execution = deriveVisitExecutionState({
    personalSession: session,
    plan,
    currentEntryIndex: base.currentEntryIndex,
    effectiveStatus,
  });
  const entry = execution.entry;
  const context = actionContext(entry, execution.contextAnchor);
  const actions = [];
  const keepLifecycle = () => actions.push(...baseActionsByFamilies(base.actions, new Set(["lifecycle", "synchronization"])));
  const stopDefinition = stopSelectionDefinition(plan);
  const stopAction = stopDefinition
    ? synchronizedSession
      ? membership?.role === "host" ? groupAction(synchronizedSession, stopDefinition, { context }) : null
      : personalAction(session, stopDefinition, { context })
    : null;

  if (execution.phase === EXECUTION_PHASES.LOCATION_REQUIRED) {
    actions.push(personalAction(session, ACTION_DEFINITIONS.LOCATION_CONFIRM, { context }));
    if (stopAction) actions.push(stopAction);
    keepLifecycle();
    return { ...base, execution, actions: dedupeActions(actions) };
  }

  if (execution.knownLocation) {
    actions.push(personalAction(session, ACTION_DEFINITIONS.LOCATION_CORRECT, { context }));
  }

  if ([EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, EXECUTION_PHASES.APPROACHING_VISIT_TARGET, EXECUTION_PHASES.NAVIGATING_DETOUR].includes(execution.phase)) {
    actions.push(personalAction(session, ACTION_DEFINITIONS.PROGRESS_NEXT, {
      serverInput: { executionMode: "physical" },
      context,
    }));
    if (execution.detour) actions.push(personalAction(session, ACTION_DEFINITIONS.NAVIGATION_RETURN_TO_VISIT, { context }));
    if (stopAction) actions.push(stopAction);
    actions.push(...await physicalFeatureActions({ session, routingSession, execution, entry }));
    keepLifecycle();
    return { ...base, execution, actions: dedupeActions(actions) };
  }

  if (execution.phase === EXECUTION_PHASES.AT_DETOUR_DESTINATION) {
    actions.push(personalAction(session, ACTION_DEFINITIONS.NAVIGATION_RETURN_TO_VISIT, { context }));
    if (stopAction) actions.push(stopAction);
    actions.push(...await physicalFeatureActions({ session, routingSession, execution, entry }));
    keepLifecycle();
    return { ...base, execution, actions: dedupeActions(actions) };
  }

  if (execution.phase === EXECUTION_PHASES.ROUTE_COMPLETED) {
    actions.push(...baseActionsByFamilies(base.actions, new Set(["progress", "lifecycle"])));
    if (stopAction) actions.push(stopAction);
    actions.push(...await physicalFeatureActions({ session, routingSession, execution, entry }));
    return { ...base, execution, actions: dedupeActions(actions) };
  }

  const presentationAllowed = execution.presentationAvailable
    || synchronizedPlaybackOverridesPhysicalGate({ synchronizedSession, entry });
  if (presentationAllowed) {
    actions.push(...base.actions.filter((action) => action.family !== "navigation"));
  } else {
    keepLifecycle();
  }
  if (stopAction) actions.push(stopAction);
  actions.push(...await physicalFeatureActions({ session, routingSession, execution, entry }));
  return { ...base, execution, actions: dedupeActions(actions) };
}

function projectionStopOrder(plan, anchor) {
  if (!anchor) return null;
  const index = (plan?.visitAnchors || []).findIndex((value) => id(value._id) === id(anchor._id));
  return index >= 0 ? index + 1 : null;
}

function projectKnownLocation(location) {
  if (!location) return null;
  return {
    venueId: location.venueId,
    placeId: location.placeId,
    visitAnchorId: location.visitAnchorId || null,
    venueTargetId: location.venueTargetId || null,
    exhibitSlotId: location.exhibitSlotId || null,
    source: location.source,
    providerId: location.providerId || null,
    observedAt: location.observedAt || null,
  };
}

function projectLiveNavigationSummary(navigation) {
  if (!navigation) return null;
  if (navigation.type === "inter_venue") {
    return {
      intent: navigation.intent,
      type: "inter_venue",
      destination: navigation.destination,
      nextInstruction: navigation.transferInstruction || null,
      remainingStepCount: 1,
      estimatedSeconds: Math.round(Number(navigation.estimatedSeconds) || 0),
      distanceMeters: null,
    };
  }
  const firstStep = navigation.path?.[0] || null;
  return {
    intent: navigation.intent,
    type: "indoor",
    destination: navigation.destination,
    nextInstruction: firstStep?.instruction || null,
    remainingStepCount: navigation.path?.length || 0,
    estimatedSeconds: Math.round(Number(navigation.estimatedSeconds) || 0),
    distanceMeters: Math.round((Number(navigation.distanceMeters) || 0) * 10) / 10,
  };
}

async function currentNavigatorRuntimeProjection({ sessionId, userId }) {
  const derived = await deriveNavigatorRuntimeActions({ sessionId, userId });
  const baseProjection = await currentBaseSessionProjection({ sessionId, userId });
  if (!derived.execution) {
    return { ...baseProjection, availableActions: derived.actions.filter((action) => !action.hidden).map(publicAction) };
  }
  const {
    session,
    plan,
    synchronizedSession,
    execution,
  } = derived;
  const presentationAllowed = execution.presentationAvailable
    || synchronizedPlaybackOverridesPhysicalGate({ synchronizedSession, entry: execution.entry });
  const liveNavigation = [EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, EXECUTION_PHASES.NAVIGATING_DETOUR]
    .includes(execution.phase)
    ? await resolveLiveRouteV2({
      personalSession: session,
      routingSession: derived.physicalSession,
      plan,
      currentEntryIndex: derived.currentEntryIndex,
      effectiveStatus: derived.effectiveStatus,
    })
    : null;
  return {
    ...baseProjection,
    progress: {
      currentEntryIndex: derived.currentEntryIndex,
      contentEntryCount: plan.contentEntries?.length || 0,
      deliveryVisitAnchorId: execution.deliveryAnchor?._id || null,
      contextVisitAnchorId: execution.contextAnchor?._id || null,
      currentStopOrder: projectionStopOrder(plan, execution.contextAnchor),
    },
    experience: {
      phase: execution.phase,
      presentationAvailable: presentationAllowed,
    },
    physical: {
      knownLocation: projectKnownLocation(execution.knownLocation),
      detour: execution.detour ? {
        destination: {
          venueId: execution.detour.destination.venueId,
          placeId: execution.detour.destination.placeId,
          physicalFeatureRef: execution.detour.destination.physicalFeatureRef || null,
        },
        startedAt: execution.detour.startedAt || null,
      } : null,
      navigation: projectLiveNavigationSummary(liveNavigation),
    },
    current: presentationAllowed ? baseProjection.current : null,
    availableActions: derived.actions.filter((action) => !action.hidden).map(publicAction),
  };
}

async function loadNavigatorState({ sessionId, userId, allowCompleted = false }) {
  return getCurrentSessionPlanV2({ sessionId, userId, allowCompleted });
}

async function confirmNavigatorLocationV2({ sessionId, userId, locationRef }) {
  const state = await loadNavigatorState({ sessionId, userId });
  return confirmPhysicalLocationV2({
    personalSession: state.session,
    routingSession: state.physicalSession,
    plan: state.plan,
    locationRef,
  });
}

async function correctNavigatorLocationV2({ sessionId, userId, locationRef }) {
  const state = await loadNavigatorState({ sessionId, userId });
  return correctPhysicalLocationV2({
    personalSession: state.session,
    routingSession: state.physicalSession,
    plan: state.plan,
    locationRef,
  });
}

async function advanceNavigatorPhysicalProgressV2({ sessionId, userId }) {
  const state = await loadNavigatorState({ sessionId, userId });
  const result = await advancePhysicalProgressV2({
    personalSession: state.session,
    routingSession: state.physicalSession,
    plan: state.plan,
    currentEntryIndex: state.currentEntryIndex,
    effectiveStatus: state.effectiveStatus,
  });
  return {
    type: result.type,
    knownLocation: projectKnownLocation(result.knownLocation),
  };
}

async function startNavigatorPhysicalDetourV2({ sessionId, userId, physicalFeatureRef }) {
  const state = await loadNavigatorState({ sessionId, userId });
  return startPhysicalDetourV2({
    personalSession: state.session,
    routingSession: state.physicalSession,
    physicalFeatureRef,
  });
}

async function returnNavigatorToVisitV2({ sessionId, userId }) {
  const state = await loadNavigatorState({ sessionId, userId });
  await returnToVisitV2({ personalSession: state.session });
}

async function advanceNavigatorNarrativeProgressV2({ sessionId, userId, direction }) {
  const before = await loadNavigatorState({ sessionId, userId, allowCompleted: true });
  await advanceSession({ sessionId, userId, direction });
  if (before.synchronizedSession) {
    await VisitSessionV2.updateMany(
      { synchronizedSessionId: before.synchronizedSession._id },
      { $set: { semanticPresentation: null } },
    );
  }
}

async function selectNavigatorVisitStopV2({ sessionId, userId, visitAnchorId }) {
  const state = await loadNavigatorState({ sessionId, userId, allowCompleted: true });
  const anchor = anchorById(state.plan, visitAnchorId);
  if (!anchor) throw new AppError("Tappa non disponibile", 404, [{ code: "VISIT_STOP_NOT_FOUND" }]);
  const index = visitStopIndex(state.plan, anchor._id);
  if (index < 0) throw new AppError("La tappa non contiene contenuti", 409, [{ code: "VISIT_STOP_HAS_NO_CONTENT" }]);
  if (state.synchronizedSession && state.membership?.role !== "host") {
    throw new AppError("Solo la guida può cambiare la tappa comune", 403, [{ code: "SYNCHRONIZED_HOST_REQUIRED" }]);
  }

  state.session.semanticPresentation = null;
  clearPhysicalDetour(state.session);
  if (state.synchronizedSession) {
    state.synchronizedSession.currentEntryIndex = index;
    resetSynchronizedPlayback(state.synchronizedSession, { changedBy: userId });
    await Promise.all([
      state.synchronizedSession.save(),
      state.session.save(),
      VisitSessionV2.updateMany(
        { synchronizedSessionId: state.synchronizedSession._id },
        { $set: { semanticPresentation: null } },
      ),
    ]);
  } else {
    state.session.currentEntryIndex = index;
    if (state.session.status === "route_completed") {
      state.session.status = "active";
      state.session.routeCompletedAt = null;
    }
    await state.session.save();
  }
  return { visitAnchorId: anchor._id, currentEntryIndex: index };
}

module.exports = {
  deriveNavigatorRuntimeActions,
  currentNavigatorRuntimeProjection,
  confirmNavigatorLocationV2,
  correctNavigatorLocationV2,
  advanceNavigatorPhysicalProgressV2,
  startNavigatorPhysicalDetourV2,
  returnNavigatorToVisitV2,
  advanceNavigatorNarrativeProgressV2,
  selectNavigatorVisitStopV2,
  synchronizedPlaybackOverridesPhysicalGate,
  projectLiveNavigationSummary,
  visitStopIndex,
};
