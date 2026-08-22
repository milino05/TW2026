const mongoose = require("mongoose");

const FEATURE_KINDS = ["subject", "canonical", "subject_class", "relation_type", "presentation_aspect", "selection_signal"];
const GOAL_PRIORITIES = ["required", "preferred", "avoid"];
const RELATION_GOAL_KINDS = ["relationship", "follow_relation", "compare"];
const COVERAGE_GOALS = ["balanced", "all", "custom"];
const HISTORY_MODES = ["full", "declared_only", "current_request_only"];
const ROUTING_OPERATORS = ["eq", "neq", "gte", "lte", "gt", "lt", "in"];
const ROUTING_PRIORITIES = ["required", "preferred"];
const GENERATION_SOURCE_TYPES = ["editorial_context", "editorial_release"];
const TOP_LEVEL_FIELDS = new Set([
  "venueIds", "editorialSources", "timeBudgetSeconds", "hardTimeBudget",
  "semanticGoals", "relationGoals", "coverageGoal", "historyMode", "knowledge", "audience",
  "depthPreference", "languageComplexityPreference", "locale", "movementPacePreference",
  "observationEmphasis", "visitDensity", "discoveryPreference", "timeRiskTolerance",
  "mustIncludeItemEditionIds", "mustVisitVenueTargetIds", "excludedItemEditionIds",
  "navigationRequirements", "interVenueTransfers",
]);

function issue(field, code, message, context = undefined) {
  const value = { field, code, message };
  if (context !== undefined) value.context = context;
  return value;
}
function validId(value) { return mongoose.isValidObjectId(value); }
function validateUnit(value, field, errors) {
  if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) {
    errors.push(issue(field, "INVALID_NUMBER", `${field} deve essere tra 0 e 1`));
  }
}
function validateIdArray(payload, field, errors, { required = false, nonEmpty = false } = {}) {
  const value = payload[field];
  if (required && value === undefined) { errors.push(issue(field, "REQUIRED", `${field} e obbligatorio`)); return; }
  if (value === undefined) return;
  if (!Array.isArray(value) || (nonEmpty && !value.length) || value.some((entry) => !validId(entry))) {
    errors.push(issue(field, "INVALID_OBJECT_ID_ARRAY", `${field} deve contenere ObjectId validi${nonEmpty ? " e non essere vuoto" : ""}`));
  }
}
function validateEditorialSources(payload, errors) {
  if (payload.editorialSources === undefined) return;
  if (!Array.isArray(payload.editorialSources) || !payload.editorialSources.length) {
    errors.push(issue("editorialSources", "EDITORIAL_SCOPE_EMPTY", "editorialSources deve essere un array non vuoto quando specificato"));
    return;
  }
  const seen = new Set();
  payload.editorialSources.forEach((source, index) => {
    const field = `editorialSources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push(issue(field, "INVALID_TYPE", "Generation source non valida"));
      return;
    }
    const unknown = Object.keys(source).filter((key) => !["resourceType", "resourceId"].includes(key));
    for (const key of unknown) errors.push(issue(`${field}.${key}`, "UNKNOWN_FIELD", `Campo non supportato: ${key}`));
    const resourceType = String(source.resourceType || "").trim().toLowerCase();
    if (!GENERATION_SOURCE_TYPES.includes(resourceType)) errors.push(issue(`${field}.resourceType`, "INVALID_ENUM", "resourceType deve essere editorial_context oppure editorial_release"));
    if (!validId(source.resourceId)) errors.push(issue(`${field}.resourceId`, "INVALID_OBJECT_ID", "resourceId non valido"));
    const key = `${resourceType}:${String(source.resourceId || "")}`;
    if (seen.has(key)) errors.push(issue(field, "DUPLICATE_VALUE", "Generation source duplicata"));
    seen.add(key);
  });
}
function validateFeature(feature, field, errors) {
  if (!feature || typeof feature !== "object" || !FEATURE_KINDS.includes(feature.kind)) {
    errors.push(issue(field, "INVALID_FEATURE", "Feature semantica v2 non valida"));
    return;
  }
  if (feature.kind === "subject" && !validId(feature.subjectId)) {
    errors.push(issue(`${field}.subjectId`, "INVALID_OBJECT_ID", "subjectId non valido"));
  } else if (feature.kind === "canonical") {
    if (!feature.scheme || !(feature.id || feature.refId)) errors.push(issue(field, "SEMANTIC_REF_REQUIRED", "Feature canonical richiede scheme e id"));
  } else if (["subject_class", "relation_type", "presentation_aspect", "selection_signal"].includes(feature.kind)) {
    if (!validId(feature.namespaceId)) errors.push(issue(`${field}.namespaceId`, "INVALID_OBJECT_ID", "namespaceId e obbligatorio per feature locali"));
    if (!feature.definitionId) errors.push(issue(`${field}.definitionId`, "REQUIRED", "definitionId e obbligatorio per feature locali"));
  }
}
function validateSemanticGoal(goal, field, errors) {
  if (!goal || typeof goal !== "object") { errors.push(issue(field, "INVALID_GOAL", "Goal semantico non valido")); return; }
  if (!GOAL_PRIORITIES.includes(goal.priority || "preferred")) errors.push(issue(`${field}.priority`, "INVALID_ENUM", "priority non valida"));
  validateFeature(goal.feature, `${field}.feature`, errors);
  validateUnit(goal.weight === undefined ? 1 : goal.weight, `${field}.weight`, errors);
}
function validateRelationGoal(goal, field, errors) {
  if (!goal || typeof goal !== "object" || !RELATION_GOAL_KINDS.includes(goal.kind)) {
    errors.push(issue(field, "INVALID_RELATION_GOAL", "Relation goal non valido")); return;
  }
  if (!GOAL_PRIORITIES.includes(goal.priority || "preferred")) errors.push(issue(`${field}.priority`, "INVALID_ENUM", "priority non valida"));
  validateFeature(goal.from, `${field}.from`, errors);
  if (["relationship", "compare"].includes(goal.kind)) validateFeature(goal.to, `${field}.to`, errors);
  if (goal.to && goal.kind === "follow_relation") validateFeature(goal.to, `${field}.to`, errors);
  if (goal.relationType !== undefined) {
    if (!goal.relationType || typeof goal.relationType !== "object" || !validId(goal.relationType.namespaceId) || !goal.relationType.definitionId) {
      errors.push(issue(`${field}.relationType`, "INVALID_RELATION_TYPE", "relationType richiede namespaceId e definitionId"));
    }
  } else if (goal.kind === "follow_relation") {
    errors.push(issue(`${field}.relationType`, "REQUIRED", "follow_relation richiede relationType"));
  }
  if (goal.maxDepth !== undefined && (!Number.isInteger(Number(goal.maxDepth)) || Number(goal.maxDepth) < 1 || Number(goal.maxDepth) > 6)) {
    errors.push(issue(`${field}.maxDepth`, "INVALID_NUMBER", "maxDepth deve essere tra 1 e 6"));
  }
  validateUnit(goal.weight === undefined ? 1 : goal.weight, `${field}.weight`, errors);
}
function validateRoutingRequirement(entry, field, errors) {
  if (!entry || typeof entry !== "object") { errors.push(issue(field, "INVALID_ROUTING_REQUIREMENT", "Routing requirement non valido")); return; }
  if (!entry.attributeKey) errors.push(issue(`${field}.attributeKey`, "REQUIRED", "attributeKey e obbligatoria"));
  if (entry.operator !== undefined && !ROUTING_OPERATORS.includes(entry.operator)) errors.push(issue(`${field}.operator`, "INVALID_ENUM", "operator non valido"));
  if (entry.priority !== undefined && !ROUTING_PRIORITIES.includes(entry.priority)) errors.push(issue(`${field}.priority`, "INVALID_ENUM", "priority non valida"));
  if (entry.value === undefined) errors.push(issue(`${field}.value`, "REQUIRED", "value e obbligatorio"));
  if (entry.weight !== undefined && (!Number.isFinite(Number(entry.weight)) || Number(entry.weight) < 0)) errors.push(issue(`${field}.weight`, "INVALID_NUMBER", "weight deve essere >= 0"));
}
function validateGenerationRequestV2(payload = {}) {
  const errors = [];
  for (const field of Object.keys(payload)) if (!TOP_LEVEL_FIELDS.has(field)) errors.push(issue(field, "UNKNOWN_FIELD", `Campo non supportato: ${field}`));
  validateIdArray(payload, "venueIds", errors, { required: true, nonEmpty: true });
  validateEditorialSources(payload, errors);
  validateIdArray(payload, "mustIncludeItemEditionIds", errors);
  validateIdArray(payload, "mustVisitVenueTargetIds", errors);
  validateIdArray(payload, "excludedItemEditionIds", errors);
  const time = Number(payload.timeBudgetSeconds);
  if (!Number.isFinite(time) || time <= 0) errors.push(issue("timeBudgetSeconds", "INVALID_NUMBER", "timeBudgetSeconds deve essere positivo"));
  if (payload.hardTimeBudget !== undefined && typeof payload.hardTimeBudget !== "boolean") errors.push(issue("hardTimeBudget", "INVALID_TYPE", "hardTimeBudget deve essere boolean"));
  for (const field of ["depthPreference", "languageComplexityPreference", "movementPacePreference", "observationEmphasis", "visitDensity", "discoveryPreference", "timeRiskTolerance"]) validateUnit(payload[field], field, errors);
  if (payload.locale !== undefined && (typeof payload.locale !== "string" || !payload.locale.trim())) errors.push(issue("locale", "INVALID_STRING", "locale deve essere una stringa non vuota"));
  if (payload.semanticGoals !== undefined && !Array.isArray(payload.semanticGoals)) errors.push(issue("semanticGoals", "INVALID_TYPE", "semanticGoals deve essere un array"));
  (payload.semanticGoals || []).forEach((goal, index) => validateSemanticGoal(goal, `semanticGoals[${index}]`, errors));
  if (payload.relationGoals !== undefined && !Array.isArray(payload.relationGoals)) errors.push(issue("relationGoals", "INVALID_TYPE", "relationGoals deve essere un array"));
  (payload.relationGoals || []).forEach((goal, index) => validateRelationGoal(goal, `relationGoals[${index}]`, errors));
  if (payload.coverageGoal !== undefined && !COVERAGE_GOALS.includes(payload.coverageGoal)) errors.push(issue("coverageGoal", "INVALID_ENUM", "coverageGoal non valido"));
  if (payload.historyMode !== undefined && !HISTORY_MODES.includes(payload.historyMode)) errors.push(issue("historyMode", "INVALID_ENUM", "historyMode non valido"));
  if (payload.knowledge !== undefined && !Array.isArray(payload.knowledge)) errors.push(issue("knowledge", "INVALID_TYPE", "knowledge deve essere un array"));
  (payload.knowledge || []).forEach((entry, index) => {
    if (!validId(entry?.subjectId)) errors.push(issue(`knowledge[${index}].subjectId`, "INVALID_OBJECT_ID", "subjectId non valido"));
    validateUnit(entry?.level, `knowledge[${index}].level`, errors);
  });
  if (payload.audience !== undefined) {
    if (!payload.audience || typeof payload.audience !== "object") errors.push(issue("audience", "INVALID_TYPE", "audience deve essere un oggetto"));
    else {
      if (payload.audience.ageYears !== undefined && (!Number.isFinite(Number(payload.audience.ageYears)) || Number(payload.audience.ageYears) < 0 || Number(payload.audience.ageYears) > 130)) errors.push(issue("audience.ageYears", "INVALID_NUMBER", "ageYears non valido"));
      validateUnit(payload.audience.maturity, "audience.maturity", errors);
    }
  }
  if (payload.navigationRequirements !== undefined && !Array.isArray(payload.navigationRequirements)) errors.push(issue("navigationRequirements", "INVALID_TYPE", "navigationRequirements deve essere un array"));
  (payload.navigationRequirements || []).forEach((entry, index) => validateRoutingRequirement(entry, `navigationRequirements[${index}]`, errors));
  if (payload.interVenueTransfers !== undefined && !Array.isArray(payload.interVenueTransfers)) errors.push(issue("interVenueTransfers", "INVALID_TYPE", "interVenueTransfers deve essere un array"));
  const selectedVenues = new Set((payload.venueIds || []).map(String));
  (payload.interVenueTransfers || []).forEach((entry, index) => {
    if (!validId(entry?.fromVenueId)) errors.push(issue(`interVenueTransfers[${index}].fromVenueId`, "INVALID_OBJECT_ID", "fromVenueId non valido"));
    if (!validId(entry?.toVenueId)) errors.push(issue(`interVenueTransfers[${index}].toVenueId`, "INVALID_OBJECT_ID", "toVenueId non valido"));
    if (validId(entry?.fromVenueId) && !selectedVenues.has(String(entry.fromVenueId))) errors.push(issue(`interVenueTransfers[${index}].fromVenueId`, "OUTSIDE_PHYSICAL_SCOPE", "fromVenueId non appartiene al PhysicalScope"));
    if (validId(entry?.toVenueId) && !selectedVenues.has(String(entry.toVenueId))) errors.push(issue(`interVenueTransfers[${index}].toVenueId`, "OUTSIDE_PHYSICAL_SCOPE", "toVenueId non appartiene al PhysicalScope"));
    if (String(entry?.fromVenueId || "") === String(entry?.toVenueId || "")) errors.push(issue(`interVenueTransfers[${index}]`, "SAME_VENUE_TRANSFER", "Un transfer inter-Venue richiede Venue differenti"));
    if (!Number.isFinite(Number(entry?.estimatedSeconds)) || Number(entry.estimatedSeconds) <= 0) errors.push(issue(`interVenueTransfers[${index}].estimatedSeconds`, "INVALID_NUMBER", "estimatedSeconds deve essere positivo"));
  });
  if ((payload.venueIds || []).length > 1 && !(payload.interVenueTransfers || []).length) {
    errors.push(issue("interVenueTransfers", "REQUIRED_FOR_MULTI_VENUE", "Un PhysicalScope multi-Venue richiede trasferimenti inter-Venue espliciti"));
  }
  const mustEditions = (payload.mustIncludeItemEditionIds || []).map(String);
  if (new Set(mustEditions).size !== mustEditions.length) errors.push(issue("mustIncludeItemEditionIds", "DUPLICATE_VALUE", "mustIncludeItemEditionIds contiene duplicati"));
  const mustTargets = (payload.mustVisitVenueTargetIds || []).map(String);
  if (new Set(mustTargets).size !== mustTargets.length) errors.push(issue("mustVisitVenueTargetIds", "DUPLICATE_VALUE", "mustVisitVenueTargetIds contiene duplicati"));
  return errors;
}

module.exports = {
  FEATURE_KINDS,
  GOAL_PRIORITIES,
  RELATION_GOAL_KINDS,
  COVERAGE_GOALS,
  HISTORY_MODES,
  GENERATION_SOURCE_TYPES,
  validateFeature,
  validateSemanticGoal,
  validateRelationGoal,
  validateGenerationRequestV2,
};
