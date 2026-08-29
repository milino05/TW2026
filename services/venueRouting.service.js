const AppError = require("../utils/AppError");
const { resolveRoute } = require("./graphRouting.service");
const { resolvePhysicalFeatureRef, requireSingleResolution } = require("./physicalVocabularyResolver.service");
const { resolveVenueTargetExhibit } = require("./venueExhibitResolution.service");

function resolveVenueTargetPlace(venueRelease, layoutRevision, venueTargetId) {
  return resolveVenueTargetExhibit({ venueRelease, layoutRevision, venueTargetId }).place._id;
}

function routeBetweenVenueTargets({ venueRelease, layoutRevision, fromVenueTargetId, toVenueTargetId, requirements = [], speedMps, learnedResidualByConnection = {} }) {
  const fromPlaceId = resolveVenueTargetPlace(venueRelease, layoutRevision, fromVenueTargetId);
  const toPlaceId = resolveVenueTargetPlace(venueRelease, layoutRevision, toVenueTargetId);
  const route = resolveRoute({
    connections: layoutRevision.connections || [],
    places: layoutRevision.places || [],
    fromPlaceId,
    toPlaceId,
    requirements,
    speedMps,
    learnedResidualByConnection,
  });
  if (!route.reachable) throw new AppError("Nessun percorso compatibile tra i VenueTarget", 409);
  return { fromPlaceId, toPlaceId, ...route };
}

function placesForPhysicalFeature({ layoutRevision, physicalVocabulary, physicalVocabularyRevision, physicalFeatureRef }) {
  const resolution = resolvePhysicalFeatureRef({
    reference: physicalFeatureRef,
    physicalVocabulary,
    revision: physicalVocabularyRevision,
  });
  const { definition } = requireSingleResolution(resolution, { expectedFamily: "placeTypes" });
  return (layoutRevision?.places || []).filter((place) => place.placeTypeDefinitionId === definition.definitionId);
}

module.exports = { resolveVenueTargetPlace, routeBetweenVenueTargets, placesForPhysicalFeature };
