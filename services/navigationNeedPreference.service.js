const AppError = require("../utils/AppError");
const { normalizeRoutingRequirements } = require("./routingPreferenceV2.service");
const {
  navigationNeedById,
  semanticNeedId,
} = require("../config/navigationNeedCatalog");

function invalid(field, code, message, context = undefined) {
  throw new AppError(message, 400, [{ field, code, ...(context === undefined ? {} : { context }) }]);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePersonalNavigationRequirements(requirements, { field = "requirements" } = {}) {
  const normalized = normalizeRoutingRequirements(requirements, { field, semanticOnly: true });
  const seen = new Set();
  return normalized.map((requirement, index) => {
    const path = `${field}[${index}]`;
    const needId = semanticNeedId(requirement.physicalFeatureRef);
    const definition = navigationNeedById(needId);
    if (!definition) {
      invalid(`${path}.physicalFeatureRef`, "UNKNOWN_PERSONAL_NAVIGATION_NEED", "Le preferenze personali possono usare soltanto esigenze di percorso canoniche ArtAround");
    }
    if (seen.has(needId)) invalid(path, "DUPLICATE_PERSONAL_NAVIGATION_NEED", `Esigenza personale duplicata: ${needId}`);
    seen.add(needId);
    if (requirement.operator !== definition.operator) {
      invalid(`${path}.operator`, "PERSONAL_NAVIGATION_OPERATOR_MISMATCH", `${definition.label} richiede l'operatore ${definition.operator}`);
    }
    if (!definition.allowedPriorities.includes(requirement.priority)) {
      invalid(`${path}.priority`, "PERSONAL_NAVIGATION_PRIORITY_NOT_ALLOWED", "Una esigenza personale può essere Preferita oppure Necessaria", { allowedValues: definition.allowedPriorities });
    }
    if (Number(requirement.weight) !== 1) {
      invalid(`${path}.weight`, "PERSONAL_NAVIGATION_WEIGHT_NOT_ALLOWED", "Il peso delle preferenze personali non è configurabile");
    }
    if (definition.valueMode === "fixed") {
      if (!sameValue(requirement.value, definition.value)) {
        invalid(`${path}.value`, "PERSONAL_NAVIGATION_VALUE_MISMATCH", `${definition.label} usa un valore canonico non modificabile`);
      }
    } else {
      if (definition.dataType === "number" && (!Number.isFinite(requirement.value) || requirement.value < 0)) {
        invalid(`${path}.value`, "INVALID_PERSONAL_NAVIGATION_VALUE", `${definition.label} richiede un valore numerico non negativo`);
      }
    }
    return { ...requirement, weight: 1 };
  });
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
  normalizePersonalNavigationRequirements,
  projectPersonalNavigationRequirements,
};
