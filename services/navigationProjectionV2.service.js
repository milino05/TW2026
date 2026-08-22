const crypto = require("crypto");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");
const { loadPinnedBundle, translateRequirements } = require("./physicalExecutionV2.service");
const { resolvePlannedPath } = require("./graphRouting.service");
const { getCanonicalAttribute, isDeclaredObstacle } = require("./routingAttributeCatalog.service");

function id(value) { return String(value?._id || value || ""); }
function opaqueId(seed) { return crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16); }
function placeMap(layout) { return new Map((layout?.places || []).map((place) => [id(place._id), place])); }
function anchorMap(plan) { return new Map((plan?.visitAnchors || []).map((anchor) => [id(anchor._id), anchor])); }

function logicalAnchorForIndex(plan, index) {
  const anchors = anchorMap(plan);
  for (let cursor = Math.min(Number(index) || 0, (plan?.contentEntries || []).length - 1); cursor >= 0; cursor -= 1) {
    const anchorId = plan.contentEntries[cursor]?.deliveryAnchorId;
    if (anchorId && anchors.has(id(anchorId))) return anchors.get(id(anchorId));
  }
  return null;
}

function nextPhysicalLeg(plan, currentAnchor) {
  if (!currentAnchor) return null;
  return (plan?.physicalRoute?.legs || []).find((leg) => id(leg.fromAnchorId) === id(currentAnchor._id)) || null;
}

function projectPathGeometry(layout, path = []) {
  const places = placeMap(layout);
  const overlays = [];
  const floorTransitions = [];
  const instructions = [];
  for (const edge of path || []) {
    const from = places.get(id(edge.fromPlaceId));
    const to = places.get(id(edge.toPlaceId));
    if (!from || !to) continue;
    if (edge.instruction) instructions.push(edge.instruction);
    if (from.floorKey === to.floorKey) {
      overlays.push({
        floorKey: from.floorKey,
        points: [
          { x: from.position.x, y: from.position.y },
          { x: to.position.x, y: to.position.y },
        ],
      });
    } else {
      floorTransitions.push({
        fromFloorKey: from.floorKey,
        toFloorKey: to.floorKey,
        from: { x: from.position.x, y: from.position.y },
        to: { x: to.position.x, y: to.position.y },
        instruction: edge.instruction || null,
      });
    }
  }
  return { overlays, floorTransitions, instructions };
}

function warningProjection(warnings = []) {
  return warnings.map((warning) => ({
    code: warning.code || "NAVIGATION_WARNING",
    message: warning.code === "PREFERRED_ATTRIBUTE_UNSUPPORTED"
      ? "Una preferenza di percorso non è supportata in questa sede."
      : "Il percorso contiene un avviso di navigazione.",
  }));
}

async function assessPreparedMapReadiness({ plan, venuePins = [] }) {
  if (!plan || !venuePins.length) return { blockers: [], warnings: [] };
  const pseudoSession = { venuePins };
  const blockers = [];

  for (const pin of venuePins) {
    const bundle = await loadPinnedBundle(pseudoSession, pin.venueId);
    const places = placeMap(bundle.layout);
    const requiredFloorKeys = new Set();

    for (const anchor of plan.visitAnchors || []) {
      if (id(anchor.venueId) !== id(pin.venueId)) continue;
      const place = places.get(id(anchor.placeId));
      if (place?.floorKey) requiredFloorKeys.add(place.floorKey);
    }

    const connectionById = new Map((bundle.layout.connections || []).map((connection) => [id(connection._id), connection]));
    for (const leg of plan.physicalRoute?.legs || []) {
      if (leg.type !== "indoor" || id(leg.venueReleaseId) !== id(pin.venueReleaseId)) continue;
      for (const connectionId of leg.path || []) {
        const connection = connectionById.get(id(connectionId));
        if (!connection) continue;
        const from = places.get(id(connection.fromPlaceId));
        const to = places.get(id(connection.toPlaceId));
        if (from?.floorKey) requiredFloorKeys.add(from.floorKey);
        if (to?.floorKey) requiredFloorKeys.add(to.floorKey);
      }
    }

    const floorByKey = new Map((bundle.layout.floors || []).map((floor) => [floor.key, floor]));
    for (const floorKey of requiredFloorKeys) {
      const floor = floorByKey.get(floorKey);
      if (floor?.map?.imageUrl) continue;
      blockers.push({
        code: "NAVIGATOR_MAP_ASSET_MISSING",
        message: `La mappa necessaria per ${floor?.label || floorKey} non è disponibile.`,
        context: { venueId: pin.venueId, floorKey },
      });
    }
  }

  return { blockers, warnings: [] };
}

async function projectSessionMap({ sessionId, userId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId, allowCompleted: true });
  const targetIds = [...new Set((plan.visitAnchors || []).map((anchor) => id(anchor.venueTargetId)).filter(Boolean))];
  const targets = targetIds.length
    ? await VenueTarget.find({ _id: { $in: targetIds } }).select("_id label").lean()
    : [];
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  const venueIds = [...new Set((session.venuePins || []).map((pin) => id(pin.venueId)).filter(Boolean))];
  const venues = venueIds.length
    ? await Venue.find({ _id: { $in: venueIds } }).select("_id name description").lean()
    : [];
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const currentAnchor = logicalAnchorForIndex(plan, session.currentEntryIndex);
  const projectedVenues = [];

  for (const pin of session.venuePins || []) {
    const venueId = id(pin.venueId);
    const venue = venueById.get(venueId);
    const bundle = await loadPinnedBundle(session, venueId);
    const places = placeMap(bundle.layout);
    const typeByKey = new Map((bundle.layout.placeTypes || []).map((type) => [type.key, type]));
    const stops = (plan.visitAnchors || []).filter((anchor) => id(anchor.venueId) === venueId).map((anchor, index) => {
      const place = places.get(id(anchor.placeId));
      if (!place) return null;
      return {
        visitAnchorId: anchor._id,
        venueTargetId: anchor.venueTargetId,
        label: targetById.get(id(anchor.venueTargetId))?.label || `Tappa ${index + 1}`,
        floorKey: place.floorKey,
        position: { x: place.position.x, y: place.position.y },
        order: (plan.visitAnchors || []).findIndex((value) => id(value._id) === id(anchor._id)) + 1,
      };
    }).filter(Boolean);

    const facilities = (bundle.layout.places || []).flatMap((place) => {
      const type = typeByKey.get(place.typeKey);
      if (!(type?.userIntents || []).length) return [];
      return [{
        id: `facility-${opaqueId(`${venueId}|${id(place._id)}`)}`,
        label: place.label,
        category: type.label,
        userIntents: [...type.userIntents],
        floorKey: place.floorKey,
        position: { x: place.position.x, y: place.position.y },
      }];
    });

    const route = { overlays: [], floorTransitions: [] };
    const anchors = anchorMap(plan);
    const translated = translateRequirements(bundle.layout, session.navigationSnapshot?.requirements || []);
    for (const leg of plan.physicalRoute?.legs || []) {
      if (leg.type !== "indoor" || id(leg.venueReleaseId) !== id(pin.venueReleaseId)) continue;
      const from = anchors.get(id(leg.fromAnchorId));
      const to = anchors.get(id(leg.toAnchorId));
      if (!from || !to) continue;
      const resolved = resolvePlannedPath({
        connections: bundle.layout.connections || [],
        pathConnectionIds: leg.path || [],
        fromPlaceId: from.placeId,
        toPlaceId: to.placeId,
        requirements: translated.requirements,
        speedMps: session.sessionMovementSpeedMps,
      });
      if (!resolved.reachable) continue;
      const geometry = projectPathGeometry(bundle.layout, resolved.path);
      route.overlays.push(...geometry.overlays.map((overlay) => ({
        ...overlay,
        fromVisitAnchorId: from._id,
        toVisitAnchorId: to._id,
      })));
      route.floorTransitions.push(...geometry.floorTransitions.map((transition) => ({
        ...transition,
        fromVisitAnchorId: from._id,
        toVisitAnchorId: to._id,
      })));
    }

    projectedVenues.push({
      id: pin.venueId,
      name: venue?.name || "Sede",
      description: venue?.description || "",
      floors: (bundle.layout.floors || []).map((floor) => ({
        key: floor.key,
        label: floor.label,
        map: {
          available: Boolean(floor.map?.imageUrl),
          imageUrl: floor.map?.imageUrl || null,
          width: floor.map?.width || null,
          height: floor.map?.height || null,
        },
      })),
      stops,
      facilities,
      route,
      warnings: (bundle.layout.floors || []).filter((floor) => !floor.map?.imageUrl).map((floor) => ({
        code: "MAP_ASSET_MISSING",
        message: `Mappa non disponibile per ${floor.label}.`,
      })),
    });
  }

  return {
    venues: projectedVenues,
    logicalCurrentStop: currentAnchor ? { visitAnchorId: currentAnchor._id, venueId: currentAnchor.venueId } : null,
    interVenueTransitions: (plan.physicalRoute?.legs || []).filter((leg) => leg.type === "inter_venue").map((leg) => ({
      fromVisitAnchorId: leg.fromAnchorId,
      toVisitAnchorId: leg.toAnchorId,
      estimatedSeconds: leg.estimatedSeconds,
      instruction: leg.instruction || null,
    })),
  };
}

async function projectNavigationRoute({ sessionId, userId, routeResult }) {
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  const bundle = await loadPinnedBundle(session, routeResult.venueId);
  const type = (bundle.layout.placeTypes || []).find((entry) => entry.key === routeResult.destination.typeKey) || null;
  const geometry = projectPathGeometry(bundle.layout, routeResult.path || []);
  return {
    destination: {
      kind: "venue_place",
      venueId: routeResult.venueId,
      label: routeResult.destination.label,
      category: type?.label || routeResult.destination.typeKey,
      floorKey: routeResult.destination.floorKey,
      position: {
        x: routeResult.destination.position.x,
        y: routeResult.destination.position.y,
      },
    },
    route: {
      estimatedSeconds: Math.round(Number(routeResult.estimatedSeconds) || 0),
      distanceMeters: Math.round((Number(routeResult.distanceMeters) || 0) * 10) / 10,
      overlays: geometry.overlays,
      floorTransitions: geometry.floorTransitions,
      instructions: geometry.instructions,
      warnings: warningProjection(routeResult.warnings || []),
    },
  };
}

async function projectNextRouteObstacles({ sessionId, userId }) {
  const { session, plan } = await getCurrentSessionPlanV2({ sessionId, userId });
  const currentAnchor = logicalAnchorForIndex(plan, session.currentEntryIndex);
  const leg = nextPhysicalLeg(plan, currentAnchor);
  if (!leg) throw new AppError("Nessun prossimo percorso fisico da verificare", 409, [{ code: "NO_NEXT_PHYSICAL_ROUTE" }]);
  if (leg.type === "inter_venue") {
    return {
      verified: false,
      obstacles: [],
      message: "Gli ostacoli del trasferimento tra sedi non sono verificabili con il provider attuale.",
    };
  }

  const bundle = await loadPinnedBundle(session, currentAnchor.venueId);
  const connectionById = new Map((bundle.layout.connections || []).map((connection) => [id(connection._id), connection]));
  const localDefinitionByKey = new Map((bundle.layout.routingAttributes || []).map((definition) => [definition.key, definition]));
  const obstacles = new Map();
  let canonicalEvidence = false;
  for (const connectionId of leg.path || []) {
    const connection = connectionById.get(id(connectionId));
    if (!connection) continue;
    for (const [localKey, value] of Object.entries(connection.attributes || {})) {
      const localDefinition = localDefinitionByKey.get(localKey);
      const canonical = getCanonicalAttribute(localDefinition?.canonicalKey);
      if (!canonical) continue;
      canonicalEvidence = true;
      if (!isDeclaredObstacle(canonical, value)) continue;
      obstacles.set(canonical.key, {
        code: canonical.key,
        label: localDefinition?.label || canonical.label,
        message: `${localDefinition?.label || canonical.label}: possibile ostacolo dichiarato sul prossimo percorso.`,
      });
    }
  }
  return {
    verified: canonicalEvidence,
    obstacles: [...obstacles.values()],
    message: canonicalEvidence
      ? (obstacles.size ? "Sono presenti ostacoli dichiarati sul prossimo percorso." : "Non risultano ostacoli dichiarati sul prossimo percorso.")
      : "La sede non fornisce dati canonici sufficienti per verificare gli ostacoli del prossimo percorso.",
  };
}

module.exports = {
  logicalAnchorForIndex,
  nextPhysicalLeg,
  assessPreparedMapReadiness,
  projectSessionMap,
  projectNavigationRoute,
  projectNextRouteObstacles,
};
