const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const {
  id,
  loadPinnedBundle,
} = require("./physicalExecutionV2.service");
const {
  projectSessionMap,
  projectNavigationRoute,
} = require("./navigationProjectionV2.service");
const {
  EXECUTION_PHASES,
  deriveVisitExecutionState,
} = require("./visitExecutionRuntimeV2.service");
const { resolveLiveRouteV2 } = require("./visitPhysicalRuntimeV2.service");

function placeById(bundle, placeId) {
  return (bundle?.layout?.places || []).find((place) => id(place._id) === id(placeId)) || null;
}

function placeTypeMap(bundle) {
  return new Map((bundle?.physicalVocabularyRevision?.placeTypes || [])
    .map((definition) => [definition.definitionId, definition]));
}

async function projectKnownLocation({ routingSession, location }) {
  if (!location?.venueId || !location?.placeId) return null;
  const bundle = await loadPinnedBundle(routingSession, location.venueId);
  const place = placeById(bundle, location.placeId);
  if (!place) return null;
  const type = placeTypeMap(bundle).get(place.placeTypeDefinitionId) || null;
  return {
    venueId: bundle.pin.venueId,
    placeId: place._id,
    floorId: place.floorId,
    position: { x: place.position.x, y: place.position.y },
    label: place.label || type?.label || null,
    category: type?.label || null,
    visitAnchorId: location.visitAnchorId || null,
    venueTargetId: location.venueTargetId || null,
    exhibitSlotId: location.exhibitSlotId || null,
    source: location.source,
    providerId: location.providerId || null,
    observedAt: location.observedAt || null,
  };
}

async function projectSelectableLocations({ routingSession, plan }) {
  const result = [];
  for (const pin of routingSession.venuePins || []) {
    const bundle = await loadPinnedBundle(routingSession, pin.venueId);
    const typeById = placeTypeMap(bundle);
    const anchoredPlaceIds = new Set();
    for (const anchor of (plan.visitAnchors || []).filter((entry) => id(entry.venueId) === id(pin.venueId))) {
      const place = placeById(bundle, anchor.placeId);
      if (!place) continue;
      anchoredPlaceIds.add(id(place._id));
      result.push({
        kind: "visit_stop",
        venueId: pin.venueId,
        placeId: place._id,
        visitAnchorId: anchor._id,
        label: place.label || `Tappa ${(plan.visitAnchors || []).findIndex((entry) => id(entry._id) === id(anchor._id)) + 1}`,
        category: "Tappa della visita",
        floorId: place.floorId,
        position: { x: place.position.x, y: place.position.y },
        locationRef: { kind: "visit_anchor", visitAnchorId: anchor._id },
      });
    }
    const facilityPlaceIds = new Set();
    for (const place of bundle.layout.places || []) {
      const type = typeById.get(place.placeTypeDefinitionId) || null;
      if (type?.metadata?.navigationTarget !== true) continue;
      facilityPlaceIds.add(id(place._id));
      result.push({
        kind: "facility",
        venueId: pin.venueId,
        placeId: place._id,
        visitAnchorId: null,
        label: place.label || type.label,
        category: type.label,
        floorId: place.floorId,
        position: { x: place.position.x, y: place.position.y },
        locationRef: { kind: "place", venueId: pin.venueId, placeId: place._id },
      });
    }
    for (const place of bundle.layout.places || []) {
      if (!place.label || anchoredPlaceIds.has(id(place._id)) || facilityPlaceIds.has(id(place._id))) continue;
      const type = typeById.get(place.placeTypeDefinitionId) || null;
      result.push({
        kind: "place",
        venueId: pin.venueId,
        placeId: place._id,
        visitAnchorId: null,
        label: place.label,
        category: type?.label || "Luogo",
        floorId: place.floorId,
        position: { x: place.position.x, y: place.position.y },
        locationRef: { kind: "place", venueId: pin.venueId, placeId: place._id },
      });
    }
  }
  return result;
}

function findProjectedStop(baseMap, visitAnchorId) {
  if (!visitAnchorId) return null;
  for (const venue of baseMap.venues || []) {
    const stop = (venue.stops || []).find((entry) => id(entry.visitAnchorId) === id(visitAnchorId));
    if (stop) return { ...stop, venueId: venue.id };
  }
  return null;
}

async function projectActiveNavigation({ sessionId, userId, state, execution }) {
  if (![EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, EXECUTION_PHASES.NAVIGATING_DETOUR].includes(execution.phase)) return null;
  const live = await resolveLiveRouteV2({
    personalSession: state.session,
    routingSession: state.physicalSession,
    plan: state.plan,
    currentEntryIndex: state.currentEntryIndex,
    effectiveStatus: state.effectiveStatus,
  });
  if (!live) return null;
  if (live.type === "inter_venue") {
    return {
      intent: live.intent,
      type: "inter_venue",
      destination: live.destination,
      route: {
        estimatedSeconds: live.estimatedSeconds,
        distanceMeters: null,
        transferInstruction: live.transferInstruction || null,
        overlays: [],
        floorTransitions: [],
        instructions: live.transferInstruction ? [live.transferInstruction] : [],
        warnings: live.warnings || [],
      },
    };
  }
  const bundle = await loadPinnedBundle(state.physicalSession, live.venueId);
  const destination = placeById(bundle, live.toPlaceId);
  if (!destination) return null;
  const projected = await projectNavigationRoute({
    sessionId,
    userId,
    routeResult: {
      venueId: live.venueId,
      physicalFeatureRef: execution.detour?.destination?.physicalFeatureRef || null,
      destination,
      path: live.path,
      estimatedSeconds: live.estimatedSeconds,
      distanceMeters: live.distanceMeters,
      warnings: live.warnings || [],
    },
  });
  return { intent: live.intent, type: "indoor", ...projected };
}

async function projectNavigatorMap({ sessionId, userId }) {
  const [baseMap, state] = await Promise.all([
    projectSessionMap({ sessionId, userId }),
    getCurrentSessionPlanV2({ sessionId, userId, allowCompleted: true }),
  ]);
  const execution = deriveVisitExecutionState({
    personalSession: state.session,
    plan: state.plan,
    currentEntryIndex: state.currentEntryIndex,
    effectiveStatus: state.effectiveStatus,
  });
  const [knownLocation, selectableLocations, activeNavigation] = await Promise.all([
    projectKnownLocation({ routingSession: state.physicalSession, location: execution.knownLocation }),
    projectSelectableLocations({ routingSession: state.physicalSession, plan: state.plan }),
    projectActiveNavigation({ sessionId, userId, state, execution }),
  ]);
  const narrativeContextStop = findProjectedStop(baseMap, execution.contextAnchor?._id);
  return {
    ...baseMap,
    knownLocation,
    narrativeContextStop,
    selectableLocations,
    plannedVisitRoute: {
      plannedLegs: baseMap.plannedLegs || [],
      interVenueTransitions: baseMap.interVenueTransitions || [],
      venues: (baseMap.venues || []).map((venue) => ({ venueId: venue.id, route: venue.route })),
    },
    activeNavigation,
  };
}

module.exports = {
  projectKnownLocation,
  projectSelectableLocations,
  projectActiveNavigation,
  projectNavigatorMap,
};
