const AppError = require("../utils/AppError");
const { ACTION_DEFINITIONS, publicAction } = require("../config/runtimeActions");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const {
  id,
  loadPinnedBundle,
  resolveNavigationRequirementsForVenue,
} = require("./physicalExecutionV2.service");
const { selectionMap } = require("./routingProfileSelectionV2.service");
const { resolvePlannedPath } = require("./graphRouting.service");
const { resolveApproachStep } = require("./venueExhibitResolution.service");
const baseRuntime = require("./visitSessionV2.service");

function anchorMap(plan) {
  return new Map((plan?.visitAnchors || []).map((anchor) => [id(anchor._id), anchor]));
}

function effectiveAnchorForIndex(plan, index) {
  const anchors = anchorMap(plan);
  for (let cursor = Math.min(Number(index) || 0, (plan?.contentEntries || []).length - 1); cursor >= 0; cursor -= 1) {
    const anchorId = plan.contentEntries[cursor]?.deliveryAnchorId;
    if (anchorId && anchors.has(id(anchorId))) return anchors.get(id(anchorId));
  }
  return null;
}

function actionContext(entry, anchor) {
  return {
    contentEntryId: entry?._id || null,
    itemEditionId: entry?.itemEditionId || null,
    visitAnchorId: anchor?._id || null,
  };
}

function progressDescriptor(definition, label, context) {
  return {
    ...definition,
    label,
    context,
    serverInput: null,
  };
}

function currentLogisticsStep(session) {
  const progress = session?.logisticsProgress;
  if (!progress) return null;
  const stepIndex = Number(progress.stepIndex) || 0;
  return progress.steps?.[stepIndex] || null;
}

function routingBlockerDetails(blockers = [], venueId) {
  return blockers.map((blocker) => ({
    code: blocker.code || "PHYSICAL_REQUIREMENT_UNRESOLVED",
    message: blocker.message || "Requisito di percorso non risolvibile nella Venue pinzata.",
    context: {
      venueId,
      priority: blocker.priority || "required",
      physicalFeatureRef: blocker.physicalFeatureRef || null,
    },
  }));
}

function fallbackConnectionInstruction(edge, layout) {
  const destination = (layout?.places || []).find((place) => id(place._id) === id(edge.toPlaceId));
  if (String(destination?.label || "").trim()) return `Prosegui verso ${destination.label}.`;
  return "Prosegui lungo il percorso indicato sulla mappa.";
}

function projectConnectionStep(edge, bundle, venueId) {
  return {
    kind: "connection",
    instruction: String(edge.instruction || "").trim() || fallbackConnectionInstruction(edge, bundle.layout),
    venueId,
    connectionId: edge.connectionId,
    distanceMeters: Math.max(0, Number(edge.distanceMeters) || 0),
    estimatedSeconds: Math.max(0, Math.round(Number(edge.estimatedSeconds) || 0)),
    resolutionSource: edge.instruction ? "connection_instruction" : "connection_fallback",
  };
}

function projectApproachStep(step, venueId) {
  if (!step?.instruction) return null;
  return {
    kind: "approach",
    instruction: step.instruction,
    venueId,
    connectionId: null,
    distanceMeters: null,
    estimatedSeconds: null,
    resolutionSource: step.resolutionSource || "fallback",
  };
}

async function destinationApproachStep({ session, fromAnchor = null, toAnchor, incomingConnectionId = null }) {
  if (!toAnchor?.venueId || !toAnchor?.exhibitSlotId) return null;
  const bundle = await loadPinnedBundle(session, toAnchor.venueId);
  const approach = resolveApproachStep({
    layoutRevision: bundle.layout,
    destinationExhibitSlotId: toAnchor.exhibitSlotId,
    sourceExhibitSlotId: fromAnchor?.exhibitSlotId || null,
    incomingConnectionId,
  });
  return projectApproachStep(approach, toAnchor.venueId);
}

async function materializeIndoorSteps({ session, leg, fromAnchor, toAnchor }) {
  const bundle = await loadPinnedBundle(session, fromAnchor.venueId);
  if (id(leg.venueReleaseId) !== id(bundle.pin.venueReleaseId) || id(leg.layoutRevisionId) !== id(bundle.pin.layoutRevisionId)) {
    throw new AppError("Il percorso pianificato non appartiene allo snapshot fisico pinzato dalla Session", 409, [{
      code: "SESSION_LOGISTICS_SNAPSHOT_MISMATCH",
      context: { venueId: fromAnchor.venueId, fromAnchorId: fromAnchor._id, toAnchorId: toAnchor._id },
    }]);
  }

  const profileSelections = selectionMap(session.navigationSnapshot?.routingProfileSelections || []);
  const translated = resolveNavigationRequirementsForVenue({
    bundle,
    globalRequirements: session.navigationSnapshot?.requirements || [],
    routingProfileSelection: profileSelections.get(id(fromAnchor.venueId)) || null,
  });
  if (translated.blockers?.length) {
    throw new AppError(
      "Il percorso pianificato non soddisfa più i requisiti fisici della Session",
      409,
      routingBlockerDetails(translated.blockers, fromAnchor.venueId),
    );
  }

  const resolved = resolvePlannedPath({
    connections: bundle.layout.connections || [],
    places: bundle.layout.places || [],
    pathConnectionIds: leg.path || [],
    fromPlaceId: fromAnchor.placeId,
    toPlaceId: toAnchor.placeId,
    requirements: translated.requirements || [],
    speedMps: session.sessionMovementSpeedMps,
  });
  if (!resolved.reachable) {
    throw new AppError("Il percorso della Session non è più percorribile nello snapshot pinzato", 409, [{
      code: "SESSION_PLANNED_PATH_UNREACHABLE",
      context: { venueId: fromAnchor.venueId, fromAnchorId: fromAnchor._id, toAnchorId: toAnchor._id },
    }]);
  }

  const steps = (resolved.path || []).map((edge) => projectConnectionStep(edge, bundle, fromAnchor.venueId));
  const approach = await destinationApproachStep({
    session,
    fromAnchor,
    toAnchor,
    incomingConnectionId: resolved.path?.at(-1)?.connectionId || null,
  });
  if (approach) steps.push(approach);
  return steps;
}

async function materializeInterVenueSteps({ session, leg, fromAnchor, toAnchor }) {
  const steps = [{
    kind: "transfer",
    instruction: String(leg.instruction || "").trim() || "Raggiungi la sede della prossima tappa.",
    venueId: toAnchor.venueId,
    connectionId: null,
    distanceMeters: null,
    estimatedSeconds: Math.max(0, Math.round(Number(leg.estimatedSeconds) || 0)),
    resolutionSource: leg.instruction ? "route_hint" : "transfer_fallback",
  }];
  const approach = await destinationApproachStep({ session, fromAnchor, toAnchor });
  if (approach) steps.push(approach);
  return steps;
}

async function materializeLogisticsSteps({ session, plan, fromAnchor, toAnchor }) {
  if (!toAnchor) return [];
  if (!fromAnchor) {
    const approach = await destinationApproachStep({ session, toAnchor });
    return approach ? [approach] : [];
  }
  if (id(fromAnchor._id) === id(toAnchor._id)) return [];

  const leg = (plan?.physicalRoute?.legs || []).find((candidate) => (
    id(candidate.fromAnchorId) === id(fromAnchor._id)
    && id(candidate.toAnchorId) === id(toAnchor._id)
  ));
  if (!leg) {
    throw new AppError("La SessionPlan non contiene la logistica tra le due tappe", 409, [{
      code: "SESSION_LOGISTICS_LEG_NOT_FOUND",
      context: { fromAnchorId: fromAnchor._id, toAnchorId: toAnchor._id },
    }]);
  }
  if (leg.type === "indoor") return materializeIndoorSteps({ session, leg, fromAnchor, toAnchor });
  if (leg.type === "inter_venue") return materializeInterVenueSteps({ session, leg, fromAnchor, toAnchor });
  throw new AppError("Tipo di tratta logistica non supportato", 409, [{ code: "SESSION_LOGISTICS_LEG_UNSUPPORTED" }]);
}

async function advanceSessionWithLogistics({ sessionId, userId, direction }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  if (!["active", "route_completed"].includes(session.status)) {
    throw new AppError("Session non avanzabile nello stato corrente", 409);
  }

  if (session.logisticsProgress) {
    session.semanticPresentation = null;
    if (direction === "previous") {
      if (session.logisticsProgress.stepIndex > 0) session.logisticsProgress.stepIndex -= 1;
      else session.logisticsProgress = null;
      await session.save();
      return;
    }
    if (direction !== "next") throw new AppError("direction deve essere next o previous", 400);
    const lastStepIndex = session.logisticsProgress.steps.length - 1;
    if (session.logisticsProgress.stepIndex < lastStepIndex) {
      session.logisticsProgress.stepIndex += 1;
    } else {
      session.currentEntryIndex = session.logisticsProgress.targetEntryIndex;
      session.logisticsProgress = null;
    }
    await session.save();
    return;
  }

  if (direction === "previous") {
    await baseRuntime.advanceSession({ sessionId, userId, direction });
    return;
  }
  if (direction !== "next") throw new AppError("direction deve essere next o previous", 400);

  const entries = plan.contentEntries || [];
  if (!entries.length || session.status === "route_completed" || session.currentEntryIndex >= entries.length - 1) {
    await baseRuntime.advanceSession({ sessionId, userId, direction });
    return;
  }

  const fromEntryIndex = Number(session.currentEntryIndex) || 0;
  const targetEntryIndex = fromEntryIndex + 1;
  const fromAnchor = effectiveAnchorForIndex(plan, fromEntryIndex);
  const toAnchor = effectiveAnchorForIndex(plan, targetEntryIndex);
  if (id(fromAnchor?._id) === id(toAnchor?._id)) {
    await baseRuntime.advanceSession({ sessionId, userId, direction });
    return;
  }

  const steps = await materializeLogisticsSteps({ session, plan, fromAnchor, toAnchor });
  if (!steps.length || !toAnchor) {
    throw new AppError("Le indicazioni logistiche per la prossima tappa non sono disponibili", 409, [{
      code: "SESSION_LOGISTICS_STEPS_UNAVAILABLE",
      context: { fromEntryIndex, targetEntryIndex },
    }]);
  }

  session.semanticPresentation = null;
  session.logisticsProgress = {
    fromEntryIndex,
    targetEntryIndex,
    fromVisitAnchorId: fromAnchor?._id || null,
    toVisitAnchorId: toAnchor._id,
    stepIndex: 0,
    steps,
  };
  await session.save();
}

async function deriveRuntimeActionsWithLogistics({ sessionId, userId }) {
  const derived = await baseRuntime.deriveRuntimeActions({ sessionId, userId });
  const progress = derived.session.logisticsProgress;
  if (!progress || derived.session.status !== "active") return derived;

  const context = actionContext(derived.entry, derived.anchor);
  const preserved = derived.actions.filter((action) => ["navigation", "lifecycle"].includes(action.family));
  return {
    ...derived,
    actions: [
      progressDescriptor(ACTION_DEFINITIONS.PROGRESS_PREVIOUS, "Indietro", context),
      progressDescriptor(ACTION_DEFINITIONS.PROGRESS_NEXT, "Avanti", context),
      ...preserved,
    ],
  };
}

async function currentSessionProjectionWithLogistics({ sessionId, userId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId, allowCompleted: true });
  if (!session.logisticsProgress || ["completed", "abandoned"].includes(session.status)) {
    return baseRuntime.currentSessionProjection({ sessionId, userId });
  }

  const step = currentLogisticsStep(session);
  if (!step) throw new AppError("Stato logistico della Session non valido", 409, [{ code: "SESSION_LOGISTICS_STATE_INVALID" }]);
  const derived = await deriveRuntimeActionsWithLogistics({ sessionId, userId });
  const stepIndex = Number(session.logisticsProgress.stepIndex) || 0;
  const stepCount = session.logisticsProgress.steps.length;
  const title = step.kind === "approach"
    ? "Ultimi passi"
    : step.kind === "transfer" ? "Verso la prossima sede" : "Verso la prossima tappa";

  return {
    session: {
      id: session._id,
      status: session.status,
      sourceType: session.sourceType,
      currentEntryIndex: Number(session.currentEntryIndex) || 0,
      runtimeVersion: session.runtimeVersion,
    },
    planRevisionId: plan._id,
    current: {
      contentEntryId: null,
      role: null,
      label: title,
      authorCredits: [],
      license: null,
      provenance: null,
      illustrativeMedia: [],
      presentation: {
        text: step.instruction,
        locale: "it-IT",
        kind: "logistics",
        ...(step.estimatedSeconds != null ? { estimatedContentSeconds: step.estimatedSeconds } : {}),
      },
      presentationAspects: [],
      anchor: null,
      logistics: {
        kind: step.kind,
        stepNumber: stepIndex + 1,
        stepCount,
        distanceMeters: step.distanceMeters ?? null,
        estimatedSeconds: step.estimatedSeconds ?? null,
      },
    },
    availableActions: derived.actions.filter((action) => !action.hidden).map(publicAction),
  };
}

module.exports = {
  effectiveAnchorForIndex,
  materializeLogisticsSteps,
  advanceSessionWithLogistics,
  deriveRuntimeActionsWithLogistics,
  currentSessionProjectionWithLogistics,
};
