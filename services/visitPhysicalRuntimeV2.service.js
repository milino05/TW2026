const AppError = require("../utils/AppError");
const { resolveRoute } = require("./graphRouting.service");
const { selectionMap } = require("./routingProfileSelectionV2.service");
const {
  id,
  loadPinnedBundle,
  resolveNavigationRequirementsForVenue,
  routingBlockerDetails,
  routeToPhysicalFeatureInSession,
} = require("./physicalExecutionV2.service");
const {
  EXECUTION_PHASES,
  anchorById,
  deriveVisitExecutionState,
} = require("./visitExecutionRuntimeV2.service");

const EXACT_ANCHOR_LOCATION_SOURCES = new Set([
  "navigation_confirmation",
  "qr",
  "teleport",
  "geolocation",
]);

function requirePersistableSession(session) {
  if (!session || typeof session.save !== "function") {
    throw new Error("VisitSession persistibile richiesta");
  }
  return session;
}

function ensurePhysicalRuntime(session) {
  if (!session.physicalRuntime) session.physicalRuntime = { knownLocation: null, detour: null };
  return session.physicalRuntime;
}

function findPlace(bundle, placeId) {
  return (bundle?.layout?.places || []).find((place) => id(place._id) === id(placeId)) || null;
}

function knownLocationValue({
  venueId,
  placeId,
  visitAnchorId = null,
  venueTargetId = null,
  exhibitSlotId = null,
  source,
  providerId = null,
  observedAt = new Date(),
  acceptedAt = new Date(),
}) {
  return {
    venueId,
    placeId,
    visitAnchorId,
    venueTargetId,
    exhibitSlotId,
    source,
    providerId,
    observedAt,
    acceptedAt,
  };
}

function anchorLocationValue(anchor, {
  source,
  providerId = null,
  observedAt = new Date(),
} = {}) {
  if (!anchor) throw new AppError("Tappa non disponibile", 404, [{ code: "VISIT_STOP_NOT_FOUND" }]);
  const exactAnchorEvidence = EXACT_ANCHOR_LOCATION_SOURCES.has(source);
  return knownLocationValue({
    venueId: anchor.venueId,
    placeId: anchor.placeId,
    visitAnchorId: exactAnchorEvidence ? anchor._id : null,
    venueTargetId: exactAnchorEvidence ? anchor.venueTargetId : null,
    exhibitSlotId: exactAnchorEvidence ? anchor.exhibitSlotId : null,
    source,
    providerId,
    observedAt,
  });
}

function assignKnownLocation(personalSession, location) {
  const runtime = ensurePhysicalRuntime(personalSession);
  runtime.knownLocation = location;
  return runtime.knownLocation;
}

function clearPhysicalDetour(personalSession) {
  const runtime = ensurePhysicalRuntime(personalSession);
  runtime.detour = null;
}

function resolvedRoutingRequirements({ routingSession, bundle, venueId }) {
  const profileSelections = selectionMap(routingSession?.navigationSnapshot?.routingProfileSelections || []);
  const localRequirements = (routingSession?.navigationSnapshot?.venueRequirements || [])
    .find((entry) => id(entry.venueId) === id(venueId))?.requirements || [];
  const translated = resolveNavigationRequirementsForVenue({
    bundle,
    globalRequirements: routingSession?.navigationSnapshot?.requirements || [],
    localRequirements,
    routingProfileSelection: profileSelections.get(id(venueId)) || null,
  });
  if (translated.blockers.length) {
    throw new AppError(
      "Snapshot fisica non supporta la configurazione di routing richiesta",
      409,
      routingBlockerDetails(translated.blockers, { venueId }),
    );
  }
  return translated;
}

function resolveIndoorLiveRouteFromBundle({ routingSession, bundle, fromPlaceId, toPlaceId }) {
  const from = findPlace(bundle, fromPlaceId);
  const to = findPlace(bundle, toPlaceId);
  if (!from || !to) {
    throw new AppError("Posizione fisica non disponibile nello snapshot della Session", 409, [{
      code: "PHYSICAL_PLACE_NOT_FOUND",
      context: { venueId: bundle?.pin?.venueId || null, fromPlaceId, toPlaceId },
    }]);
  }
  const translated = resolvedRoutingRequirements({ routingSession, bundle, venueId: bundle.pin.venueId });
  const route = resolveRoute({
    connections: bundle.layout.connections || [],
    places: bundle.layout.places || [],
    fromPlaceId: from._id,
    toPlaceId: to._id,
    requirements: translated.requirements,
    speedMps: routingSession.sessionMovementSpeedMps,
    learnedResidualByConnection: {},
  });
  if (!route.reachable) {
    throw new AppError("Nessun percorso live compatibile verso la destinazione", 409, [{
      code: "LIVE_ROUTE_UNREACHABLE",
      context: { venueId: bundle.pin.venueId, fromPlaceId: from._id, toPlaceId: to._id },
    }]);
  }
  return {
    type: "indoor",
    venueId: bundle.pin.venueId,
    fromPlaceId: from._id,
    toPlaceId: to._id,
    destination: { venueId: bundle.pin.venueId, placeId: to._id },
    warnings: translated.warnings.map((warning) => ({ ...warning, venueId: bundle.pin.venueId })),
    ...route,
  };
}

async function resolveIndoorLiveRoute({ routingSession, venueId, fromPlaceId, toPlaceId }) {
  const bundle = await loadPinnedBundle(routingSession, venueId);
  return resolveIndoorLiveRouteFromBundle({ routingSession, bundle, fromPlaceId, toPlaceId });
}

function resolvePlannedInterVenueRoute({ plan, knownLocation, destinationAnchor }) {
  if (!knownLocation?.visitAnchorId || !destinationAnchor?._id) {
    throw new AppError("Trasferimento inter-sede live non determinabile dalla posizione corrente", 409, [{
      code: "LIVE_INTER_VENUE_ROUTE_UNAVAILABLE",
    }]);
  }
  const leg = (plan?.physicalRoute?.legs || []).find((entry) => entry.type === "inter_venue"
    && id(entry.fromAnchorId) === id(knownLocation.visitAnchorId)
    && id(entry.toAnchorId) === id(destinationAnchor._id));
  if (!leg) {
    throw new AppError("Trasferimento inter-sede live non disponibile", 409, [{
      code: "LIVE_INTER_VENUE_ROUTE_UNAVAILABLE",
      context: { fromVisitAnchorId: knownLocation.visitAnchorId, toVisitAnchorId: destinationAnchor._id },
    }]);
  }
  return {
    type: "inter_venue",
    fromVisitAnchorId: leg.fromAnchorId,
    toVisitAnchorId: leg.toAnchorId,
    destination: { venueId: destinationAnchor.venueId, placeId: destinationAnchor.placeId },
    path: [],
    estimatedSeconds: Number(leg.estimatedSeconds) || 0,
    distanceMeters: null,
    transferInstruction: leg.instruction || null,
    warnings: [],
  };
}

async function resolveLiveRouteV2({ personalSession, routingSession, plan, currentEntryIndex, effectiveStatus = null }) {
  const execution = deriveVisitExecutionState({ personalSession, plan, currentEntryIndex, effectiveStatus });
  let destination = null;
  let intent = null;
  if (execution.phase === EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP) {
    destination = execution.deliveryAnchor;
    intent = "visit_progression";
  } else if (execution.phase === EXECUTION_PHASES.NAVIGATING_DETOUR) {
    destination = execution.detour?.destination || null;
    intent = "physical_detour";
  } else {
    return null;
  }
  if (!execution.knownLocation) {
    throw new AppError("Posizione fisica necessaria per la navigazione", 409, [{ code: "PHYSICAL_LOCATION_REQUIRED" }]);
  }
  if (!destination?.venueId || !destination?.placeId) {
    throw new AppError("Destinazione fisica non disponibile", 409, [{ code: "PHYSICAL_DESTINATION_UNAVAILABLE" }]);
  }
  const route = id(execution.knownLocation.venueId) === id(destination.venueId)
    ? await resolveIndoorLiveRoute({
      routingSession,
      venueId: destination.venueId,
      fromPlaceId: execution.knownLocation.placeId,
      toPlaceId: destination.placeId,
    })
    : intent === "visit_progression"
      ? resolvePlannedInterVenueRoute({ plan, knownLocation: execution.knownLocation, destinationAnchor: destination })
      : (() => { throw new AppError("Una deviazione fisica non può attraversare sedi senza un provider dedicato", 409, [{ code: "LIVE_INTER_VENUE_ROUTE_UNAVAILABLE" }]); })();
  return { intent, ...route };
}

async function resolveLocationReference({ routingSession, plan, locationRef, source, providerId = null, observedAt = new Date() }) {
  const kind = String(locationRef?.kind || "").trim();
  if (kind === "visit_anchor") {
    const anchor = anchorById(plan, locationRef.visitAnchorId);
    if (!anchor) throw new AppError("Tappa non disponibile", 404, [{ code: "VISIT_STOP_NOT_FOUND" }]);
    const bundle = await loadPinnedBundle(routingSession, anchor.venueId);
    if (!findPlace(bundle, anchor.placeId)) {
      throw new AppError("Posizione della tappa non disponibile nello snapshot fisico", 409, [{ code: "PHYSICAL_PLACE_NOT_FOUND" }]);
    }
    return anchorLocationValue(anchor, { source, providerId, observedAt });
  }
  if (kind === "place") {
    if (!locationRef.venueId || !locationRef.placeId) {
      throw new AppError("Riferimento di posizione incompleto", 400, [{ code: "PHYSICAL_LOCATION_INVALID" }]);
    }
    const bundle = await loadPinnedBundle(routingSession, locationRef.venueId);
    const place = findPlace(bundle, locationRef.placeId);
    if (!place) {
      throw new AppError("Posizione non disponibile nello snapshot fisico", 404, [{ code: "PHYSICAL_PLACE_NOT_FOUND" }]);
    }
    return knownLocationValue({
      venueId: bundle.pin.venueId,
      placeId: place._id,
      source,
      providerId,
      observedAt,
    });
  }
  throw new AppError("Tipo di riferimento di posizione non valido", 400, [{ code: "PHYSICAL_LOCATION_INVALID" }]);
}

async function confirmPhysicalLocationV2({ personalSession, routingSession, plan, locationRef, source = "manual_selection", providerId = null, observedAt = new Date() }) {
  requirePersistableSession(personalSession);
  if (personalSession.physicalRuntime?.knownLocation) {
    throw new AppError("La posizione iniziale è già stata confermata", 409, [{ code: "PHYSICAL_LOCATION_ALREADY_SET" }]);
  }
  const location = await resolveLocationReference({ routingSession, plan, locationRef, source, providerId, observedAt });
  assignKnownLocation(personalSession, location);
  await personalSession.save();
  return location;
}

async function correctPhysicalLocationV2({ personalSession, routingSession, plan, locationRef, source = "manual_selection", providerId = null, observedAt = new Date() }) {
  requirePersistableSession(personalSession);
  if (!personalSession.physicalRuntime?.knownLocation) {
    throw new AppError("Nessuna posizione da correggere", 409, [{ code: "PHYSICAL_LOCATION_REQUIRED" }]);
  }
  const location = await resolveLocationReference({ routingSession, plan, locationRef, source, providerId, observedAt });
  assignKnownLocation(personalSession, location);
  await personalSession.save();
  return location;
}

function nextKnownLocationFromRoute(route, { observedAt = new Date() } = {}) {
  if (!route) throw new AppError("Percorso live non disponibile", 409, [{ code: "NAVIGATION_STEP_UNAVAILABLE" }]);
  if (route.type === "inter_venue") {
    return knownLocationValue({
      venueId: route.destination.venueId,
      placeId: route.destination.placeId,
      source: "navigation_confirmation",
      observedAt,
    });
  }
  const edge = route.path?.[0] || null;
  if (!edge?.toPlaceId) {
    throw new AppError("Nessun passo di navigazione da confermare", 409, [{ code: "NAVIGATION_STEP_UNAVAILABLE" }]);
  }
  return knownLocationValue({
    venueId: route.venueId,
    placeId: edge.toPlaceId,
    source: "navigation_confirmation",
    observedAt,
  });
}

function confirmedAnchorLocation(anchor, { observedAt = new Date() } = {}) {
  if (!anchor) throw new AppError("Tappa da confermare non disponibile", 409, [{ code: "APPROACH_CONFIRMATION_UNAVAILABLE" }]);
  return knownLocationValue({
    venueId: anchor.venueId,
    placeId: anchor.placeId,
    visitAnchorId: anchor._id,
    venueTargetId: anchor.venueTargetId,
    exhibitSlotId: anchor.exhibitSlotId,
    source: "navigation_confirmation",
    observedAt,
  });
}

async function advancePhysicalProgressV2({ personalSession, routingSession, plan, currentEntryIndex, effectiveStatus = null, observedAt = new Date() }) {
  requirePersistableSession(personalSession);
  const execution = deriveVisitExecutionState({ personalSession, plan, currentEntryIndex, effectiveStatus });
  if (execution.phase === EXECUTION_PHASES.APPROACHING_VISIT_TARGET) {
    const location = confirmedAnchorLocation(execution.deliveryAnchor, { observedAt });
    assignKnownLocation(personalSession, location);
    await personalSession.save();
    return { type: "approach_confirmed", knownLocation: location, route: null };
  }
  if (![EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, EXECUTION_PHASES.NAVIGATING_DETOUR].includes(execution.phase)) {
    throw new AppError("Nessun avanzamento fisico disponibile nello stato corrente", 409, [{ code: "NAVIGATION_STEP_UNAVAILABLE" }]);
  }
  const route = await resolveLiveRouteV2({ personalSession, routingSession, plan, currentEntryIndex, effectiveStatus });
  const location = nextKnownLocationFromRoute(route, { observedAt });
  assignKnownLocation(personalSession, location);
  await personalSession.save();
  return { type: "navigation_step_confirmed", knownLocation: location, route };
}

async function startPhysicalDetourV2({ personalSession, routingSession, physicalFeatureRef }) {
  requirePersistableSession(personalSession);
  const knownLocation = personalSession.physicalRuntime?.knownLocation || null;
  if (!knownLocation) {
    throw new AppError("Posizione fisica necessaria per cercare una facility", 409, [{ code: "PHYSICAL_LOCATION_REQUIRED" }]);
  }
  const routeResult = await routeToPhysicalFeatureInSession({
    session: routingSession,
    venueId: knownLocation.venueId,
    fromPlaceId: knownLocation.placeId,
    physicalFeatureRef,
  });
  const runtime = ensurePhysicalRuntime(personalSession);
  runtime.detour = {
    destination: {
      venueId: routeResult.venueId,
      placeId: routeResult.destination._id,
      physicalFeatureRef: routeResult.physicalFeatureRef,
    },
    startedAt: new Date(),
  };
  await personalSession.save();
  return routeResult;
}

async function returnToVisitV2({ personalSession }) {
  requirePersistableSession(personalSession);
  if (!personalSession.physicalRuntime?.detour) {
    throw new AppError("Nessuna deviazione fisica attiva", 409, [{ code: "PHYSICAL_DETOUR_NOT_ACTIVE" }]);
  }
  clearPhysicalDetour(personalSession);
  await personalSession.save();
}

module.exports = {
  EXACT_ANCHOR_LOCATION_SOURCES,
  ensurePhysicalRuntime,
  knownLocationValue,
  anchorLocationValue,
  assignKnownLocation,
  clearPhysicalDetour,
  resolvedRoutingRequirements,
  resolveIndoorLiveRouteFromBundle,
  resolveIndoorLiveRoute,
  resolvePlannedInterVenueRoute,
  resolveLiveRouteV2,
  resolveLocationReference,
  confirmPhysicalLocationV2,
  correctPhysicalLocationV2,
  nextKnownLocationFromRoute,
  confirmedAnchorLocation,
  advancePhysicalProgressV2,
  startPhysicalDetourV2,
  returnToVisitV2,
};