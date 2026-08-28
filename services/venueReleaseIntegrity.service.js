const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const {
  deriveMetersPerPixel,
  distanceMetersForGeometry,
  nearlyEqual,
  samePoint,
} = require("./layoutGeometry.service");

function id(value) { return String(value?._id || value || ""); }

function valueMatchesDefinition(definition, value) {
  if (!definition || value === null || value === undefined) return false;
  if (definition.dataType === "boolean") return typeof value === "boolean";
  if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.dataType === "string") return typeof value === "string";
  if (definition.dataType === "choice") {
    const allowed = new Set((definition.options || []).map((option) => option.value));
    return typeof value === "string" && allowed.has(value);
  }
  return false;
}

function validateAttributeValues({ values, field, target, attributeById, add }) {
  const seen = new Set();
  for (let index = 0; index < (values || []).length; index += 1) {
    const entry = values[index];
    const entryField = `${field}[${index}]`;
    const definitionId = String(entry?.physicalAttributeDefinitionId || "");
    if (seen.has(definitionId)) add(`${entryField}.physicalAttributeDefinitionId`, "DUPLICATE_PHYSICAL_ATTRIBUTE_VALUE", "La caratteristica fisica e valorizzata piu volte");
    seen.add(definitionId);
    const definition = attributeById.get(definitionId);
    if (!definition) {
      add(`${entryField}.physicalAttributeDefinitionId`, "UNKNOWN_PHYSICAL_ATTRIBUTE", "Caratteristica non presente nel PhysicalVocabulary pinzato");
      continue;
    }
    if (![target, "both"].includes(definition.appliesTo)) {
      add(`${entryField}.physicalAttributeDefinitionId`, "ATTRIBUTE_TARGET_MISMATCH", `La caratteristica non e applicabile a ${target}`);
    }
    if (!valueMatchesDefinition(definition, entry.value)) {
      add(`${entryField}.value`, "ATTRIBUTE_VALUE_TYPE_MISMATCH", `Valore non compatibile con dataType ${definition.dataType}`);
    }
  }
}

function geometryPoints(connection) { return connection?.geometry?.points || []; }

function validateConnectionGeometry({ connection, index, placeById, floorById, add }) {
  const field = `layout.connections[${index}]`;
  const from = placeById.get(id(connection.fromPlaceId));
  const to = placeById.get(id(connection.toPlaceId));
  if (!from || !to) return;
  const sameFloor = id(from.floorId) === id(to.floorId);
  const points = geometryPoints(connection);
  const needsGeometry = ["geometry_derived", "length_constrained"].includes(connection.metricMode);
  if (needsGeometry && points.length < 2) {
    add(`${field}.geometry.points`, "CONNECTION_GEOMETRY_REQUIRED", "La modalita metrica richiede una polilinea con almeno due punti");
    return;
  }
  if (points.length && !sameFloor) {
    add(`${field}.geometry`, "CROSS_FLOOR_GEOMETRY_NOT_SUPPORTED", "Una geometria planare puo appartenere a un solo piano");
    return;
  }
  if (points.length && (!samePoint(points[0], from.position) || !samePoint(points.at(-1), to.position))) {
    add(`${field}.geometry.points`, "GEOMETRY_ENDPOINT_MISMATCH", "La polilinea deve iniziare e terminare nelle posizioni dei Place collegati");
  }
  if (!needsGeometry) return;
  const floor = floorById.get(id(from.floorId));
  if (!floor?.mapAsset || !floor?.calibration) {
    add(`${field}.metricMode`, "CALIBRATED_FLOOR_REQUIRED", "La modalita metrica richiede una planimetria calibrata");
    return;
  }
  const geometricDistance = distanceMetersForGeometry({ points, floor });
  if (!(geometricDistance > 0)) {
    add(`${field}.geometry`, "INVALID_CONNECTION_GEOMETRY", "La geometria non produce una lunghezza metrica valida");
    return;
  }
  if (connection.metricMode === "geometry_derived" && !nearlyEqual(connection.distanceMeters, geometricDistance)) {
    add(`${field}.distanceMeters`, "DERIVED_DISTANCE_MISMATCH", "La distanza geometry_derived deve coincidere con la geometria calibrata");
  }
  if (connection.metricMode === "length_constrained") {
    const straightDistance = distanceMetersForGeometry({ points: [from.position, to.position], floor });
    if (straightDistance > connection.distanceMeters && !nearlyEqual(straightDistance, connection.distanceMeters)) {
      add(`${field}.distanceMeters`, "IMPOSSIBLE_LENGTH_CONSTRAINT", "La distanza richiesta e inferiore alla distanza geometrica minima fra gli endpoint");
    }
  }
}

function validateFloorCalibration({ floor, index, connectionById, placeById, add }) {
  const calibration = floor.calibration;
  if (!calibration) return;
  const field = `layout.floors[${index}].calibration`;
  if (!floor.mapAsset) {
    add(field, "CALIBRATION_MAP_ASSET_REQUIRED", "La calibrazione richiede una planimetria gestita");
    return;
  }
  let points = null;
  if (calibration.method === "line") {
    if (!calibration.line || calibration.referenceConnectionId) add(field, "INVALID_LINE_CALIBRATION", "La calibrazione line richiede solo una linea di riferimento");
    else points = [calibration.line.from, calibration.line.to];
  } else if (calibration.method === "connection") {
    if (!calibration.referenceConnectionId || calibration.line) {
      add(field, "INVALID_CONNECTION_CALIBRATION", "La calibrazione connection richiede solo una Connection di riferimento");
      return;
    }
    const connection = connectionById.get(id(calibration.referenceConnectionId));
    const from = connection ? placeById.get(id(connection.fromPlaceId)) : null;
    const to = connection ? placeById.get(id(connection.toPlaceId)) : null;
    if (!connection || !from || !to) {
      add(`${field}.referenceConnectionId`, "CALIBRATION_CONNECTION_NOT_FOUND", "Connection di calibrazione non presente nel Layout");
      return;
    }
    if (id(from.floorId) !== id(floor._id) || id(to.floorId) !== id(floor._id)) {
      add(`${field}.referenceConnectionId`, "CALIBRATION_CONNECTION_FLOOR_MISMATCH", "La Connection di calibrazione deve appartenere interamente al Floor");
      return;
    }
    points = geometryPoints(connection);
    if (points.length < 2) {
      add(`${field}.referenceConnectionId`, "CALIBRATION_CONNECTION_GEOMETRY_REQUIRED", "La Connection di calibrazione richiede una geometria valida");
      return;
    }
  }
  const derivedScale = deriveMetersPerPixel({ distanceMeters: calibration.distanceMeters, points, mapAsset: floor.mapAsset });
  if (!(derivedScale > 0)) {
    add(field, "INVALID_CALIBRATION_GEOMETRY", "La calibrazione non produce una scala valida");
  } else if (!nearlyEqual(calibration.metersPerPixel, derivedScale)) {
    add(`${field}.metersPerPixel`, "CALIBRATION_SCALE_MISMATCH", "La scala derivata non coincide con distanza e geometria di riferimento");
  }
}

async function loadPhysicalVocabularyForLayout(layout, add) {
  const revisionId = layout.authoredAgainstPhysicalVocabularyRevisionId;
  const revision = revisionId ? await PhysicalVocabularyRevision.findById(revisionId).lean() : null;
  if (!revision) {
    add("layout.authoredAgainstPhysicalVocabularyRevisionId", "PHYSICAL_VOCABULARY_REVISION_NOT_FOUND", "PhysicalVocabularyRevision pinzata non disponibile");
    return { physicalVocabulary: null, revision: null };
  }
  const physicalVocabulary = await PhysicalVocabulary.findOne({ _id: revision.physicalVocabularyId, lifecycleStatus: "active" }).lean();
  if (!physicalVocabulary) {
    add("layout.authoredAgainstPhysicalVocabularyRevisionId", "PHYSICAL_VOCABULARY_NOT_AVAILABLE", "PhysicalVocabulary della revisione pinzata non disponibile");
  }
  if (!["published", "superseded"].includes(revision.status) || revision.integrity?.status !== "valid") {
    add("layout.authoredAgainstPhysicalVocabularyRevisionId", "PHYSICAL_VOCABULARY_REVISION_NOT_PUBLISHABLE", "La VenueRelease richiede una revisione di vocabolario pubblicata e integra");
  }
  return { physicalVocabulary, revision };
}

async function computeVenueReleaseIssues({ venue, release, layout }) {
  const issues = [];
  const add = (field, code, message, severity = "error", context = {}) => issues.push({ field, code, message, severity, context });
  if (!venue || !release || !layout) return [{ field: "release", code: "PHYSICAL_SNAPSHOT_INCOMPLETE", message: "VenueRelease o LayoutRevision mancante", severity: "error" }];
  if (id(release.venueId) !== id(venue._id) || id(layout.venueId) !== id(venue._id)) add("venueId", "VENUE_SCOPE_MISMATCH", "Release e Layout devono appartenere alla stessa Venue");
  if (id(release.layoutRevisionId) !== id(layout._id)) add("layoutRevisionId", "LAYOUT_REVISION_MISMATCH", "La VenueRelease deve puntare alla LayoutRevision validata");

  const { revision: vocabulary } = await loadPhysicalVocabularyForLayout(layout, add);
  const placeTypeById = new Map((vocabulary?.placeTypes || []).map((entry) => [entry.definitionId, entry]));
  const connectionTypeById = new Map((vocabulary?.connectionTypes || []).map((entry) => [entry.definitionId, entry]));
  const attributeById = new Map((vocabulary?.physicalAttributes || []).map((entry) => [entry.definitionId, entry]));

  const floorById = new Map();
  for (let index = 0; index < (layout.floors || []).length; index += 1) {
    const floor = layout.floors[index];
    const floorId = id(floor._id);
    if (floorById.has(floorId)) add(`layout.floors[${index}]._id`, "DUPLICATE_FLOOR_ID", "Floor id duplicato");
    floorById.set(floorId, floor);
  }

  const placeById = new Map();
  for (let index = 0; index < (layout.places || []).length; index += 1) {
    const place = layout.places[index];
    const placeId = id(place._id);
    if (placeById.has(placeId)) add(`layout.places[${index}]._id`, "DUPLICATE_PLACE_ID", "Place id duplicato");
    placeById.set(placeId, place);
    if (!floorById.has(id(place.floorId))) add(`layout.places[${index}].floorId`, "UNKNOWN_FLOOR", "Floor non presente nel Layout");
    if (!placeTypeById.has(place.placeTypeDefinitionId)) add(`layout.places[${index}].placeTypeDefinitionId`, "UNKNOWN_PLACE_TYPE", "PlaceType non presente nel PhysicalVocabulary pinzato");
    validateAttributeValues({ values: place.attributeValues, field: `layout.places[${index}].attributeValues`, target: "place", attributeById, add });
  }

  const connectionById = new Map();
  for (let index = 0; index < (layout.connections || []).length; index += 1) {
    const connection = layout.connections[index];
    const connectionId = id(connection._id);
    if (connectionById.has(connectionId)) add(`layout.connections[${index}]._id`, "DUPLICATE_CONNECTION_ID", "Connection id duplicato");
    connectionById.set(connectionId, connection);
    if (!placeById.has(id(connection.fromPlaceId)) || !placeById.has(id(connection.toPlaceId))) add(`layout.connections[${index}]`, "UNKNOWN_PLACE", "Una Connection riferisce un Place inesistente");
    if (id(connection.fromPlaceId) === id(connection.toPlaceId)) add(`layout.connections[${index}]`, "SELF_CONNECTION", "Una Connection non puo collegare un Place a se stesso");
    if (connection.connectionTypeDefinitionId && !connectionTypeById.has(connection.connectionTypeDefinitionId)) add(`layout.connections[${index}].connectionTypeDefinitionId`, "UNKNOWN_CONNECTION_TYPE", "ConnectionType non presente nel PhysicalVocabulary pinzato");
    validateAttributeValues({ values: connection.attributeValues, field: `layout.connections[${index}].attributeValues`, target: "connection", attributeById, add });
    validateConnectionGeometry({ connection, index, placeById, floorById, add });
  }

  (layout.floors || []).forEach((floor, index) => validateFloorCalibration({ floor, index, connectionById, placeById, add }));

  const bindingIds = (release.targetBindings || []).map((binding) => id(binding.venueTargetId));
  const uniqueBindingIds = new Set(bindingIds);
  if (bindingIds.length !== uniqueBindingIds.size) add("targetBindings", "DUPLICATE_VENUE_TARGET_BINDING", "Ogni VenueTarget puo comparire una sola volta nella VenueRelease");
  const targets = await VenueTarget.find({ _id: { $in: [...uniqueBindingIds] } }).select("_id venueId lifecycleStatus").lean();
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  (release.targetBindings || []).forEach((binding, index) => {
    const target = targetById.get(id(binding.venueTargetId));
    if (!target || id(target.venueId) !== id(venue._id)) add(`targetBindings[${index}].venueTargetId`, "VENUE_TARGET_SCOPE_MISMATCH", "VenueTarget non appartenente alla Venue");
    else if (target.lifecycleStatus !== "active") add(`targetBindings[${index}].venueTargetId`, "VENUE_TARGET_NOT_ACTIVE", "VenueTarget non attivo");
    const mediaUrls = new Set();
    (binding.recognitionMedia || []).forEach((media, mediaIndex) => {
      const url = String(media.url || "").trim();
      if (!url) add(`targetBindings[${index}].recognitionMedia[${mediaIndex}].url`, "RECOGNITION_MEDIA_URL_REQUIRED", "URL immagine di riconoscimento obbligatoria");
      if (mediaUrls.has(url)) add(`targetBindings[${index}].recognitionMedia[${mediaIndex}].url`, "DUPLICATE_RECOGNITION_MEDIA", "Immagine di riconoscimento duplicata");
      mediaUrls.add(url);
    });
  });

  const placementTargetIds = new Set();
  for (let index = 0; index < (layout.venueTargetPlacements || []).length; index += 1) {
    const placement = layout.venueTargetPlacements[index];
    const targetId = id(placement.venueTargetId);
    if (placementTargetIds.has(targetId)) add(`layout.venueTargetPlacements[${index}].venueTargetId`, "DUPLICATE_TARGET_PLACEMENT", "Un VenueTarget puo avere un solo placement nella LayoutRevision");
    placementTargetIds.add(targetId);
    if (!uniqueBindingIds.has(targetId)) add(`layout.venueTargetPlacements[${index}].venueTargetId`, "TARGET_NOT_IN_RELEASE", "Il placement riferisce un VenueTarget non incluso nella VenueRelease");
    if (!placeById.has(id(placement.primaryPlaceId))) add(`layout.venueTargetPlacements[${index}].primaryPlaceId`, "UNKNOWN_PLACE", "Posizione primaria non presente nel Layout");
    if (!(placement.placeIds || []).some((placeId) => id(placeId) === id(placement.primaryPlaceId))) add(`layout.venueTargetPlacements[${index}].placeIds`, "PRIMARY_PLACE_MISSING", "primaryPlaceId deve comparire in placeIds");
    (placement.placeIds || []).forEach((placeId) => { if (!placeById.has(id(placeId))) add(`layout.venueTargetPlacements[${index}].placeIds`, "UNKNOWN_PLACE", "Posizione secondaria non presente nel Layout"); });
  }
  (release.targetBindings || []).forEach((binding, index) => {
    if (binding.availability === "active" && !placementTargetIds.has(id(binding.venueTargetId))) add(`targetBindings[${index}].venueTargetId`, "ACTIVE_TARGET_NOT_PLACED", "Un VenueTarget attivo deve essere posizionato nella LayoutRevision");
  });

  return issues;
}

module.exports = { valueMatchesDefinition, computeVenueReleaseIssues };
