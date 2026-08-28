const AppError = require("../utils/AppError");
const {
  REQUIREMENT_OPERATORS,
  REQUIREMENT_PRIORITIES,
  normalizePhysicalFeatureRef,
  validatePhysicalFeatureRef,
} = require("./validation/physicalVocabulary.validation");

function invalid(field, code, message, context = undefined) {
  throw new AppError(message, 400, [{ field, code, ...(context === undefined ? {} : { context }) }]);
}

function normalizeRoutingRequirement(requirement, index = 0, fieldPrefix = "requirements", { semanticOnly = false } = {}) {
  const field = `${fieldPrefix}[${index}]`;
  if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
    invalid(field, "INVALID_ROUTING_REQUIREMENT", `${field} deve essere un oggetto`);
  }
  const physicalFeatureRef = normalizePhysicalFeatureRef(requirement.physicalFeatureRef);
  const referenceIssues = validatePhysicalFeatureRef(physicalFeatureRef, `${field}.physicalFeatureRef`);
  if (referenceIssues.length) throw new AppError("Riferimento fisico non valido", 400, referenceIssues);
  if (semanticOnly && physicalFeatureRef.kind !== "semantic") {
    invalid(`${field}.physicalFeatureRef.kind`, "SEMANTIC_PHYSICAL_FEATURE_REQUIRED", "Una preferenza persistente cross-sede richiede un riferimento fisico semantico");
  }
  const operator = String(requirement.operator || "eq").trim().toLowerCase();
  if (!REQUIREMENT_OPERATORS.includes(operator)) {
    invalid(`${field}.operator`, "INVALID_ROUTING_OPERATOR", `Operatore di routing non valido: ${operator}`);
  }
  const priority = String(requirement.priority || "preferred").trim().toLowerCase();
  if (!REQUIREMENT_PRIORITIES.includes(priority)) {
    invalid(`${field}.priority`, "INVALID_ROUTING_PRIORITY", "priority deve essere required, preferred oppure avoid");
  }
  if (requirement.value === undefined) invalid(`${field}.value`, "REQUIRED", "value e obbligatorio");
  if (operator === "in" && (!Array.isArray(requirement.value) || !requirement.value.length)) {
    invalid(`${field}.value`, "INVALID_ROUTING_VALUE", `${field}.value deve essere un array non vuoto per l'operatore in`);
  }
  const weight = requirement.weight === undefined ? 1 : Number(requirement.weight);
  if (!Number.isFinite(weight) || weight < 0) {
    invalid(`${field}.weight`, "INVALID_ROUTING_WEIGHT", "weight deve essere un numero non negativo");
  }
  return {
    physicalFeatureRef,
    operator,
    value: requirement.value,
    priority,
    weight,
  };
}

function normalizeRoutingRequirements(requirements, { field = "requirements", semanticOnly = false } = {}) {
  if (requirements === undefined) return [];
  if (!Array.isArray(requirements)) invalid(field, "INVALID_TYPE", `${field} deve essere un array`);
  return requirements.map((requirement, index) => normalizeRoutingRequirement(requirement, index, field, { semanticOnly }));
}

module.exports = { normalizeRoutingRequirement, normalizeRoutingRequirements };
