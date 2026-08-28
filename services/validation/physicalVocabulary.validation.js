const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeKey,
  normalizeBoolean,
  normalizeStringArrayStrict,
  toNumberIfPresent,
} = require("./validation.utils");

const OWNER_TYPES = Object.freeze(["user", "organization"]);
const MATCH_TYPES = Object.freeze(["exact", "close", "broader", "narrower"]);
const DATA_TYPES = Object.freeze(["boolean", "number", "string", "choice"]);
const APPLIES_TO = Object.freeze(["place", "connection", "both"]);
const REQUIREMENT_OPERATORS = Object.freeze(["eq", "neq", "gte", "lte", "gt", "lt", "in"]);
const REQUIREMENT_PRIORITIES = Object.freeze(["required", "preferred", "avoid"]);
const DEFINITION_FIELDS = Object.freeze(["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles"]);
const REVISION_FIELDS = new Set(DEFINITION_FIELDS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function validateUuid(value) { return typeof value === "string" && UUID_PATTERN.test(value); }
function validateObjectId(value) { return Boolean(value && OBJECT_ID_PATTERN.test(String(value))); }

function validateUnknownFields(value, allowed, field, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) pushError(errors, field ? `${field}.${key}` : key, "UNKNOWN_FIELD", `Campo non supportato: ${key}`);
  }
}

function normalizeSemanticRefs(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    scheme: normalizeKey(value.scheme),
    id: trimIfString(value.id),
    matchType: normalizeKey(value.matchType || "exact"),
  } : value);
}

function normalizeLocalizations(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    locale: trimIfString(value.locale),
    label: trimIfString(value.label),
    description: trimIfString(value.description),
    aliases: normalizeStringArrayStrict(value.aliases || []),
  } : value);
}

function normalizeBaseDefinition(value) {
  if (!isPlainObject(value)) return value;
  return {
    ...(hasOwn(value, "definitionId") ? { definitionId: trimIfString(value.definitionId) } : {}),
    ...(hasOwn(value, "key") ? { key: normalizeKey(value.key) } : {}),
    label: trimIfString(value.label),
    description: trimIfString(value.description),
    localizations: normalizeLocalizations(value.localizations || []),
    semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
    metadata: hasOwn(value, "metadata")
      ? (isPlainObject(value.metadata) ? { ...value.metadata } : value.metadata)
      : {},
  };
}

function normalizePhysicalAttribute(value) {
  const base = normalizeBaseDefinition(value);
  if (!isPlainObject(base)) return base;
  return {
    ...base,
    dataType: normalizeKey(value.dataType),
    unit: trimIfString(value.unit),
    options: Array.isArray(value.options) ? value.options.map((option) => isPlainObject(option) ? {
      value: trimIfString(option.value),
      label: trimIfString(option.label),
    } : option) : (hasOwn(value, "options") ? value.options : []),
    appliesTo: normalizeKey(value.appliesTo),
  };
}

function normalizeRoutingProfile(value) {
  const base = normalizeBaseDefinition(value);
  if (!isPlainObject(base)) return base;
  return {
    ...base,
    requirements: Array.isArray(value.requirements) ? value.requirements.map((requirement) => isPlainObject(requirement) ? {
      physicalAttributeDefinitionId: trimIfString(requirement.physicalAttributeDefinitionId),
      operator: normalizeKey(requirement.operator || "eq"),
      value: requirement.value,
      priority: normalizeKey(requirement.priority || "preferred"),
      weight: hasOwn(requirement, "weight") ? toNumberIfPresent(requirement.weight) : 1,
    } : requirement) : (hasOwn(value, "requirements") ? value.requirements : []),
  };
}

function normalizePhysicalVocabularyRevisionPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "placeTypes")) normalized.placeTypes = Array.isArray(payload.placeTypes)
    ? payload.placeTypes.map(normalizeBaseDefinition)
    : payload.placeTypes;
  if (hasOwn(payload, "connectionTypes")) normalized.connectionTypes = Array.isArray(payload.connectionTypes)
    ? payload.connectionTypes.map(normalizeBaseDefinition)
    : payload.connectionTypes;
  if (hasOwn(payload, "physicalAttributes")) normalized.physicalAttributes = Array.isArray(payload.physicalAttributes)
    ? payload.physicalAttributes.map(normalizePhysicalAttribute)
    : payload.physicalAttributes;
  if (hasOwn(payload, "routingProfiles")) normalized.routingProfiles = Array.isArray(payload.routingProfiles)
    ? payload.routingProfiles.map(normalizeRoutingProfile)
    : payload.routingProfiles;
  return normalized;
}

function validateSemanticRefs(values, field, errors, { required = false } = {}) {
  if (!Array.isArray(values)) return pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
  if (required && !values.length) pushError(errors, field, "EMPTY_ARRAY", "Almeno una semanticRef e obbligatoria");
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "semanticRef deve essere un oggetto");
    validateUnknownFields(value, new Set(["scheme", "id", "matchType"]), path, errors);
    if (!value.scheme || typeof value.scheme !== "string") pushError(errors, `${path}.scheme`, "REQUIRED", "scheme e obbligatorio");
    if (!value.id || typeof value.id !== "string") pushError(errors, `${path}.id`, "REQUIRED", "id e obbligatorio");
    if (!MATCH_TYPES.includes(value.matchType || "exact")) pushError(errors, `${path}.matchType`, "INVALID_ENUM", "matchType non valido", { allowedValues: MATCH_TYPES });
    const signature = `${String(value.scheme || "").toLowerCase()}::${value.id}::${value.matchType || "exact"}`;
    if (seen.has(signature)) pushError(errors, path, "DUPLICATE_SEMANTIC_REF", "semanticRef duplicata");
    seen.add(signature);
  });
}

function validateLocalizations(values, field, errors) {
  if (!Array.isArray(values)) return pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
  const locales = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "La localizzazione deve essere un oggetto");
    validateUnknownFields(value, new Set(["locale", "label", "description", "aliases"]), path, errors);
    if (!value.locale || typeof value.locale !== "string") pushError(errors, `${path}.locale`, "REQUIRED", "locale e obbligatorio");
    else {
      try { new Intl.Locale(value.locale); }
      catch { pushError(errors, `${path}.locale`, "INVALID_LOCALE", "locale non valido"); }
    }
    const localeKey = String(value.locale || "").toLowerCase();
    if (locales.has(localeKey)) pushError(errors, `${path}.locale`, "DUPLICATE_LOCALE", `Localizzazione duplicata: ${value.locale}`);
    locales.add(localeKey);
    if (value.label !== null && value.label !== undefined && typeof value.label !== "string") pushError(errors, `${path}.label`, "INVALID_TYPE", "label deve essere una stringa o null");
    if (value.description !== null && value.description !== undefined && typeof value.description !== "string") pushError(errors, `${path}.description`, "INVALID_TYPE", "description deve essere una stringa o null");
    if (!Array.isArray(value.aliases)) pushError(errors, `${path}.aliases`, "INVALID_TYPE", "aliases deve essere un array");
    else {
      const aliases = new Set();
      value.aliases.forEach((alias, aliasIndex) => {
        const aliasPath = `${path}.aliases[${aliasIndex}]`;
        if (!alias || typeof alias !== "string") return pushError(errors, aliasPath, "INVALID_VALUE", "L'alias deve essere una stringa non vuota");
        const aliasKey = alias.trim().toLowerCase();
        if (aliases.has(aliasKey)) pushError(errors, aliasPath, "DUPLICATE_ALIAS", `Alias duplicato: ${alias}`);
        aliases.add(aliasKey);
      });
    }
  });
}

function validateDefinitionBase(value, path, errors, extraAllowed = []) {
  if (!isPlainObject(value)) {
    pushError(errors, path, "INVALID_TYPE", "La definizione deve essere un oggetto");
    return false;
  }
  validateUnknownFields(value, new Set(["definitionId", "key", "label", "description", "localizations", "semanticRefs", "metadata", ...extraAllowed]), path, errors);
  if (!validateUuid(value.definitionId)) pushError(errors, `${path}.definitionId`, "INVALID_UUID", "definitionId deve essere un UUID valido");
  if (value.key !== undefined && value.key !== null && (typeof value.key !== "string" || !KEY_PATTERN.test(value.key))) {
    pushError(errors, `${path}.key`, "INVALID_KEY", "key deve usare lettere minuscole, numeri e underscore");
  }
  if (!value.label || typeof value.label !== "string") pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
  if (value.description !== null && value.description !== undefined && typeof value.description !== "string") pushError(errors, `${path}.description`, "INVALID_TYPE", "description deve essere una stringa o null");
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) pushError(errors, `${path}.metadata`, "INVALID_TYPE", "metadata deve essere un oggetto");
  validateLocalizations(value.localizations || [], `${path}.localizations`, errors);
  validateSemanticRefs(value.semanticRefs || [], `${path}.semanticRefs`, errors);
  return true;
}

function validateDefinitionCollection(values, field, errors, extraAllowed = []) {
  if (!Array.isArray(values)) return pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
  const keys = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!validateDefinitionBase(value, path, errors, extraAllowed)) return;
    if (value.key) {
      if (keys.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
      keys.add(value.key);
    }
  });
}

function validatePhysicalAttributes(values, errors) {
  validateDefinitionCollection(values, "physicalAttributes", errors, ["dataType", "unit", "options", "appliesTo"]);
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `physicalAttributes[${index}]`;
    if (!DATA_TYPES.includes(value.dataType)) pushError(errors, `${path}.dataType`, "INVALID_ENUM", "dataType non valido", { allowedValues: DATA_TYPES });
    if (!APPLIES_TO.includes(value.appliesTo)) pushError(errors, `${path}.appliesTo`, "INVALID_ENUM", "appliesTo non valido", { allowedValues: APPLIES_TO });
    if (value.unit !== null && value.unit !== undefined && typeof value.unit !== "string") pushError(errors, `${path}.unit`, "INVALID_TYPE", "unit deve essere una stringa o null");
    if (value.dataType !== "number" && value.unit) pushError(errors, `${path}.unit`, "INCOMPATIBLE_UNIT", "unit e ammessa solo per attributi number");
    if (!Array.isArray(value.options)) {
      pushError(errors, `${path}.options`, "INVALID_TYPE", "options deve essere un array");
      return;
    }
    if (value.dataType === "choice" && !value.options.length) pushError(errors, `${path}.options`, "EMPTY_ARRAY", "Un attributo choice richiede almeno un'opzione");
    if (value.dataType !== "choice" && value.options.length) pushError(errors, `${path}.options`, "INCOMPATIBLE_OPTIONS", "options e ammesso solo per attributi choice");
    const optionValues = new Set();
    value.options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      if (!isPlainObject(option)) return pushError(errors, optionPath, "INVALID_TYPE", "L'opzione deve essere un oggetto");
      validateUnknownFields(option, new Set(["value", "label"]), optionPath, errors);
      if (!option.value || typeof option.value !== "string") pushError(errors, `${optionPath}.value`, "REQUIRED", "value e obbligatorio");
      if (!option.label || typeof option.label !== "string") pushError(errors, `${optionPath}.label`, "REQUIRED", "label e obbligatoria");
      if (optionValues.has(option.value)) pushError(errors, `${optionPath}.value`, "DUPLICATE_VALUE", `Opzione duplicata: ${option.value}`);
      optionValues.add(option.value);
    });
  });
}

function valueMatchesAttribute(value, attribute, operator) {
  const multiple = operator === "in";
  const values = multiple ? value : [value];
  if (multiple && !Array.isArray(value)) return false;
  if (attribute.dataType === "boolean") return !multiple && typeof value === "boolean" && ["eq", "neq"].includes(operator);
  if (attribute.dataType === "number") return values.every((entry) => typeof entry === "number" && Number.isFinite(entry));
  if (attribute.dataType === "string") return ["eq", "neq", "in"].includes(operator) && values.every((entry) => typeof entry === "string");
  if (attribute.dataType === "choice") {
    const options = new Set((attribute.options || []).map((option) => option.value));
    return ["eq", "neq", "in"].includes(operator) && values.every((entry) => typeof entry === "string" && options.has(entry));
  }
  return false;
}

function validateRoutingProfiles(values, physicalAttributes, errors) {
  validateDefinitionCollection(values, "routingProfiles", errors, ["requirements"]);
  if (!Array.isArray(values)) return;
  const attributes = new Map((physicalAttributes || []).filter(isPlainObject).map((entry) => [entry.definitionId, entry]));
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `routingProfiles[${index}]`;
    if (!Array.isArray(value.requirements)) return pushError(errors, `${path}.requirements`, "INVALID_TYPE", "requirements deve essere un array");
    const signatures = new Set();
    value.requirements.forEach((requirement, requirementIndex) => {
      const requirementPath = `${path}.requirements[${requirementIndex}]`;
      if (!isPlainObject(requirement)) return pushError(errors, requirementPath, "INVALID_TYPE", "Il requirement deve essere un oggetto");
      validateUnknownFields(requirement, new Set(["physicalAttributeDefinitionId", "operator", "value", "priority", "weight"]), requirementPath, errors);
      if (!validateUuid(requirement.physicalAttributeDefinitionId)) pushError(errors, `${requirementPath}.physicalAttributeDefinitionId`, "INVALID_UUID", "Il riferimento deve essere un UUID valido");
      const attribute = attributes.get(requirement.physicalAttributeDefinitionId);
      if (!attribute) pushError(errors, `${requirementPath}.physicalAttributeDefinitionId`, "UNKNOWN_PHYSICAL_ATTRIBUTE", "PhysicalAttributeDefinition non presente");
      if (!REQUIREMENT_OPERATORS.includes(requirement.operator)) pushError(errors, `${requirementPath}.operator`, "INVALID_ENUM", "operator non valido", { allowedValues: REQUIREMENT_OPERATORS });
      if (!REQUIREMENT_PRIORITIES.includes(requirement.priority)) pushError(errors, `${requirementPath}.priority`, "INVALID_ENUM", "priority non valida", { allowedValues: REQUIREMENT_PRIORITIES });
      if (typeof requirement.weight !== "number" || !Number.isFinite(requirement.weight) || requirement.weight < 0) pushError(errors, `${requirementPath}.weight`, "INVALID_NUMBER", "weight deve essere un numero >= 0");
      if (attribute && !valueMatchesAttribute(requirement.value, attribute, requirement.operator)) pushError(errors, `${requirementPath}.value`, "INCOMPATIBLE_VALUE", "value non e compatibile con datatype, opzioni o operator");
      const signature = `${requirement.physicalAttributeDefinitionId}::${requirement.operator}::${JSON.stringify(requirement.value)}::${requirement.priority}`;
      if (signatures.has(signature)) pushError(errors, requirementPath, "DUPLICATE_REQUIREMENT", "Requirement duplicato");
      signatures.add(signature);
    });
  });
}

function validateDefinitionIdsAreUnique(snapshot, errors) {
  const seen = new Map();
  for (const field of DEFINITION_FIELDS) {
    for (let index = 0; index < (snapshot[field] || []).length; index += 1) {
      const definition = snapshot[field][index];
      if (!isPlainObject(definition) || !definition.definitionId) continue;
      const previous = seen.get(definition.definitionId);
      if (previous) pushError(errors, `${field}[${index}].definitionId`, "DUPLICATE_DEFINITION_ID", `definitionId gia usato in ${previous}`);
      else seen.set(definition.definitionId, `${field}[${index}]`);
    }
  }
}

function validatePhysicalVocabularyRevisionUnknownFields(payload = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    pushError(errors, "revision", "INVALID_TYPE", "La revisione Physical Vocabulary deve essere un oggetto");
    return errors;
  }
  validateUnknownFields(payload, REVISION_FIELDS, "", errors);
  const base = ["definitionId", "key", "label", "description", "localizations", "semanticRefs", "metadata"];
  const allowedByField = {
    placeTypes: new Set(base),
    connectionTypes: new Set(base),
    physicalAttributes: new Set([...base, "dataType", "unit", "options", "appliesTo"]),
    routingProfiles: new Set([...base, "requirements"]),
  };
  for (const field of DEFINITION_FIELDS) {
    if (!Array.isArray(payload[field])) continue;
    payload[field].forEach((definition, index) => {
      if (!isPlainObject(definition)) return;
      const path = `${field}[${index}]`;
      validateUnknownFields(definition, allowedByField[field], path, errors);
      if (Array.isArray(definition.localizations)) definition.localizations.forEach((localization, localizationIndex) => validateUnknownFields(localization, new Set(["locale", "label", "description", "aliases"]), `${path}.localizations[${localizationIndex}]`, errors));
      if (Array.isArray(definition.semanticRefs)) definition.semanticRefs.forEach((semanticRef, semanticIndex) => validateUnknownFields(semanticRef, new Set(["scheme", "id", "matchType"]), `${path}.semanticRefs[${semanticIndex}]`, errors));
      if (field === "physicalAttributes" && Array.isArray(definition.options)) definition.options.forEach((option, optionIndex) => validateUnknownFields(option, new Set(["value", "label"]), `${path}.options[${optionIndex}]`, errors));
      if (field === "routingProfiles" && Array.isArray(definition.requirements)) definition.requirements.forEach((requirement, requirementIndex) => validateUnknownFields(requirement, new Set(["physicalAttributeDefinitionId", "operator", "value", "priority", "weight"]), `${path}.requirements[${requirementIndex}]`, errors));
    });
  }
  return errors;
}

function validatePhysicalVocabularyRevisionSnapshot(snapshot = {}) {
  const errors = [];
  validateDefinitionCollection(snapshot.placeTypes || [], "placeTypes", errors);
  validateDefinitionCollection(snapshot.connectionTypes || [], "connectionTypes", errors);
  validatePhysicalAttributes(snapshot.physicalAttributes || [], errors);
  validateRoutingProfiles(snapshot.routingProfiles || [], snapshot.physicalAttributes || [], errors);
  validateDefinitionIdsAreUnique(snapshot, errors);
  return errors;
}

function normalizePhysicalVocabularyMetadataPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  if (hasOwn(payload, "description")) normalized.description = trimIfString(payload.description);
  if (hasOwn(payload, "ownerType")) normalized.ownerType = normalizeKey(payload.ownerType);
  if (hasOwn(payload, "ownerId")) normalized.ownerId = payload.ownerId;
  if (hasOwn(payload, "applyStarter")) normalized.applyStarter = normalizeBoolean(payload.applyStarter);
  return normalized;
}

function validatePhysicalVocabularyMetadataPayload(payload = {}, { creating = false } = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    pushError(errors, "physicalVocabulary", "INVALID_TYPE", "Physical Vocabulary deve essere un oggetto");
    return errors;
  }
  const allowed = creating ? new Set(["name", "description", "ownerType", "ownerId", "revision", "applyStarter"]) : new Set(["name", "description"]);
  validateUnknownFields(payload, allowed, "", errors);
  if (creating || hasOwn(payload, "name")) {
    if (!payload.name || typeof payload.name !== "string" || !payload.name.trim()) pushError(errors, "name", "REQUIRED", "name e obbligatorio");
  }
  if (hasOwn(payload, "description") && payload.description !== null && typeof payload.description !== "string") pushError(errors, "description", "INVALID_TYPE", "description deve essere una stringa o null");
  if (creating) {
    if (!OWNER_TYPES.includes(payload.ownerType)) pushError(errors, "ownerType", "INVALID_ENUM", "ownerType non valido", { allowedValues: OWNER_TYPES });
    if (!validateObjectId(payload.ownerId)) pushError(errors, "ownerId", "INVALID_OBJECT_ID", "ownerId non e un ObjectId valido");
    if (hasOwn(payload, "applyStarter") && typeof normalizeBoolean(payload.applyStarter) !== "boolean") pushError(errors, "applyStarter", "INVALID_TYPE", "applyStarter deve essere boolean");
  }
  return errors;
}

function normalizePhysicalFeatureRef(value = {}) {
  if (!isPlainObject(value)) return value;
  return {
    kind: normalizeKey(value.kind),
    ...(hasOwn(value, "physicalVocabularyId") ? { physicalVocabularyId: value.physicalVocabularyId } : {}),
    ...(hasOwn(value, "definitionId") ? { definitionId: trimIfString(value.definitionId) } : {}),
    semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
  };
}

function validatePhysicalFeatureRef(value, field = "physicalFeatureRef") {
  const errors = [];
  if (!isPlainObject(value)) {
    pushError(errors, field, "INVALID_TYPE", "PhysicalFeatureRef deve essere un oggetto");
    return errors;
  }
  validateUnknownFields(value, new Set(["kind", "physicalVocabularyId", "definitionId", "semanticRefs"]), field, errors);
  if (value.kind === "local") {
    if (!validateObjectId(value.physicalVocabularyId)) pushError(errors, `${field}.physicalVocabularyId`, "INVALID_OBJECT_ID", "physicalVocabularyId locale non valido");
    if (!validateUuid(value.definitionId)) pushError(errors, `${field}.definitionId`, "INVALID_UUID", "definitionId locale non valido");
    if ((value.semanticRefs || []).length) pushError(errors, `${field}.semanticRefs`, "FORBIDDEN_FIELD", "Un riferimento locale non contiene semanticRefs");
  } else if (value.kind === "semantic") {
    if (value.physicalVocabularyId) pushError(errors, `${field}.physicalVocabularyId`, "FORBIDDEN_FIELD", "Un riferimento semantico non pinna un PhysicalVocabulary");
    if (value.definitionId) pushError(errors, `${field}.definitionId`, "FORBIDDEN_FIELD", "Un riferimento semantico non contiene definitionId locale");
    validateSemanticRefs(value.semanticRefs || [], `${field}.semanticRefs`, errors, { required: true });
  } else pushError(errors, `${field}.kind`, "INVALID_ENUM", "kind deve essere local o semantic");
  return errors;
}

module.exports = {
  OWNER_TYPES,
  MATCH_TYPES,
  DATA_TYPES,
  APPLIES_TO,
  REQUIREMENT_OPERATORS,
  REQUIREMENT_PRIORITIES,
  DEFINITION_FIELDS,
  normalizePhysicalVocabularyMetadataPayload,
  validatePhysicalVocabularyMetadataPayload,
  normalizePhysicalVocabularyRevisionPayload,
  validatePhysicalVocabularyRevisionUnknownFields,
  validatePhysicalVocabularyRevisionSnapshot,
  normalizePhysicalFeatureRef,
  validatePhysicalFeatureRef,
};
