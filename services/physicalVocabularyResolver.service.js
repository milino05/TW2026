const AppError = require("../utils/AppError");

const FAMILY_FIELDS = Object.freeze(["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles"]);

function id(value) { return String(value?._id || value || ""); }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function semanticSignature(reference) { return `${normalize(reference?.scheme)}::${String(reference?.id || "").trim()}`; }
function describePhysicalFeatureRef(reference) {
  if (reference?.kind === "local") return `definizione locale ${reference.definitionId}`;
  if (reference?.kind === "semantic") {
    return (reference.semanticRefs || []).map((entry) => `${entry.scheme}:${entry.id}`).join(", ") || "riferimento semantico vuoto";
  }
  return String(reference || "riferimento fisico non valido");
}

function allDefinitions(revision) {
  return FAMILY_FIELDS.flatMap((field) => (revision?.[field] || []).map((definition) => ({ family: field, definition })));
}

function resolveLocalReference({ reference, physicalVocabulary, revision }) {
  if (id(reference.physicalVocabularyId) !== id(physicalVocabulary?._id)) return { status: "unresolved", reason: "physical_vocabulary_mismatch", matches: [] };
  const matches = allDefinitions(revision).filter((entry) => entry.definition.definitionId === reference.definitionId);
  return { status: matches.length === 1 ? "resolved" : (matches.length > 1 ? "ambiguous" : "unresolved"), reason: matches.length ? null : "definition_not_found", matches };
}

function resolveSemanticReference({ reference, revision }) {
  const signatures = new Set((reference.semanticRefs || []).map(semanticSignature));
  const matches = signatures.size ? allDefinitions(revision).filter((entry) => (entry.definition.semanticRefs || []).some((semanticRef) => (
    signatures.has(semanticSignature(semanticRef))
  ))) : [];
  return { status: matches.length === 1 ? "resolved" : (matches.length > 1 ? "ambiguous" : "unresolved"), reason: matches.length ? null : "semantic_match_not_found", matches };
}

function resolvePhysicalFeatureRef({ reference, physicalVocabulary, revision }) {
  if (!reference || !["local", "semantic"].includes(reference.kind)) return { status: "unresolved", reason: "invalid_reference", matches: [] };
  return reference.kind === "local"
    ? resolveLocalReference({ reference, physicalVocabulary, revision })
    : resolveSemanticReference({ reference, revision });
}

function definitionSearchTerms(definition) {
  return new Set([
    definition?.label,
    ...(definition?.localizations || []).flatMap((localization) => [localization.label, ...(localization.aliases || [])]),
  ].map(normalize).filter(Boolean));
}

function findPlaceTypeDefinitionsByQuery(revision, query) {
  const needle = normalize(query);
  if (!needle) return [];
  return (revision?.placeTypes || []).filter((definition) => definitionSearchTerms(definition).has(needle));
}

function translateRoutingRequirements({ requirements = [], physicalVocabulary, revision }) {
  const attributes = new Map((revision?.physicalAttributes || []).map((definition) => [definition.definitionId, definition]));
  const translated = [];
  const warnings = [];
  const unsupportedRequired = [];
  for (const requirement of requirements || []) {
    let definition = requirement.physicalAttributeDefinitionId
      ? attributes.get(String(requirement.physicalAttributeDefinitionId))
      : null;
    if (!definition && requirement.physicalFeatureRef) {
      const resolution = resolvePhysicalFeatureRef({ reference: requirement.physicalFeatureRef, physicalVocabulary, revision });
      if (resolution.status === "resolved" && resolution.matches[0].family === "physicalAttributes") definition = resolution.matches[0].definition;
    }
    const operator = requirement.operator || "eq";
    const supportedOperators = definition ? ({
      boolean: new Set(["eq", "neq", "in"]),
      number: new Set(["eq", "neq", "gte", "lte", "gt", "lt", "in"]),
      string: new Set(["eq", "neq", "in"]),
      choice: new Set(["eq", "neq", "in"]),
    }[definition.dataType] || new Set()) : new Set();
    const values = operator === "in" ? requirement.value : [requirement.value];
    const allowedChoices = new Set((definition?.options || []).map((option) => option.value));
    const compatibleValue = (value) => {
      if (!definition || value === undefined || value === null) return false;
      if (definition.dataType === "boolean") return typeof value === "boolean";
      if (definition.dataType === "number") return typeof value === "number" && Number.isFinite(value);
      if (definition.dataType === "string") return typeof value === "string" && Boolean(value.trim());
      if (definition.dataType === "choice") return typeof value === "string" && allowedChoices.has(value);
      return false;
    };
    const compatible = definition && supportedOperators.has(operator)
      && Array.isArray(values) && values.length > 0 && values.every(compatibleValue);
    if (!definition || !compatible) {
      const reference = requirement.physicalFeatureRef || requirement.physicalAttributeDefinitionId || null;
      if ((requirement.priority || "preferred") === "required") unsupportedRequired.push(reference);
      else warnings.push({
        code: definition ? "PHYSICAL_REQUIREMENT_INCOMPATIBLE" : "PREFERRED_ATTRIBUTE_UNSUPPORTED",
        physicalFeatureRef: reference,
      });
      continue;
    }
    translated.push({
      physicalAttributeDefinitionId: definition.definitionId,
      operator,
      value: requirement.value,
      priority: requirement.priority || "preferred",
      weight: requirement.weight ?? 1,
    });
  }
  return { requirements: translated, warnings, unsupportedRequired };
}

function requireSingleResolution(result, { expectedFamily = null } = {}) {
  if (result.status !== "resolved") throw new AppError("Riferimento fisico non risolvibile in modo univoco", 409, [{ code: result.status === "ambiguous" ? "PHYSICAL_FEATURE_AMBIGUOUS" : "PHYSICAL_FEATURE_UNRESOLVED" }]);
  const match = result.matches[0];
  if (expectedFamily && match.family !== expectedFamily) throw new AppError("Riferimento fisico della famiglia errata", 409, [{ code: "PHYSICAL_FEATURE_FAMILY_MISMATCH", context: { expectedFamily, actualFamily: match.family } }]);
  return match;
}

module.exports = {
  FAMILY_FIELDS,
  semanticSignature,
  describePhysicalFeatureRef,
  allDefinitions,
  resolvePhysicalFeatureRef,
  findPlaceTypeDefinitionsByQuery,
  translateRoutingRequirements,
  requireSingleResolution,
};
