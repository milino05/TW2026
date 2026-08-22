const AppError = require("../utils/AppError");
const { canonicalRoutingAttribute } = require("../config/globalRoutingAttributes");

const OPERATORS_BY_TYPE = Object.freeze({
  boolean: new Set(["eq", "neq", "in"]),
  number: new Set(["eq", "neq", "gte", "lte", "gt", "lt", "in"]),
  string: new Set(["eq", "neq", "in"]),
  choice: new Set(["eq", "neq", "in"]),
});

function invalid(field, code, message) {
  throw new AppError(message, 400, [{ field, code }]);
}

function normalizeScalar(definition, value, field) {
  switch (definition.dataType) {
    case "boolean":
      if (typeof value !== "boolean") invalid(field, "INVALID_ROUTING_VALUE", `${field} deve essere booleano`);
      return value;
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number)) invalid(field, "INVALID_ROUTING_VALUE", `${field} deve essere numerico`);
      return number;
    }
    case "string":
      if (typeof value !== "string" || !value.trim()) invalid(field, "INVALID_ROUTING_VALUE", `${field} deve essere una stringa non vuota`);
      return value.trim();
    case "choice": {
      const normalized = String(value || "").trim();
      if (!normalized || !(definition.options || []).includes(normalized)) {
        invalid(field, "INVALID_ROUTING_VALUE", `${field} non appartiene alle opzioni del catalogo canonico`);
      }
      return normalized;
    }
    default:
      invalid(field, "UNSUPPORTED_ROUTING_ATTRIBUTE_TYPE", `Tipo non supportato per ${definition.key}`);
  }
}

function normalizeValue(definition, operator, value, field) {
  if (operator === "in") {
    if (!Array.isArray(value) || value.length === 0) invalid(field, "INVALID_ROUTING_VALUE", `${field} deve essere un array non vuoto`);
    return value.map((entry, index) => normalizeScalar(definition, entry, `${field}[${index}]`));
  }
  return normalizeScalar(definition, value, field);
}

function normalizeCanonicalRoutingRequirement(requirement, index = 0) {
  const field = `requirements[${index}]`;
  if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
    invalid(field, "INVALID_ROUTING_REQUIREMENT", `${field} deve essere un oggetto`);
  }
  const attributeKey = String(requirement.attributeKey || "").trim().toLowerCase();
  const definition = canonicalRoutingAttribute(attributeKey);
  if (!definition) {
    invalid(`${field}.attributeKey`, "UNKNOWN_GLOBAL_ROUTING_ATTRIBUTE", `Attributo di routing globale non disponibile: ${attributeKey || "<vuoto>"}`);
  }
  const operator = String(requirement.operator || "eq").trim().toLowerCase();
  if (!OPERATORS_BY_TYPE[definition.dataType]?.has(operator)) {
    invalid(`${field}.operator`, "INVALID_ROUTING_OPERATOR", `Operatore ${operator} non valido per ${definition.dataType}`);
  }
  const priority = String(requirement.priority || "preferred").trim().toLowerCase();
  if (!["required", "preferred"].includes(priority)) {
    invalid(`${field}.priority`, "INVALID_ROUTING_PRIORITY", "priority deve essere required o preferred");
  }
  const weight = requirement.weight === undefined ? 1 : Number(requirement.weight);
  if (!Number.isFinite(weight) || weight < 0) {
    invalid(`${field}.weight`, "INVALID_ROUTING_WEIGHT", "weight deve essere un numero non negativo");
  }
  return {
    attributeKey: definition.key,
    operator,
    value: normalizeValue(definition, operator, requirement.value, `${field}.value`),
    priority,
    weight,
  };
}

function normalizeCanonicalRoutingRequirements(requirements, { field = "requirements" } = {}) {
  if (requirements === undefined) return [];
  if (!Array.isArray(requirements)) invalid(field, "INVALID_TYPE", `${field} deve essere un array`);
  return requirements.map((requirement, index) => normalizeCanonicalRoutingRequirement(requirement, index));
}

module.exports = {
  normalizeCanonicalRoutingRequirement,
  normalizeCanonicalRoutingRequirements,
};
