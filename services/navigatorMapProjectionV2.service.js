const ItemV2 = require("../models/itemV2.model");
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

function projectedRecognitionMedia(media, origin) {
  if (!media?.url) return null;
  const value = media?.toObject ? media.toObject() : media;
  return {
    url: value.url,
    originalUrl: value.originalUrl || null,
    altText: value.altText || "",
    mimeType: value.mimeType || null,
    width: value.width || null,
    height: value.height || null,
    source: value.source || null,
    rights: value.rights || null,
    origin,
  };
}

async function projectApproachRecognitionMedia({ routingConfigurationOwner, plan, contextAnchor }) {
  if (!contextAnchor?.venueId || !contextAnchor?.venueTargetId) return null;
  const bundle = await loadPinnedBundle(routingConfigurationOwner, contextAnchor.venueId);
  const binding = (bundle.release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(contextAnchor.venueTargetId));
  const venueMedia = projectedRecognitionMedia((binding?.recognitionMedia || [])[0], "venue_target");
  if (venueMedia) return venueMedia;

  const entry = (plan?.contentEntries || []).find((candidate) => id(candidate.deliveryAnchorId) === id(contextAnchor._id));
  if (!entry?.itemId) return null;
  const item = await ItemV2.findById(entry.itemId).select("recognitionMedia").lean();
  return projectedRecognitionMedia(item?.recognitionMedia, "item");
}

async function projectKnownLocation({ routingConfigurationOwner, location }) {
  if (!location?.venueId || !location?.placeId) return null;
  const bundle = await loadPinnedBundle(routingConfigurationOwner, location.venueId);
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

async function projectSelectableLocations({ routingConfigurationOwner, plan }) {
  const result = [];
  for (const pin of routingConfigurationOwner.venuePins || []) {
    const bundle = await loadPinnedBundle(routingConfigurationOwner, pin.venueId);
    const typeById = placeTypeMap(bundle);
    const anchoredPlaceIds = new Set();
    for (const anchor of (plan.visitAnchors || []).filter((entry) => id(entry.venueId) === id(pin.venueId))) {
      const place = placeById(bundle, anchor.placeId);
      if (!place || anchoredPlaceIds.has(id(place._id))) continue;
      anchoredPlaceIds.add(id(place._id));
      result.push({
        kind: "visit_area",
        venueId: pin.venueId,
        placeId: place._id,
        visitAnchorId: anchor._id,
        label: place.label || `Area tappa ${(plan.visitAnchors || []).findIndex((entry) => id(entry._id) === id(anchor._id)) + 1}`,
        category: "Area della visita",
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

function experiencedAnchorIds({ personalSession, plan }) {
  const experiencedEntryIds = new Set((personalSession?.contentEntryExperiences || [])
    .filter((experience) => Number(experience.completionRatio) > 0)
    .map((experience) => id(experience.contentEntryId)));
  const result = new Set();
  for (const entry of plan?.contentEntries || []) {
    if (entry.deliveryAnchorId && experiencedEntryIds.has(id(entry._id))) result.add(id(entry.deliveryAnchorId));
  }
  return result;
}

function annotateStops({ baseMap, personalSession, plan, currentAnchor }) {
  const experienced = experiencedAnchorIds({ personalSession, plan });
  const currentOrder = currentAnchor
    ? (plan?.visitAnchors || []).findIndex((anchor) => id(anchor._id) === id(currentAnchor._id)) + 1
    : null;
  return (baseMap.venues || []).map((venue) => ({
    ...venue,
    stops: (venue.stops || []).map((stop) => ({
      ...stop,
      sequencePosition: currentOrder == null
        ? "after_current"
        : stop.order < currentOrder
          ? "before_current"
          : stop.order === currentOrder
            ? "current"
            : "after_current",
      experienced: experienced.has(id(stop.visitAnchorId)),
    })),
  }));
}

async function projectActiveNavigation({ sessionId, userId, state, execution }) {
  if (![EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, EXECUTION_PHASES.NAVIGATING_DETOUR].includes(execution.phase)) return null;
  const live = await resolveLiveRouteV2({
    personalSession: state.physicalRuntimeOwner,
    routingSession: state.routingConfigurationOwner,
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
  const bundle = await loadPinnedBundle(state.routingConfigurationOwner, live.venueId);
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
    personalSession: state.physicalRuntimeOwner,
    plan: state.plan,
    currentEntryIndex: state.currentEntryIndex,
    effectiveStatus: state.effectiveStatus,
  });
  const [knownLocation, selectableLocations, activeNavigation, recognitionMedia] = await Promise.all([
    projectKnownLocation({ routingConfigurationOwner: state.routingConfigurationOwner, location: execution.knownLocation }),
    projectSelectableLocations({ routingConfigurationOwner: state.routingConfigurationOwner, plan: state.plan }),
    projectActiveNavigation({ sessionId, userId, state, execution }),
    projectApproachRecognitionMedia({
      routingConfigurationOwner: state.routingConfigurationOwner,
      plan: state.plan,
      contextAnchor: execution.contextAnchor,
    }),
  ]);
  const annotatedVenues = annotateStops({
    baseMap,
    personalSession: state.physicalRuntimeOwner,
    plan: state.plan,
    currentAnchor: execution.contextAnchor,
  });
  const projectedContextStop = findProjectedStop({ venues: annotatedVenues }, execution.contextAnchor?._id);
  const narrativeContextStop = projectedContextStop ? { ...projectedContextStop, recognitionMedia } : null;
  const plannedVenueRoutes = annotatedVenues.map((venue) => ({ venueId: venue.id, route: venue.route }));
  const venues = annotatedVenues.map(({ route, ...venue }) => venue);
  return {
    venues,
    knownLocation,
    narrativeContextStop,
    selectableLocations,
    plannedVisitRoute: {
      plannedLegs: baseMap.plannedLegs || [],
      interVenueTransitions: baseMap.interVenueTransitions || [],
      venues: plannedVenueRoutes,
    },
    activeNavigation,
  };
}

module.exports = {
  projectedRecognitionMedia,
  projectApproachRecognitionMedia,
  projectKnownLocation,
  projectSelectableLocations,
  experiencedAnchorIds,
  annotateStops,
  projectActiveNavigation,
  projectNavigatorMap,
};
