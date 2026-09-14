const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function id(value) { return String(value?._id || value || ""); }
function invalid(field, code, message, context = undefined) {
  throw new AppError(message, 400, [{ field, code, ...(context === undefined ? {} : { context }) }]);
}

function normalizeVenueControlSelections(selections = [], { field = "venueControlSelections" } = {}) {
  if (!Array.isArray(selections)) invalid(field, "INVALID_TYPE", `${field} deve essere un array`);
  const seen = new Set();
  return selections.map((selection, index) => {
    const path = `${field}[${index}]`;
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) invalid(path, "INVALID_VENUE_CONTROL_SELECTION", "La selezione locale deve essere un oggetto");
    for (const key of Object.keys(selection)) {
      if (!["venueId", "physicalAttributeDefinitionId", "value"].includes(key)) invalid(`${path}.${key}`, "UNKNOWN_FIELD", `Campo non supportato: ${key}`);
    }
    const venueId = id(selection.venueId);
    const physicalAttributeDefinitionId = String(selection.physicalAttributeDefinitionId || "").trim();
    if (!mongoose.isValidObjectId(venueId)) invalid(`${path}.venueId`, "INVALID_OBJECT_ID", "venueId non valido");
    if (!UUID_PATTERN.test(physicalAttributeDefinitionId)) invalid(`${path}.physicalAttributeDefinitionId`, "INVALID_UUID", "physicalAttributeDefinitionId non valido");
    const signature = `${venueId}::${physicalAttributeDefinitionId}`;
    if (seen.has(signature)) invalid(path, "DUPLICATE_VENUE_CONTROL_SELECTION", "Una opzione locale può essere selezionata una sola volta per Venue");
    seen.add(signature);
    return {
      venueId,
      physicalAttributeDefinitionId,
      ...(Object.prototype.hasOwnProperty.call(selection, "value") ? { value: selection.value } : {}),
    };
  });
}

function valueMatchesAttribute(value, definition, operator) {
  if (definition.dataType === "boolean") return typeof value === "boolean" && ["eq", "neq"].includes(operator);
  if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value) && ["eq", "neq", "gte", "lte", "gt", "lt"].includes(operator);
  if (definition.dataType === "choice") {
    const allowed = new Set((definition.options || []).map((entry) => entry.value));
    if (operator === "in") return Array.isArray(value) && value.length > 0 && value.every((entry) => allowed.has(entry));
    return typeof value === "string" && allowed.has(value) && ["eq", "neq"].includes(operator);
  }
  return false;
}

function compileVenueControlSelections({ selections = [], bundleByVenueId = new Map() } = {}) {
  const normalized = normalizeVenueControlSelections(selections);
  const requirementsByVenue = new Map();
  for (const [index, selection] of normalized.entries()) {
    const path = `venueControlSelections[${index}]`;
    const bundle = bundleByVenueId.get(String(selection.venueId));
    if (!bundle) invalid(`${path}.venueId`, "VENUE_CONTROL_OUTSIDE_PHYSICAL_SCOPE", "L'opzione locale appartiene a una Venue fuori dallo scope fisico della visita");
    const definition = (bundle.physicalVocabularyRevision?.physicalAttributes || [])
      .find((entry) => String(entry.definitionId) === selection.physicalAttributeDefinitionId);
    if (!definition || !definition.visitorControl?.enabled) {
      invalid(`${path}.physicalAttributeDefinitionId`, "VENUE_CONTROL_UNAVAILABLE", "L'opzione locale non è disponibile nella revisione fisica pinzata dalla Venue");
    }
    const control = definition.visitorControl;
    const value = control.valueMode === "fixed" ? control.value : selection.value;
    if (control.valueMode === "user" && !Object.prototype.hasOwnProperty.call(selection, "value")) {
      invalid(`${path}.value`, "REQUIRED", "Questa opzione locale richiede un valore scelto dal visitatore");
    }
    if (!valueMatchesAttribute(value, definition, control.operator || "eq")) {
      invalid(`${path}.value`, "INCOMPATIBLE_VALUE", "Il valore scelto non è compatibile con l'opzione locale");
    }
    if (!requirementsByVenue.has(selection.venueId)) requirementsByVenue.set(selection.venueId, []);
    requirementsByVenue.get(selection.venueId).push({
      physicalFeatureRef: {
        kind: "local",
        physicalVocabularyId: bundle.physicalVocabulary._id,
        definitionId: definition.definitionId,
      },
      operator: control.operator || "eq",
      value,
      priority: control.priority || "preferred",
      weight: 1,
    });
  }
  return [...requirementsByVenue.entries()].map(([venueId, requirements]) => ({ venueId, requirements }));
}

module.exports = {
  normalizeVenueControlSelections,
  compileVenueControlSelections,
};
