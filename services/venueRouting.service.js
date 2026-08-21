const AppError = require("../utils/AppError");
const { resolveRoute } = require("./graphRouting.service");

function venueTargetPlacementMap(layoutRevision) {
  return new Map((layoutRevision?.venueTargetPlacements || []).map((placement) => [String(placement.venueTargetId), placement]));
}

function resolveVenueTargetPrimaryPlace(layoutRevision, venueTargetId) {
  const placement = venueTargetPlacementMap(layoutRevision).get(String(venueTargetId));
  return placement?.primaryPlaceId || null;
}

function routeBetweenVenueTargets({ layoutRevision, fromVenueTargetId, toVenueTargetId, requirements = [], speedMps, learnedResidualByConnection = {} }) {
  const fromPlaceId = resolveVenueTargetPrimaryPlace(layoutRevision, fromVenueTargetId);
  const toPlaceId = resolveVenueTargetPrimaryPlace(layoutRevision, toVenueTargetId);
  if (!fromPlaceId || !toPlaceId) throw new AppError("VenueTarget non posizionato nella LayoutRevision", 409);
  const route = resolveRoute({
    connections: layoutRevision.connections || [],
    fromPlaceId,
    toPlaceId,
    requirements,
    speedMps,
    learnedResidualByConnection,
  });
  if (!route.reachable) throw new AppError("Nessun percorso compatibile tra i VenueTarget", 409);
  return { fromPlaceId, toPlaceId, ...route };
}

function placesForIntent(layoutRevision, intent) {
  const normalizedIntent = String(intent || "").trim().toUpperCase();
  if (!normalizedIntent) return [];
  const typeKeys = new Set((layoutRevision?.placeTypes || []).filter((type) => (type.userIntents || []).includes(normalizedIntent)).map((type) => type.key));
  return (layoutRevision?.places || []).filter((place) => typeKeys.has(place.typeKey));
}

module.exports = { venueTargetPlacementMap, resolveVenueTargetPrimaryPlace, routeBetweenVenueTargets, placesForIntent };
