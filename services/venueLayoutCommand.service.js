const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const LayoutRevision = require("../models/layoutRevision.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { ensureWorkingVenueRelease } = require("./venueRelease.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");
const {
  deriveMetersPerPixel,
  distanceMetersForGeometry,
  samePoint,
  validNormalizedPoint,
} = require("./layoutGeometry.service");

function id(value) { return String(value?._id || value || ""); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); }
function finitePositive(value, minimum = 0) { return typeof value === "number" && Number.isFinite(value) && value > minimum; }
function plain(value) { return value?.toObject ? value.toObject() : value; }
function lengthConstraintTolerance(distanceMeters) { return Math.max(0.05, Number(distanceMeters) * 0.01); }

function commandError(message, code, field = null, statusCode = 400, extra = {}) {
  throw new AppError(message, statusCode, [{ ...(field ? { field } : {}), code, ...extra }]);
}

function assertAllowedFields(value, allowed, field = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    commandError(`${field} deve essere un oggetto`, "INVALID_TYPE", field);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) commandError(`Campo non supportato: ${key}`, "UNKNOWN_FIELD", field === "payload" ? key : `${field}.${key}`);
  }
}

function requiredText(value, field, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized) commandError(`${field} e obbligatorio`, "REQUIRED", field);
  if (normalized.length > maxLength) commandError(`${field} troppo lungo`, "MAX_LENGTH", field, 400, { maxLength });
  return normalized;
}

function optionalText(value, field, maxLength = 500) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > maxLength) commandError(`${field} troppo lungo`, "MAX_LENGTH", field, 400, { maxLength });
  return normalized || null;
}

function normalizedPoint(value, field = "position") {
  assertAllowedFields(value, ["x", "y"], field);
  const point = { x: Number(value?.x), y: Number(value?.y) };
  if (!validNormalizedPoint(point)) commandError("Coordinate normalizzate non valide", "INVALID_NORMALIZED_POINT", field);
  return point;
}

function normalizedGeometryPoints(values, field = "geometry.points") {
  if (!Array.isArray(values)) commandError("La geometria deve essere un array di punti", "INVALID_TYPE", field);
  return values.map((entry, index) => normalizedPoint(entry, `${field}[${index}]`));
}

function normalizeMapAsset(value) {
  if (value === null) return null;
  assertAllowedFields(value, ["url", "mimeType", "width", "height", "originalName"], "mapAsset");
  const url = requiredText(value.url, "mapAsset.url", 2000);
  const mimeType = requiredText(value.mimeType, "mapAsset.mimeType", 120).toLowerCase();
  if (!mimeType.startsWith("image/")) commandError("La planimetria deve essere un'immagine", "INVALID_MAP_MIME_TYPE", "mapAsset.mimeType");
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isInteger(width) || width < 1) commandError("Larghezza immagine non valida", "INVALID_DIMENSION", "mapAsset.width");
  if (!Number.isInteger(height) || height < 1) commandError("Altezza immagine non valida", "INVALID_DIMENSION", "mapAsset.height");
  return { url, mimeType, width, height, originalName: optionalText(value.originalName, "mapAsset.originalName", 255) };
}

function vocabularyMaps(vocabulary) {
  return {
    placeTypeById: new Map((vocabulary.placeTypes || []).map((entry) => [String(entry.definitionId), entry])),
    connectionTypeById: new Map((vocabulary.connectionTypes || []).map((entry) => [String(entry.definitionId), entry])),
    attributeById: new Map((vocabulary.physicalAttributes || []).map((entry) => [String(entry.definitionId), entry])),
  };
}

function valueMatchesDefinition(definition, value) {
  if (!definition || value === undefined || value === null) return false;
  if (definition.dataType === "boolean") return typeof value === "boolean";
  if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.dataType === "string") return typeof value === "string";
  if (definition.dataType === "choice") {
    const allowed = new Set((definition.options || []).map((entry) => entry.value));
    return typeof value === "string" && allowed.has(value);
  }
  return false;
}

function assertAttributeValue({ definitionId, value, target, maps, field }) {
  const definition = maps.attributeById.get(String(definitionId || ""));
  if (!definition) commandError("Caratteristica fisica non presente nel vocabolario pinzato", "UNKNOWN_PHYSICAL_ATTRIBUTE", field);
  if (![target, "both"].includes(definition.appliesTo)) commandError("Caratteristica fisica non applicabile a questa entita", "ATTRIBUTE_TARGET_MISMATCH", field);
  if (!valueMatchesDefinition(definition, value)) commandError(`Valore non compatibile con ${definition.dataType}`, "ATTRIBUTE_VALUE_TYPE_MISMATCH", field);
  return definition;
}

function replaceAttributeValue(values, definitionId, value) {
  const next = (values || []).filter((entry) => String(entry.physicalAttributeDefinitionId) !== String(definitionId));
  if (value !== null && value !== undefined) next.push({ physicalAttributeDefinitionId: definitionId, value });
  return next;
}

function floorById(layout, floorId) {
  const floor = layout.floors.id(floorId);
  if (!floor) commandError("Piano non trovato", "FLOOR_NOT_FOUND", "floorId", 404);
  return floor;
}

function placeById(layout, placeId) {
  const place = layout.places.id(placeId);
  if (!place) commandError("Luogo non trovato", "PLACE_NOT_FOUND", "placeId", 404);
  return place;
}

function connectionById(layout, connectionId) {
  const connection = layout.connections.id(connectionId);
  if (!connection) commandError("Collegamento non trovato", "CONNECTION_NOT_FOUND", "connectionId", 404);
  return connection;
}

function assertSameFloor(layout, from, to) {
  if (id(from.floorId) !== id(to.floorId)) commandError("La geometria planare richiede luoghi sullo stesso piano", "CROSS_FLOOR_GEOMETRY_NOT_SUPPORTED", "geometry");
  return floorById(layout, from.floorId);
}

function assertGeometryEndpoints(points, from, to) {
  if (points.length < 2) commandError("Servono almeno due punti per la geometria", "CONNECTION_GEOMETRY_REQUIRED", "geometry.points");
  if (!samePoint(points[0], from.position) || !samePoint(points.at(-1), to.position)) {
    commandError("La geometria deve iniziare e terminare sui luoghi collegati", "GEOMETRY_ENDPOINT_MISMATCH", "geometry.points");
  }
}

function straightGeometry(from, to) {
  return [{ x: from.position.x, y: from.position.y }, { x: to.position.x, y: to.position.y }];
}

function connectionMetric({ layout, from, to, payload, current = null }) {
  const metricMode = String(payload.metricMode || current?.metricMode || "manual_override");
  if (!["geometry_derived", "length_constrained", "manual_override"].includes(metricMode)) {
    commandError("Modalita metrica non valida", "INVALID_METRIC_MODE", "metricMode");
  }
  const suppliedGeometry = hasOwn(payload, "geometryPoints");
  const currentHasGeometry = Boolean(current?.geometry?.points?.length);
  let points = suppliedGeometry
    ? normalizedGeometryPoints(payload.geometryPoints)
    : (currentHasGeometry ? current.geometry.points.map((entry) => ({ x: entry.x, y: entry.y })) : []);

  if (["geometry_derived", "length_constrained"].includes(metricMode)) {
    const floor = assertSameFloor(layout, from, to);
    if (!floor.mapAsset || !floor.calibration) commandError("Per questa modalita serve una planimetria calibrata", "CALIBRATED_FLOOR_REQUIRED", "metricMode", 409);
    if (!points.length) points = straightGeometry(from, to);
    assertGeometryEndpoints(points, from, to);
    const geometricDistance = distanceMetersForGeometry({ points, floor });
    if (!finitePositive(geometricDistance)) commandError("La geometria non produce una distanza metrica valida", "INVALID_CONNECTION_GEOMETRY", "geometry.points");
    if (metricMode === "geometry_derived") {
      return { metricMode, distanceMeters: geometricDistance, geometry: { points } };
    }
    const requested = Number(hasOwn(payload, "distanceMeters") ? payload.distanceMeters : current?.distanceMeters);
    if (!finitePositive(requested, 0.09)) commandError("La lunghezza richiesta deve essere positiva", "INVALID_DISTANCE", "distanceMeters");
    const straightDistance = distanceMetersForGeometry({ points: straightGeometry(from, to), floor });
    const tolerance = lengthConstraintTolerance(requested);
    if (straightDistance > requested + tolerance) commandError("La lunghezza richiesta e inferiore alla distanza minima fra i due luoghi", "IMPOSSIBLE_LENGTH_CONSTRAINT", "distanceMeters");
    if (!suppliedGeometry && !currentHasGeometry && Math.abs(geometricDistance - requested) > tolerance) {
      commandError("Disegna una geometria che soddisfi la lunghezza richiesta", "LENGTH_CONSTRAINT_GEOMETRY_REQUIRED", "geometry.points", 409, {
        requestedDistanceMeters: requested,
        straightDistanceMeters: straightDistance,
        toleranceMeters: tolerance,
      });
    }
    if (Math.abs(geometricDistance - requested) > tolerance) {
      commandError("La geometria disegnata non soddisfa la lunghezza richiesta", "LENGTH_CONSTRAINT_GEOMETRY_MISMATCH", "geometry.points", 409, {
        requestedDistanceMeters: requested,
        geometricDistanceMeters: geometricDistance,
        toleranceMeters: tolerance,
      });
    }
    return { metricMode, distanceMeters: requested, geometry: { points } };
  }

  const distanceMeters = Number(hasOwn(payload, "distanceMeters") ? payload.distanceMeters : current?.distanceMeters);
  if (!finitePositive(distanceMeters, 0.09)) commandError("La distanza manuale deve essere positiva", "INVALID_DISTANCE", "distanceMeters");
  if (points.length) {
    const floor = assertSameFloor(layout, from, to);
    void floor;
    assertGeometryEndpoints(points, from, to);
  }
  return { metricMode, distanceMeters, geometry: points.length ? { points } : null };
}

function recomputeDerivedConnectionsForFloor(layout, floorId) {
  const floor = floorById(layout, floorId);
  for (const connection of layout.connections || []) {
    if (connection.metricMode !== "geometry_derived" || !connection.geometry?.points?.length) continue;
    const from = layout.places.id(connection.fromPlaceId);
    const to = layout.places.id(connection.toPlaceId);
    if (!from || !to || id(from.floorId) !== id(floor._id) || id(to.floorId) !== id(floor._id)) continue;
    const distance = distanceMetersForGeometry({ points: connection.geometry.points, floor });
    if (finitePositive(distance)) connection.distanceMeters = distance;
  }
}

async function mutateWorkingLayout({ venueId, actorUserId, mutate }) {
  const ensured = await ensureWorkingVenueRelease({ venueId, actorUserId });
  let commandResult = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const currentVenue = await Venue.findOne({
        _id: venueId,
        lifecycleStatus: "active",
        workingReleaseId: ensured.release._id,
      }).select("_id workingReleaseId").session(session);
      if (!currentVenue) commandError("La bozza fisica è cambiata durante il comando", "WORKING_RELEASE_CHANGED", null, 409);
      const release = await VenueRelease.findOne({ _id: ensured.release._id, venueId }).session(session);
      const layout = await LayoutRevision.findOne({ _id: ensured.layout._id, venueId }).session(session);
      if (!release || !layout) commandError("Bozza fisica non disponibile", "WORKING_LAYOUT_NOT_FOUND", null, 409);
      try { markRevisionEdited(release, actorUserId); }
      catch (error) { commandError(error.message, error.code || "REVISION_NOT_EDITABLE", null, 409); }
      const vocabulary = await PhysicalVocabularyRevision.findById(layout.authoredAgainstPhysicalVocabularyRevisionId).session(session);
      if (!vocabulary) commandError("Vocabolario fisico pinzato non disponibile", "PHYSICAL_VOCABULARY_REVISION_NOT_FOUND", null, 409);
      const maps = vocabularyMaps(vocabulary);
      const result = await mutate({ release, layout, vocabulary, maps, session });
      layout.updatedBy = actorUserId;
      await layout.save({ session });
      await release.save({ session });
      commandResult = {
        venueId,
        release: { id: release._id, version: release.version, status: release.status, integrity: release.integrity },
        layout: plain(layout),
        result: plain(result),
      };
    });
    return commandResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Comando Layout non completato", 500, [{ code: "VENUE_LAYOUT_COMMAND_FAILED", message: error.message }]);
  }
}

async function addFloor({ venueId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["label"]);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const floor = layout.floors.create({ label: requiredText(payload.label, "label", 120) });
    layout.floors.push(floor);
    return { floorId: floor._id, floor };
  } });
}

async function updateFloor({ venueId, floorId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["label"]);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const floor = floorById(layout, floorId);
    if (hasOwn(payload, "label")) floor.label = requiredText(payload.label, "label", 120);
    return { floorId: floor._id, floor };
  } });
}

async function setManagedFloorPlan({ venueId, floorId, actorUserId, mapAsset }) {
  if (mapAsset === null || mapAsset === undefined) commandError("Planimetria gestita obbligatoria", "REQUIRED", "mapAsset");
  const normalizedMapAsset = normalizeMapAsset(mapAsset);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const floor = floorById(layout, floorId);
    const previousMapAssetUrl = floor.mapAsset?.url || null;
    floor.mapAsset = normalizedMapAsset;
    floor.calibration = null;
    return { floorId: floor._id, mapAsset: floor.mapAsset, previousMapAssetUrl };
  } });
}

async function calibrateFloor({ venueId, floorId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["method", "distanceMeters", "line", "referenceConnectionId"]);
  if (hasOwn(payload, "line") && payload.line !== null) assertAllowedFields(payload.line, ["from", "to"], "line");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const floor = floorById(layout, floorId);
    if (!floor.mapAsset) commandError("Carica prima una planimetria gestita", "CALIBRATION_MAP_ASSET_REQUIRED", "mapAsset", 409);
    const method = String(payload.method || "line");
    const distanceMeters = Number(payload.distanceMeters);
    if (!finitePositive(distanceMeters)) commandError("Distanza di calibrazione non valida", "INVALID_DISTANCE", "distanceMeters");
    let points;
    let calibration;
    if (method === "line") {
      const from = normalizedPoint(payload.line?.from, "line.from");
      const to = normalizedPoint(payload.line?.to, "line.to");
      points = [from, to];
      calibration = { method, distanceMeters, line: { from, to }, referenceConnectionId: null };
    } else if (method === "connection") {
      const connection = connectionById(layout, payload.referenceConnectionId);
      const from = placeById(layout, connection.fromPlaceId);
      const to = placeById(layout, connection.toPlaceId);
      if (id(from.floorId) !== id(floor._id) || id(to.floorId) !== id(floor._id)) commandError("Il collegamento di riferimento non appartiene al piano", "CALIBRATION_CONNECTION_FLOOR_MISMATCH", "referenceConnectionId");
      points = (connection.geometry?.points || []).map((entry) => ({ x: entry.x, y: entry.y }));
      if (points.length < 2) commandError("Il collegamento di riferimento deve avere una geometria", "CALIBRATION_CONNECTION_GEOMETRY_REQUIRED", "referenceConnectionId");
      calibration = { method, distanceMeters, line: null, referenceConnectionId: connection._id };
    } else commandError("Metodo di calibrazione non valido", "INVALID_CALIBRATION_METHOD", "method");
    const metersPerPixel = deriveMetersPerPixel({ distanceMeters, points, mapAsset: floor.mapAsset });
    if (!finitePositive(metersPerPixel)) commandError("La calibrazione non produce una scala valida", "INVALID_CALIBRATION_GEOMETRY", "calibration");
    floor.calibration = { ...calibration, metersPerPixel };
    recomputeDerivedConnectionsForFloor(layout, floor._id);
    return { floorId: floor._id, calibration: floor.calibration };
  } });
}

async function removeFloor({ venueId, floorId, actorUserId }) {
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const floor = floorById(layout, floorId);
    if ((layout.places || []).some((place) => id(place.floorId) === id(floor._id))) commandError("Sposta o rimuovi prima i luoghi presenti sul piano", "FLOOR_NOT_EMPTY", "floorId", 409);
    const mapAssetUrl = floor.mapAsset?.url || null;
    layout.floors.pull(floor._id);
    return { removedFloorId: floor._id, mapAssetUrl };
  } });
}

async function createPlace({ venueId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["floorId", "placeTypeDefinitionId", "label", "position", "attributeValues"]);
  if (hasOwn(payload, "attributeValues") && !Array.isArray(payload.attributeValues)) commandError("attributeValues deve essere un array", "INVALID_TYPE", "attributeValues");
  for (const [index, entry] of (payload.attributeValues || []).entries()) assertAllowedFields(entry, ["physicalAttributeDefinitionId", "value"], `attributeValues[${index}]`);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const floor = floorById(layout, payload.floorId);
    const typeId = String(payload.placeTypeDefinitionId || "");
    if (!maps.placeTypeById.has(typeId)) commandError("Tipo di luogo non presente nel vocabolario pinzato", "UNKNOWN_PLACE_TYPE", "placeTypeDefinitionId");
    const attributeValues = Array.isArray(payload.attributeValues) ? payload.attributeValues : [];
    const attributeIds = attributeValues.map((entry) => String(entry.physicalAttributeDefinitionId || ""));
    if (new Set(attributeIds).size !== attributeIds.length) commandError("Una caratteristica fisica non puo essere ripetuta", "DUPLICATE_PHYSICAL_ATTRIBUTE_VALUE", "attributeValues");
    for (const [index, entry] of attributeValues.entries()) {
      assertAttributeValue({ definitionId: entry.physicalAttributeDefinitionId, value: entry.value, target: "place", maps, field: `attributeValues[${index}]` });
    }
    const place = layout.places.create({
      floorId: floor._id,
      placeTypeDefinitionId: typeId,
      label: optionalText(payload.label, "label", 160),
      position: normalizedPoint(payload.position),
      attributeValues,
    });
    layout.places.push(place);
    return { placeId: place._id, place };
  } });
}

async function movePlace({ venueId, placeId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["position"]);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const place = placeById(layout, placeId);
    const nextPosition = normalizedPoint(payload.position);
    place.position = nextPosition;
    for (const connection of layout.connections || []) {
      if (!connection.geometry?.points?.length) continue;
      if (id(connection.fromPlaceId) === id(place._id)) connection.geometry.points[0] = nextPosition;
      if (id(connection.toPlaceId) === id(place._id)) connection.geometry.points[connection.geometry.points.length - 1] = nextPosition;
    }
    recomputeDerivedConnectionsForFloor(layout, place.floorId);
    return { placeId: place._id, position: place.position };
  } });
}

async function updatePlace({ venueId, placeId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["label", "placeTypeDefinitionId"]);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const place = placeById(layout, placeId);
    if (hasOwn(payload, "label")) place.label = optionalText(payload.label, "label", 160);
    if (hasOwn(payload, "placeTypeDefinitionId")) {
      const typeId = String(payload.placeTypeDefinitionId || "");
      if (!maps.placeTypeById.has(typeId)) commandError("Tipo di luogo non presente nel vocabolario pinzato", "UNKNOWN_PLACE_TYPE", "placeTypeDefinitionId");
      place.placeTypeDefinitionId = typeId;
    }
    return { placeId: place._id, place };
  } });
}

async function setPlaceAttribute({ venueId, placeId, definitionId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["value"]);
  if (!hasOwn(payload, "value")) commandError("value e obbligatorio; usa null per rimuovere la caratteristica", "REQUIRED", "value");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const place = placeById(layout, placeId);
    if (payload.value !== null) assertAttributeValue({ definitionId, value: payload.value, target: "place", maps, field: "value" });
    place.attributeValues = replaceAttributeValue(place.attributeValues, definitionId, payload.value);
    return { placeId: place._id, physicalAttributeDefinitionId: definitionId, value: payload.value ?? null };
  } });
}

async function removePlace({ venueId, placeId, actorUserId }) {
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const place = placeById(layout, placeId);
    if ((layout.connections || []).some((entry) => id(entry.fromPlaceId) === id(place._id) || id(entry.toPlaceId) === id(place._id))) commandError("Rimuovi prima i collegamenti del luogo", "PLACE_HAS_CONNECTIONS", "placeId", 409);
    if ((layout.venueTargetPlacements || []).some((entry) => (entry.placeIds || []).some((value) => id(value) === id(place._id)))) commandError("Sposta prima gli oggetti collocati nel luogo", "PLACE_HAS_TARGET_PLACEMENTS", "placeId", 409);
    layout.places.pull(place._id);
    return { removedPlaceId: place._id };
  } });
}

async function createConnection({ venueId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, [
    "fromPlaceId", "toPlaceId", "connectionTypeDefinitionId", "directionality", "metricMode",
    "distanceMeters", "geometryPoints", "additionalDelaySeconds", "instructions",
  ]);
  if (hasOwn(payload, "instructions") && payload.instructions !== null) assertAllowedFields(payload.instructions, ["forward", "backward"], "instructions");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const from = placeById(layout, payload.fromPlaceId);
    const to = placeById(layout, payload.toPlaceId);
    if (id(from._id) === id(to._id)) commandError("Un collegamento non puo collegare un luogo a se stesso", "SELF_CONNECTION", "toPlaceId");
    const connectionTypeDefinitionId = payload.connectionTypeDefinitionId ? String(payload.connectionTypeDefinitionId) : null;
    if (connectionTypeDefinitionId && !maps.connectionTypeById.has(connectionTypeDefinitionId)) commandError("Tipo di collegamento non presente nel vocabolario pinzato", "UNKNOWN_CONNECTION_TYPE", "connectionTypeDefinitionId");
    const directionality = String(payload.directionality || "bidirectional");
    if (!["directed", "bidirectional"].includes(directionality)) commandError("Direzionalita non valida", "INVALID_DIRECTIONALITY", "directionality");
    const metric = connectionMetric({ layout, from, to, payload });
    let additionalDelaySeconds = 0;
    if (hasOwn(payload, "additionalDelaySeconds")) {
      additionalDelaySeconds = Number(payload.additionalDelaySeconds);
      if (!Number.isFinite(additionalDelaySeconds) || additionalDelaySeconds < 0) commandError("Ritardo aggiuntivo non valido", "INVALID_DELAY", "additionalDelaySeconds");
    }
    const connection = layout.connections.create({
      fromPlaceId: from._id,
      toPlaceId: to._id,
      directionality,
      connectionTypeDefinitionId,
      ...metric,
      additionalDelaySeconds,
      instructions: {
        forward: optionalText(payload.instructions?.forward, "instructions.forward", 500),
        backward: optionalText(payload.instructions?.backward, "instructions.backward", 500),
      },
      attributeValues: [],
    });
    layout.connections.push(connection);
    return { connectionId: connection._id, connection };
  } });
}

async function updateConnection({ venueId, connectionId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, [
    "connectionTypeDefinitionId", "directionality", "metricMode", "distanceMeters", "geometryPoints",
    "additionalDelaySeconds", "instructions",
  ]);
  if (hasOwn(payload, "instructions") && payload.instructions !== null) assertAllowedFields(payload.instructions, ["forward", "backward"], "instructions");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const connection = connectionById(layout, connectionId);
    const from = placeById(layout, connection.fromPlaceId);
    const to = placeById(layout, connection.toPlaceId);
    if (hasOwn(payload, "connectionTypeDefinitionId")) {
      const definitionId = payload.connectionTypeDefinitionId ? String(payload.connectionTypeDefinitionId) : null;
      if (definitionId && !maps.connectionTypeById.has(definitionId)) commandError("Tipo di collegamento non presente nel vocabolario pinzato", "UNKNOWN_CONNECTION_TYPE", "connectionTypeDefinitionId");
      connection.connectionTypeDefinitionId = definitionId;
    }
    if (hasOwn(payload, "directionality")) {
      if (!["directed", "bidirectional"].includes(payload.directionality)) commandError("Direzionalita non valida", "INVALID_DIRECTIONALITY", "directionality");
      connection.directionality = payload.directionality;
    }
    if (hasOwn(payload, "additionalDelaySeconds")) {
      const delay = Number(payload.additionalDelaySeconds);
      if (!Number.isFinite(delay) || delay < 0) commandError("Ritardo aggiuntivo non valido", "INVALID_DELAY", "additionalDelaySeconds");
      connection.additionalDelaySeconds = delay;
    }
    if (hasOwn(payload, "instructions")) {
      connection.instructions = {
        forward: optionalText(payload.instructions?.forward, "instructions.forward", 500),
        backward: optionalText(payload.instructions?.backward, "instructions.backward", 500),
      };
    }
    if (["metricMode", "distanceMeters", "geometryPoints"].some((key) => hasOwn(payload, key))) {
      const metric = connectionMetric({ layout, from, to, payload, current: connection });
      connection.metricMode = metric.metricMode;
      connection.distanceMeters = metric.distanceMeters;
      connection.geometry = metric.geometry;
    }
    return { connectionId: connection._id, connection };
  } });
}

async function setConnectionAttribute({ venueId, connectionId, definitionId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["value"]);
  if (!hasOwn(payload, "value")) commandError("value e obbligatorio; usa null per rimuovere la caratteristica", "REQUIRED", "value");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout, maps }) => {
    const connection = connectionById(layout, connectionId);
    if (payload.value !== null) assertAttributeValue({ definitionId, value: payload.value, target: "connection", maps, field: "value" });
    connection.attributeValues = replaceAttributeValue(connection.attributeValues, definitionId, payload.value);
    return { connectionId: connection._id, physicalAttributeDefinitionId: definitionId, value: payload.value ?? null };
  } });
}

async function removeConnection({ venueId, connectionId, actorUserId }) {
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ layout }) => {
    const connection = connectionById(layout, connectionId);
    const referenced = (layout.floors || []).find((floor) => id(floor.calibration?.referenceConnectionId) === id(connection._id));
    if (referenced) commandError("Il collegamento e usato per calibrare un piano", "CONNECTION_USED_FOR_CALIBRATION", "connectionId", 409, { floorId: referenced._id });
    layout.connections.pull(connection._id);
    return { removedConnectionId: connection._id };
  } });
}

async function setVenueTargetPlacement({ venueId, venueTargetId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["primaryPlaceId", "placeIds"]);
  if (hasOwn(payload, "placeIds") && !Array.isArray(payload.placeIds)) commandError("placeIds deve essere un array", "INVALID_TYPE", "placeIds");
  return mutateWorkingLayout({ venueId, actorUserId, mutate: async ({ release, layout, session }) => {
    const target = await VenueTarget.findOne({ _id: venueTargetId, venueId, lifecycleStatus: "active" }).session(session);
    if (!target) commandError("Oggetto della sede non trovato", "VENUE_TARGET_NOT_FOUND", "venueTargetId", 404);
    const primary = placeById(layout, payload.primaryPlaceId);
    const requestedIds = Array.isArray(payload.placeIds) ? payload.placeIds : [];
    const placeIds = [...new Map([primary._id, ...requestedIds].map((value) => [id(value), value])).values()];
    for (const value of placeIds) placeById(layout, value);
    const existing = (layout.venueTargetPlacements || []).find((entry) => id(entry.venueTargetId) === id(target._id));
    if (existing) {
      existing.primaryPlaceId = primary._id;
      existing.placeIds = placeIds;
    } else layout.venueTargetPlacements.push({ venueTargetId: target._id, primaryPlaceId: primary._id, placeIds });
    let binding = (release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
    if (!binding) {
      release.targetBindings.push({ venueTargetId: target._id, availability: "active", recognitionMedia: [] });
      binding = release.targetBindings.at(-1);
    } else binding.availability = "active";
    return { venueTargetId: target._id, primaryPlaceId: primary._id, placeIds, availability: binding.availability };
  } });
}

async function setPreVisitInformation({ venueId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["items"]);
  return mutateWorkingLayout({ venueId, actorUserId, mutate: ({ release }) => {
    if (!Array.isArray(payload.items)) commandError("items deve essere un array", "INVALID_TYPE", "items");
    const items = payload.items.map((entry, index) => requiredText(entry, `items[${index}]`, 500));
    release.preVisitInformation = items;
    return { preVisitInformation: items };
  } });
}

module.exports = {
  addFloor,
  updateFloor,
  setManagedFloorPlan,
  calibrateFloor,
  removeFloor,
  createPlace,
  movePlace,
  updatePlace,
  setPlaceAttribute,
  removePlace,
  createConnection,
  updateConnection,
  setConnectionAttribute,
  removeConnection,
  setVenueTargetPlacement,
  setPreVisitInformation,
};
