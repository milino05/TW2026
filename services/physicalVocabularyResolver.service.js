const AppError = require("../utils/AppError");

const FAMILY_FIELDS = Object.freeze(["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles"]);
const AVOID_UNRESOLVED_POLICIES = new Set(["warning", "blocker"]);

function id(value) { return String(value?._id || value || ""); }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function semanticSignature(reference) { return `${normalize(reference?.scheme)}::${String(reference?.id || "").trim()}`; }
function exactSemanticRefs(references = []) { return (references || []).filter((reference) => (reference?.matchType || "exact") === "exact"); }
function describePhysicalFeatureRef(reference) {
  if (reference?.kind === "local") return `definizione locale ${reference.definitionId}`;
  if (reference?.kind === "semantic") {
    return (reference.semanticRefs || []).map((entry) => `${entry.scheme}:${entry.id}${entry.matchType && entry.matchType !== "exact" ? ` (${entry.matchType})` : ""}`).join(", ") || "riferimento semantico vuoto";
  }
  return String(reference || "riferimento fisico non valido");
}

function allDefinitions(revision) {
  return FAMILY_FIELDS.flatMap((field) => (revision?.[field] || []).map((definition) => ({ family: field, definition })));
}

function resolveLocalReference({ reference, physicalVocabulary, revision }) {
  if (id(reference.physicalVocabularyId) !== id(physicalVocabulary?._id)) {
    return { status: "unresolved", reason: "physical_vocabulary_mismatch", matches: [] };
  }
  const matches = allDefinitions(revision).filter((entry) => entry.definition.definitionId === reference.definitionId);
  return {
    status: matches.length === 1 ? "resolved" : (matches.length > 1 ? "ambiguous" : "unresolved"),
    reason: matches.length > 1 ? "definition_ambiguous" : (matches.length ? null : "definition_not_found"),
    matches,
  };
}

function resolveSemanticReference({ reference, revision }) {
  // Non-exact semantic links are useful authoring/interoperability evidence, but they do not
  // prove equivalence strongly enough to drive routing automatically.
  const exactReferences = exactSemanticRefs(reference.semanticRefs || []);
  if (!exactReferences.length) return { status: "unresolved", reason: "exact_semantic_reference_required", matches: [] };
  const signatures = new Set(exactReferences.map(semanticSignature));
  const matches = allDefinitions(revision).filter((entry) => exactSemanticRefs(entry.definition.semanticRefs || []).some((semanticRef) => (
    signatures.has(semanticSignature(semanticRef))
  )));
  return {
    status: matches.length === 1 ? "resolved" : (matches.length > 1 ? "ambiguous" : "unresolved"),
    reason: matches.length > 1 ? "semantic_match_ambiguous" : (matches.length ? null : "semantic_exact_match_not_found"),
    matches,
  };
}

function resolvePhysicalFeatureRef({ reference, physicalVocabulary, revision }) {
  if (!reference || !["local", "semantic"].includes(reference.kind)) {
    return { status: "unresolved", reason: "invalid_reference", matches: [] };
  }
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

function supportedOperatorsFor(definition) {
  return ({
    boolean: new Set(["eq", "neq", "in"]),
    number: new Set(["eq", "neq", "gte", "lte", "gt", "lt", "in"]),
    string: new Set(["eq", "neq", "in"]),
    choice: new Set(["eq", "neq", "in"]),
  }[definition?.dataType] || new Set());
}

function requirementValueCompatible(definition, operator, value) {
  const values = operator === "in" ? value : [value];
  if (!Array.isArray(values) || !values.length) return false;
  const allowedChoices = new Set((definition?.options || []).map((option) => option.value));
  const compatibleValue = (entry) => {
    if (!definition || entry === undefined || entry === null) return false;
    if (definition.dataType === "boolean") return typeof entry === "boolean";
    if (definition.dataType === "number") return typeof entry === "number" && Number.isFinite(entry);
    if (definition.dataType === "string") return typeof entry === "string" && Boolean(entry.trim());
    if (definition.dataType === "choice") return typeof entry === "string" && allowedChoices.has(entry);
    return false;
  };
  return supportedOperatorsFor(definition).has(operator) && values.every(compatibleValue);
}

function requirementResolution({ requirement, attributes, physicalVocabulary, revision }) {
  if (requirement.physicalAttributeDefinitionId) {
    const definition = attributes.get(String(requirement.physicalAttributeDefinitionId)) || null;
    return definition
      ? { status: "resolved", reason: null, definition, family: "physicalAttributes" }
      : { status: "unresolved", reason: "definition_not_found", definition: null, family: null };
  }
  const reference = requirement.physicalFeatureRef || null;
  const resolution = resolvePhysicalFeatureRef({ reference, physicalVocabulary, revision });
  if (resolution.status !== "resolved") return { ...resolution, definition: null, family: null };
  const match = resolution.matches[0];
  if (match.family !== "physicalAttributes") {
    return {
      status: "unresolved",
      reason: "family_mismatch",
      definition: null,
      family: match.family,
      matches: resolution.matches,
    };
  }
  return { status: "resolved", reason: null, definition: match.definition, family: match.family, matches: resolution.matches };
}

function routingIssue({ requirement, resolution, incompatible = false }) {
  const priority = requirement.priority || "preferred";
  const physicalFeatureRef = requirement.physicalFeatureRef || null;
  const reference = physicalFeatureRef || requirement.physicalAttributeDefinitionId || null;
  let code = "PHYSICAL_FEATURE_UNRESOLVED";
  let message = `La caratteristica fisica richiesta non è disponibile nel vocabolario della sede: ${describePhysicalFeatureRef(reference)}.`;
  if (resolution?.status === "ambiguous") {
    code = "PHYSICAL_FEATURE_AMBIGUOUS";
    message = `La caratteristica fisica richiesta corrisponde a più definizioni locali e non può essere scelta automaticamente: ${describePhysicalFeatureRef(reference)}.`;
  } else if (resolution?.reason === "family_mismatch") {
    code = "PHYSICAL_FEATURE_FAMILY_MISMATCH";
    message = "Il riferimento fisico risolto non identifica una caratteristica applicabile al routing.";
  } else if (incompatible) {
    code = "PHYSICAL_REQUIREMENT_INCOMPATIBLE";
    message = "La caratteristica esiste nella sede, ma operatore o valore non sono compatibili con la sua definizione locale.";
  } else if (resolution?.reason === "exact_semantic_reference_required") {
    code = "PHYSICAL_FEATURE_EXACT_REFERENCE_REQUIRED";
    message = "Il riferimento dispone solo di mapping semantici non esatti; ArtAround non li usa come equivalenza automatica per il routing.";
  }
  return {
    code,
    message,
    priority,
    physicalFeatureRef,
    reference,
    reason: incompatible ? "incompatible_requirement" : (resolution?.reason || "unresolved"),
    ...(resolution?.family ? { actualFamily: resolution.family } : {}),
  };
}

function translateRoutingRequirements({
  requirements = [],
  physicalVocabulary,
  revision,
  unresolvedAvoidPolicy = "warning",
} = {}) {
  if (!AVOID_UNRESOLVED_POLICIES.has(unresolvedAvoidPolicy)) {
    throw new AppError("Policy avoid non valida", 500, [{ code: "INVALID_AVOID_UNRESOLVED_POLICY" }]);
  }
  const attributes = new Map((revision?.physicalAttributes || []).map((definition) => [definition.definitionId, definition]));
  const translated = [];
  const warnings = [];
  const blockers = [];

  for (const requirement of requirements || []) {
    const resolution = requirementResolution({ requirement, attributes, physicalVocabulary, revision });
    const definition = resolution.definition || null;
    const operator = requirement.operator || "eq";
    const compatible = Boolean(definition && requirementValueCompatible(definition, operator, requirement.value));
    if (!definition || !compatible) {
      const issue = routingIssue({ requirement, resolution, incompatible: Boolean(definition && !compatible) });
      const priority = requirement.priority || "preferred";
      if (priority === "required" || (priority === "avoid" && unresolvedAvoidPolicy === "blocker")) blockers.push(issue);
      else warnings.push(issue);
      continue;
    }
    translated.push({
      physicalAttributeDefinitionId: definition.definitionId,
      appliesTo: definition.appliesTo || "connection",
      operator,
      value: requirement.value,
      priority: requirement.priority || "preferred",
      weight: requirement.weight ?? 1,
    });
  }
  return {
    requirements: translated,
    warnings,
    blockers,
    // Required requirements are also exposed as refs because generation currently builds
    // its field-specific AppError context at the orchestration boundary.
    unsupportedRequired: blockers
      .filter((issue) => issue.priority === "required")
      .map((issue) => issue.reference),
  };
}

function requireSingleResolution(result, { expectedFamily = null } = {}) {
  if (result.status !== "resolved") {
    const code = result.status === "ambiguous" ? "PHYSICAL_FEATURE_AMBIGUOUS" : "PHYSICAL_FEATURE_UNRESOLVED";
    throw new AppError("Riferimento fisico non risolvibile in modo univoco", 409, [{ code, context: { reason: result.reason || null } }]);
  }
  const match = result.matches[0];
  if (expectedFamily && match.family !== expectedFamily) {
    throw new AppError("Riferimento fisico della famiglia errata", 409, [{
      code: "PHYSICAL_FEATURE_FAMILY_MISMATCH",
      context: { expectedFamily, actualFamily: match.family },
    }]);
  }
  return match;
}

module.exports = {
  FAMILY_FIELDS,
  semanticSignature,
  exactSemanticRefs,
  describePhysicalFeatureRef,
  allDefinitions,
  resolvePhysicalFeatureRef,
  findPlaceTypeDefinitionsByQuery,
  translateRoutingRequirements,
  requireSingleResolution,
};
