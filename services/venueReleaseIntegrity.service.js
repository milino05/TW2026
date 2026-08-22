const VenueTarget = require("../models/venueTarget.model");
const { getCanonicalAttribute, GLOBAL_PLACE_INTENTS } = require("./routingAttributeCatalog.service");

function duplicateKeys(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of values) {
    if (!entry?.key) continue;
    if (seen.has(entry.key)) duplicates.add(entry.key);
    seen.add(entry.key);
  }
  return [...duplicates];
}
function valueMatchesDefinition(definition, value) {
  if (!definition) return false;
  if (definition.dataType === "boolean") return typeof value === "boolean";
  if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.dataType === "string") return typeof value === "string";
  if (definition.dataType === "choice") return typeof value === "string" && (definition.options || []).includes(value);
  return false;
}
function validateAttributeBag({ values, field, target, attributeByKey, add }) {
  for (const [key, value] of Object.entries(values || {})) {
    const definition = attributeByKey.get(key);
    if (!definition) { add(`${field}.${key}`, "UNKNOWN_ROUTING_ATTRIBUTE", "Routing attribute non definito"); continue; }
    if (![target, "both"].includes(definition.appliesTo)) add(`${field}.${key}`, "ATTRIBUTE_TARGET_MISMATCH", `L'attributo ${key} non e applicabile a ${target}`);
    if (!valueMatchesDefinition(definition, value)) add(`${field}.${key}`, "ATTRIBUTE_VALUE_TYPE_MISMATCH", `Valore non compatibile con dataType ${definition.dataType}`);
  }
}
function validateRequirement({ requirement, field, attributeByKey, add }) {
  const definition = attributeByKey.get(requirement.attributeKey);
  if (!definition) { add(`${field}.attributeKey`, "UNKNOWN_ROUTING_ATTRIBUTE", "Preset riferisce un attributo non definito"); return; }
  const numericOperators = new Set(["gte", "lte", "gt", "lt"]);
  if (numericOperators.has(requirement.operator) && definition.dataType !== "number") add(`${field}.operator`, "OPERATOR_TYPE_MISMATCH", "Gli operatori numerici richiedono un routingAttribute number");
  if (requirement.operator !== "in" && !valueMatchesDefinition(definition, requirement.value)) add(`${field}.value`, "REQUIREMENT_VALUE_TYPE_MISMATCH", `Valore non compatibile con ${definition.dataType}`);
  if (requirement.operator === "in" && !Array.isArray(requirement.value)) add(`${field}.value`, "IN_REQUIRES_ARRAY", "L'operatore in richiede un array");
}

async function computeVenueReleaseIssues({ venue, release, layout }) {
  const issues = [];
  const add = (field, code, message, severity = "error", context = {}) => issues.push({ field, code, message, severity, context });
  if (!venue || !release || !layout) return [{ field: "release", code: "PHYSICAL_SNAPSHOT_INCOMPLETE", message: "VenueRelease o LayoutRevision mancante", severity: "error" }];
  if (String(release.venueId) !== String(venue._id) || String(layout.venueId) !== String(venue._id)) add("venueId", "VENUE_SCOPE_MISMATCH", "Release e Layout devono appartenere alla stessa Venue");
  if (String(release.layoutRevisionId) !== String(layout._id)) add("layoutRevisionId", "LAYOUT_REVISION_MISMATCH", "La VenueRelease deve puntare alla LayoutRevision validata");

  for (const [field, values] of [["placeTypes", layout.placeTypes], ["routingAttributes", layout.routingAttributes], ["routingPresets", layout.routingPresets], ["floors", layout.floors]]) {
    duplicateKeys(values).forEach((key) => add(`layout.${field}`, "DUPLICATE_KEY", `Chiave duplicata: ${key}`));
  }
  const floorKeys = new Set((layout.floors || []).map((entry) => entry.key));
  const placeTypeKeys = new Set((layout.placeTypes || []).map((entry) => entry.key));
  const placeIds = new Set((layout.places || []).map((entry) => String(entry._id)));
  const attributeByKey = new Map((layout.routingAttributes || []).map((entry) => [entry.key, entry]));
  const allowedIntents = new Set(GLOBAL_PLACE_INTENTS);
  const localByCanonical = new Map();

  (layout.placeTypes || []).forEach((placeType, index) => (placeType.userIntents || []).forEach((intent, intentIndex) => {
    if (!allowedIntents.has(intent)) add(`layout.placeTypes[${index}].userIntents[${intentIndex}]`, "UNKNOWN_PLACE_INTENT", `Intento globale non riconosciuto: ${intent}`);
  }));
  (layout.routingAttributes || []).forEach((attribute, index) => {
    if (attribute.dataType === "choice" && !(attribute.options || []).length) add(`layout.routingAttributes[${index}].options`, "CHOICE_OPTIONS_REQUIRED", "Un attributo choice deve definire almeno una option");
    if (attribute.canonicalKey) {
      const canonicalKey = String(attribute.canonicalKey).trim().toLowerCase();
      if (localByCanonical.has(canonicalKey)) {
        add(
          `layout.routingAttributes[${index}].canonicalKey`,
          "DUPLICATE_CANONICAL_ATTRIBUTE_MAPPING",
          `La canonicalKey ${canonicalKey} e gia mappata dall'attributo locale ${localByCanonical.get(canonicalKey)}`,
        );
      } else {
        localByCanonical.set(canonicalKey, attribute.key);
      }
      const canonical = getCanonicalAttribute(canonicalKey);
      if (!canonical) add(`layout.routingAttributes[${index}].canonicalKey`, "UNKNOWN_CANONICAL_ATTRIBUTE", "Attributo globale sconosciuto");
      else {
        if (canonical.dataType !== attribute.dataType) add(`layout.routingAttributes[${index}].dataType`, "CANONICAL_TYPE_MISMATCH", "Il dataType non coincide con il catalogo globale");
        if (canonical.appliesTo !== "both" && attribute.appliesTo !== canonical.appliesTo) add(`layout.routingAttributes[${index}].appliesTo`, "CANONICAL_TARGET_MISMATCH", "appliesTo non coincide con il catalogo globale");
      }
    }
  });
  (layout.places || []).forEach((place, index) => {
    if (!floorKeys.has(place.floorKey)) add(`layout.places[${index}].floorKey`, "UNKNOWN_FLOOR", "Piano non definito");
    if (!placeTypeKeys.has(place.typeKey)) add(`layout.places[${index}].typeKey`, "UNKNOWN_PLACE_TYPE", "PlaceType non definito");
    validateAttributeBag({ values: place.attributes, field: `layout.places[${index}].attributes`, target: "place", attributeByKey, add });
  });

  const bindingIds = (release.targetBindings || []).map((binding) => String(binding.venueTargetId));
  const uniqueBindingIds = new Set(bindingIds);
  if (bindingIds.length !== uniqueBindingIds.size) add("targetBindings", "DUPLICATE_VENUE_TARGET_BINDING", "Ogni VenueTarget puo comparire una sola volta nella VenueRelease");
  const targets = await VenueTarget.find({ _id: { $in: [...uniqueBindingIds] } }).select("_id venueId lifecycleStatus").lean();
  const targetById = new Map(targets.map((target) => [String(target._id), target]));
  (release.targetBindings || []).forEach((binding, index) => {
    const target = targetById.get(String(binding.venueTargetId));
    if (!target || String(target.venueId) !== String(venue._id)) add(`targetBindings[${index}].venueTargetId`, "VENUE_TARGET_SCOPE_MISMATCH", "VenueTarget non appartenente alla Venue");
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
    const targetId = String(placement.venueTargetId);
    if (placementTargetIds.has(targetId)) add(`layout.venueTargetPlacements[${index}].venueTargetId`, "DUPLICATE_TARGET_PLACEMENT", "Un VenueTarget puo avere un solo placement nella LayoutRevision");
    placementTargetIds.add(targetId);
    if (!uniqueBindingIds.has(targetId)) add(`layout.venueTargetPlacements[${index}].venueTargetId`, "TARGET_NOT_IN_RELEASE", "Il placement riferisce un VenueTarget non incluso nella VenueRelease");
    if (!placeIds.has(String(placement.primaryPlaceId))) add(`layout.venueTargetPlacements[${index}].primaryPlaceId`, "UNKNOWN_PLACE", "Posizione primaria non presente nel layout");
    if (!(placement.placeIds || []).some((id) => String(id) === String(placement.primaryPlaceId))) add(`layout.venueTargetPlacements[${index}].placeIds`, "PRIMARY_PLACE_MISSING", "primaryPlaceId deve comparire in placeIds");
    (placement.placeIds || []).forEach((placeId) => { if (!placeIds.has(String(placeId))) add(`layout.venueTargetPlacements[${index}].placeIds`, "UNKNOWN_PLACE", "Posizione secondaria non presente nel layout"); });
  }
  (release.targetBindings || []).forEach((binding, index) => {
    if (binding.availability === "active" && !placementTargetIds.has(String(binding.venueTargetId))) add(`targetBindings[${index}].venueTargetId`, "ACTIVE_TARGET_NOT_PLACED", "Un VenueTarget attivo deve essere posizionato nella LayoutRevision");
  });

  (layout.connections || []).forEach((connection, index) => {
    if (!placeIds.has(String(connection.fromPlaceId)) || !placeIds.has(String(connection.toPlaceId))) add(`layout.connections[${index}]`, "UNKNOWN_PLACE", "Una connection riferisce un Place inesistente");
    if (String(connection.fromPlaceId) === String(connection.toPlaceId)) add(`layout.connections[${index}]`, "SELF_CONNECTION", "Una connection non puo collegare un Place a se stesso");
    validateAttributeBag({ values: connection.attributes, field: `layout.connections[${index}].attributes`, target: "connection", attributeByKey, add });
  });
  (layout.routingPresets || []).forEach((preset, presetIndex) => (preset.requirements || []).forEach((requirement, requirementIndex) => {
    validateRequirement({ requirement, field: `layout.routingPresets[${presetIndex}].requirements[${requirementIndex}]`, attributeByKey, add });
  }));
  return issues;
}

module.exports = { computeVenueReleaseIssues };
