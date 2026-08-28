const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { translateRoutingRequirements } = require("./physicalVocabularyResolver.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function id(value) { return String(value?._id || value || ""); }
function stableValue(value) { return JSON.stringify(value); }
function selectionMap(selections = [], { field = "routingProfileSelections" } = {}) {
  if (!Array.isArray(selections)) {
    throw new AppError("routingProfileSelections deve essere un array", 400, [{ field, code: "INVALID_TYPE" }]);
  }
  const result = new Map();
  for (const [index, selection] of selections.entries()) {
    const venueId = id(selection?.venueId);
    const definitionId = String(selection?.routingProfileDefinitionId || "").trim();
    if (!mongoose.isValidObjectId(venueId) || !UUID_PATTERN.test(definitionId)) {
      throw new AppError("Selezione profilo di percorso non valida", 400, [{ field: `${field}[${index}]`, code: "INVALID_ROUTING_PROFILE_SELECTION" }]);
    }
    if (result.has(venueId)) {
      throw new AppError("È ammesso un solo profilo di percorso per Venue", 400, [{ field: `${field}[${index}].venueId`, code: "DUPLICATE_VALUE" }]);
    }
    result.set(venueId, { venueId, routingProfileDefinitionId: definitionId });
  }
  return result;
}
function normalizeRoutingProfileSelections(selections = [], options = {}) {
  return [...selectionMap(selections, options).values()];
}
function profileRequirements({ revision, routingProfileDefinitionId }) {
  const profile = (revision?.routingProfiles || []).find((entry) => entry.definitionId === routingProfileDefinitionId) || null;
  if (!profile) {
    return {
      profile: null,
      requirements: [],
      blockers: [{
        code: "ROUTING_PROFILE_UNAVAILABLE",
        message: "Il profilo di percorso selezionato non appartiene al vocabolario fisico pinzato dalla Venue.",
        priority: "required",
        reason: "routing_profile_not_found",
      }],
    };
  }
  const attributes = new Map((revision?.physicalAttributes || []).map((definition) => [definition.definitionId, definition]));
  const requirements = [];
  const blockers = [];
  for (const requirement of profile.requirements || []) {
    const definition = attributes.get(String(requirement.physicalAttributeDefinitionId));
    if (!definition) {
      blockers.push({
        code: "ROUTING_PROFILE_ATTRIBUTE_UNRESOLVED",
        message: `Il profilo ${profile.label} contiene una caratteristica fisica non risolvibile nella revisione pinzata.`,
        priority: "required",
        reason: "routing_profile_attribute_not_found",
      });
      continue;
    }
    requirements.push({
      physicalAttributeDefinitionId: definition.definitionId,
      appliesTo: definition.appliesTo || "connection",
      operator: requirement.operator || "eq",
      value: requirement.value,
      priority: requirement.priority || "preferred",
      weight: requirement.weight ?? 1,
      source: "routing_profile",
      routingProfileDefinitionId: profile.definitionId,
    });
  }
  return { profile, requirements, blockers };
}
function dedupeRequirements(requirements = []) {
  const bySignature = new Map();
  for (const requirement of requirements || []) {
    const signature = [
      requirement.physicalAttributeDefinitionId,
      requirement.appliesTo || "connection",
      requirement.operator || "eq",
      stableValue(requirement.value),
      requirement.priority || "preferred",
    ].join("::");
    const existing = bySignature.get(signature);
    if (!existing || Number(requirement.weight ?? 1) > Number(existing.weight ?? 1)) bySignature.set(signature, requirement);
  }
  return [...bySignature.values()];
}
function hardConstraintConflict(requirements = []) {
  const byAttribute = new Map();
  for (const requirement of requirements.filter((entry) => (entry.priority || "preferred") === "required")) {
    const key = String(requirement.physicalAttributeDefinitionId);
    if (!byAttribute.has(key)) byAttribute.set(key, []);
    byAttribute.get(key).push(requirement);
  }
  for (const [definitionId, group] of byAttribute) {
    const accepts = (candidate, requirement) => {
      const operator = requirement.operator || "eq";
      if (operator === "eq") return stableValue(candidate) === stableValue(requirement.value);
      if (operator === "neq") return stableValue(candidate) !== stableValue(requirement.value);
      if (operator === "in") return Array.isArray(requirement.value)
        && requirement.value.some((value) => stableValue(value) === stableValue(candidate));
      if (operator === "gte") return Number(candidate) >= Number(requirement.value);
      if (operator === "lte") return Number(candidate) <= Number(requirement.value);
      if (operator === "gt") return Number(candidate) > Number(requirement.value);
      if (operator === "lt") return Number(candidate) < Number(requirement.value);
      return false;
    };
    const finiteSource = group.find((entry) => (entry.operator || "eq") === "eq" || entry.operator === "in");
    if (finiteSource) {
      const candidates = finiteSource.operator === "in" ? finiteSource.value : [finiteSource.value];
      if (!candidates.some((candidate) => group.every((requirement) => accepts(candidate, requirement)))) {
        return { definitionId, requirements: group };
      }
      continue;
    }
    const numeric = group.filter((entry) => typeof entry.value === "number" && Number.isFinite(entry.value));
    const lowerRequirements = numeric.filter((entry) => ["gte", "gt"].includes(entry.operator));
    const upperRequirements = numeric.filter((entry) => ["lte", "lt"].includes(entry.operator));
    const lower = lowerRequirements.reduce((best, entry) => Math.max(best, Number(entry.value)), -Infinity);
    const upper = upperRequirements.reduce((best, entry) => Math.min(best, Number(entry.value)), Infinity);
    const lowerExclusive = lowerRequirements.some((entry) => Number(entry.value) === lower && entry.operator === "gt");
    const upperExclusive = upperRequirements.some((entry) => Number(entry.value) === upper && entry.operator === "lt");
    if (lower > upper || (lower === upper && (lowerExclusive || upperExclusive))) return { definitionId, requirements: group };
    if (lower === upper && group.some((entry) => entry.operator === "neq" && stableValue(entry.value) === stableValue(lower))) {
      return { definitionId, requirements: group };
    }
  }
  return null;
}
function resolveVenueRoutingRequirements({
  globalRequirements = [],
  routingProfileSelection = null,
  physicalVocabulary,
  revision,
  unresolvedAvoidPolicy = "warning",
} = {}) {
  const translated = translateRoutingRequirements({
    requirements: globalRequirements,
    physicalVocabulary,
    revision,
    unresolvedAvoidPolicy,
  });
  const selected = routingProfileSelection
    ? profileRequirements({ revision, routingProfileDefinitionId: routingProfileSelection.routingProfileDefinitionId })
    : { profile: null, requirements: [], blockers: [] };
  const requirements = dedupeRequirements([...translated.requirements, ...selected.requirements]);
  const conflict = hardConstraintConflict(requirements);
  const blockers = [...translated.blockers, ...selected.blockers];
  if (conflict) {
    blockers.push({
      code: "ROUTING_REQUIREMENT_CONFLICT",
      message: "Il profilo locale e i requisiti globali contengono vincoli obbligatori incompatibili.",
      priority: "required",
      reason: "hard_requirement_conflict",
      physicalAttributeDefinitionId: conflict.definitionId,
    });
  }
  return {
    requirements,
    warnings: translated.warnings,
    blockers,
    selectedProfile: selected.profile ? {
      definitionId: selected.profile.definitionId,
      label: selected.profile.label,
    } : null,
  };
}

module.exports = {
  selectionMap,
  normalizeRoutingProfileSelections,
  profileRequirements,
  dedupeRequirements,
  hardConstraintConflict,
  resolveVenueRoutingRequirements,
};
