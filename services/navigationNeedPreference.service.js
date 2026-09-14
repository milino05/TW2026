const AppError = require("../utils/AppError");
const { normalizeRoutingRequirements } = require("./routingPreferenceV2.service");
const {
  navigationNeedById,
  semanticNeedId,
  canonicalPhysicalFeatureRef,
} = require("../config/navigationNeedCatalog");

function invalid(field, code, message, context = undefined) {
  throw new AppError(message, 400, [{ field, code, ...(context === undefined ? {} : { context }) }]);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePersonalNavigationNeedSelections(selections, { field = "personalNeedSelections" } = {}) {
  if (selections === undefined) return [];
  if (!Array.isArray(selections)) invalid(field, "INVALID_TYPE", `${field} deve essere un array`);
  const seen = new Set();
  return selections.map((selection, index) => {
    const path = `${field}[${index}]`;
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      invalid(path, "INVALID_PERSONAL_NAVIGATION_NEED_SELECTION", `${path} deve essere un oggetto`);
    }
    for (const key of Object.keys(selection)) {
      if (!["id", "priority", "value"].includes(key)) invalid(`${path}.${key}`, "UNKNOWN_FIELD", `Campo non supportato: ${key}`);
    }
    const needId = String(selection.id || "").trim();
    const definition = navigationNeedById(needId);
    if (!definition) invalid(`${path}.id`, "UNKNOWN_PERSONAL_NAVIGATION_NEED", `Esigenza personale non supportata: ${needId || "(vuota)"}`);
    if (seen.has(needId)) invalid(path, "DUPLICATE_PERSONAL_NAVIGATION_NEED", `Esigenza personale duplicata: ${needId}`);
    seen.add(needId);
    const priority = String(selection.priority || definition.defaultPriority).trim().toLowerCase();
    if (!definition.allowedPriorities.includes(priority)) {
      invalid(`${path}.priority`, "PERSONAL_NAVIGATION_PRIORITY_NOT_ALLOWED", "Una esigenza personale può essere Preferita oppure Necessaria", { allowedValues: definition.allowedPriorities });
    }
    let value = definition.value;
    if (definition.valueMode === "user") {
      value = selection.value;
      if (definition.dataType === "number" && (!Number.isFinite(value) || value < 0)) {
        invalid(`${path}.value`, "INVALID_PERSONAL_NAVIGATION_VALUE", `${definition.label} richiede un valore numerico non negativo`);
      }
    } else if (Object.prototype.hasOwnProperty.call(selection, "value") && !sameValue(selection.value, definition.value)) {
      invalid(`${path}.value`, "PERSONAL_NAVIGATION_VALUE_MISMATCH", `${definition.label} usa un valore canonico non modificabile`);
    }
    return { id: needId, priority, value };
  });
}

function compilePersonalNavigationNeedSelections({ selections = [], existingRequirements = [], field = "personalNeedSelections" } = {}) {
  const normalizedSelections = normalizePersonalNavigationNeedSelections(selections, { field });
  const normalizedExisting = normalizeRoutingRequirements(existingRequirements, { field: "existingNavigationRequirements" });
  const preserved = normalizedExisting.filter((requirement) => !semanticNeedId(requirement.physicalFeatureRef));
  const compiled = normalizedSelections.map((selection) => {
    const definition = navigationNeedById(selection.id);
    return {
      physicalFeatureRef: canonicalPhysicalFeatureRef(selection.id),
      operator: definition.operator,
      value: selection.value,
      priority: selection.priority,
      weight: 1,
    };
  });
  return [...preserved, ...compiled];
}

function projectPersonalNavigationRequirements(requirements = []) {
  return (requirements || []).flatMap((requirement) => {
    const needId = semanticNeedId(requirement?.physicalFeatureRef);
    const definition = navigationNeedById(needId);
    if (!definition) return [];
    return [{
      id: definition.id,
      label: definition.label,
      description: definition.description,
      priority: requirement.priority || definition.defaultPriority,
      value: requirement.value,
      unit: definition.unit,
      advanced: definition.advanced,
    }];
  });
}

module.exports = {
  normalizePersonalNavigationNeedSelections,
  compilePersonalNavigationNeedSelections,
  projectPersonalNavigationRequirements,
};
