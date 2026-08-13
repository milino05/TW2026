const mongoose = require("mongoose");
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

const MATCH_TYPES = ["exact", "close", "broader", "narrower"];
const ITEM_CAPABILITIES = ["visit_stop", "spatial_placement", "semantic_context"];
const RELATION_CATEGORIES = ["semantic", "contextual", "editorial"];
const RELATION_DIRECTIONS = ["directed", "symmetric"];

function normalizeSemanticRefs(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    scheme: normalizeKey(value.scheme),
    id: trimIfString(value.id),
    matchType: normalizeKey(value.matchType || "exact"),
  } : value);
}

function normalizeOrderedVocabulary(values, withDuration = false) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => {
    if (!isPlainObject(value)) return value;
    return {
      key: normalizeKey(value.key),
      label: trimIfString(value.label),
      description: trimIfString(value.description),
      ...(withDuration ? { targetSeconds: toNumberIfPresent(value.targetSeconds) } : {}),
      ...(hasOwn(value, "level") ? { level: value.level } : {}),
    };
  });
}

function normalizeItemTypes(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => {
    if (typeof value === "string") {
      return { key: normalizeKey(value), label: value.trim(), description: "", capabilities: ["semantic_context"], semanticRefs: [] };
    }
    if (!isPlainObject(value)) return value;
    return {
      key: normalizeKey(value.key),
      label: trimIfString(value.label),
      description: trimIfString(value.description),
      capabilities: normalizeStringArrayStrict(value.capabilities || ["semantic_context"], { lowercase: true }),
      semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
    };
  });
}

function normalizeRelationTypes(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => {
    if (!isPlainObject(value)) return value;
    return {
      key: normalizeKey(value.key),
      label: trimIfString(value.label),
      description: trimIfString(value.description),
      domain: normalizeStringArrayStrict(value.domain || [], { lowercase: true }),
      range: normalizeStringArrayStrict(value.range || [], { lowercase: true }),
      category: normalizeKey(value.category),
      strength: normalizeKey(value.strength || "medium"),
      userIntents: normalizeStringArrayStrict(value.userIntents || []),
      directionality: normalizeKey(value.directionality || "directed"),
      reverse: isPlainObject(value.reverse) ? {
        label: trimIfString(value.reverse.label),
        description: trimIfString(value.reverse.description),
        userIntents: normalizeStringArrayStrict(value.reverse.userIntents || []),
      } : value.reverse,
      validationRules: isPlainObject(value.validationRules) ? {
        allowMultiple: normalizeBoolean(value.validationRules.allowMultiple) !== false,
        targetRequired: normalizeBoolean(value.validationRules.targetRequired) !== false,
      } : { allowMultiple: true, targetRequired: true },
      semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
    };
  });
}

function normalizePresentationAspects(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    key: normalizeKey(value.key),
    label: trimIfString(value.label),
    description: trimIfString(value.description),
    semanticRefs: normalizeSemanticRefs(value.semanticRefs || []),
  } : value);
}

function normalizeVocabularyPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "languageLevels")) normalized.languageLevels = normalizeOrderedVocabulary(payload.languageLevels);
  if (hasOwn(payload, "durationTypes")) normalized.durationTypes = normalizeOrderedVocabulary(payload.durationTypes, true);
  if (hasOwn(payload, "itemTypes")) normalized.itemTypes = normalizeItemTypes(payload.itemTypes);
  if (hasOwn(payload, "relationTypes")) normalized.relationTypes = normalizeRelationTypes(payload.relationTypes);
  if (hasOwn(payload, "presentationAspects")) normalized.presentationAspects = normalizePresentationAspects(payload.presentationAspects);
  return normalized;
}

function validateSemanticRefs(values, field, errors) {
  if (!Array.isArray(values)) return pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "semanticRef deve essere un oggetto");
    if (!value.scheme || typeof value.scheme !== "string") pushError(errors, `${path}.scheme`, "REQUIRED", "scheme e obbligatorio");
    if (!value.id || typeof value.id !== "string") pushError(errors, `${path}.id`, "REQUIRED", "id e obbligatorio");
    if (!MATCH_TYPES.includes(value.matchType || "exact")) pushError(errors, `${path}.matchType`, "INVALID_ENUM", "matchType non valido", { allowedValues: MATCH_TYPES });
    const duplicate = `${value.scheme}::${value.id}::${value.matchType || "exact"}`;
    if (seen.has(duplicate)) pushError(errors, path, "DUPLICATE_SEMANTIC_REF", "semanticRef duplicata");
    seen.add(duplicate);
  });
}

function validateOrderedVocabulary(values, field, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  if (!values.length) pushError(errors, field, "EMPTY_ARRAY", `Almeno un valore in ${field} e obbligatorio`);
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "Ogni valore deve essere un oggetto");
    if (hasOwn(value, "level")) pushError(errors, `${path}.level`, "FORBIDDEN_FIELD", "level e derivato dall'ordine dell'array");
    if (!value.key || typeof value.key !== "string") pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label || typeof value.label !== "string") pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
  });
}

function validateDurationTypes(values, errors) {
  validateOrderedVocabulary(values, "durationTypes", errors);
  if (!Array.isArray(values)) return;
  let previous = null;
  const seen = new Set();
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `durationTypes[${index}].targetSeconds`;
    if (!Number.isInteger(value.targetSeconds) || value.targetSeconds < 1) pushError(errors, path, "INVALID_NUMBER", "targetSeconds deve essere un intero positivo");
    if (seen.has(value.targetSeconds)) pushError(errors, path, "DUPLICATE_TARGET_SECONDS", "targetSeconds deve essere univoco");
    if (previous !== null && value.targetSeconds <= previous) pushError(errors, path, "NON_INCREASING_TARGET_SECONDS", "targetSeconds deve crescere seguendo l'ordine editoriale");
    seen.add(value.targetSeconds);
    previous = value.targetSeconds;
  });
}

function validateItemTypes(values, errors) {
  if (!Array.isArray(values)) return pushError(errors, "itemTypes", "INVALID_TYPE", "itemTypes deve essere un array");
  if (!values.length) pushError(errors, "itemTypes", "EMPTY_ARRAY", "Almeno un itemType e obbligatorio");
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `itemTypes[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "Ogni itemType deve essere un oggetto");
    if (!value.key) pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label) pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    if (!Array.isArray(value.capabilities)) pushError(errors, `${path}.capabilities`, "INVALID_TYPE", "capabilities deve essere un array");
    else value.capabilities.forEach((capability, capabilityIndex) => {
      if (!ITEM_CAPABILITIES.includes(capability)) pushError(errors, `${path}.capabilities[${capabilityIndex}]`, "INVALID_ENUM", "capability non valida", { allowedValues: ITEM_CAPABILITIES });
    });
    validateSemanticRefs(value.semanticRefs || [], `${path}.semanticRefs`, errors);
  });
}

function validateRelationTypes(values, itemTypes, errors) {
  if (!Array.isArray(values)) return pushError(errors, "relationTypes", "INVALID_TYPE", "relationTypes deve essere un array");
  const itemTypeSet = new Set((itemTypes || []).map((entry) => entry.key));
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `relationTypes[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "Ogni relationType deve essere un oggetto");
    if (!value.key) pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label) pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    if (!RELATION_CATEGORIES.includes(value.category)) pushError(errors, `${path}.category`, "INVALID_ENUM", "category non valida", { allowedValues: RELATION_CATEGORIES });
    if (!RELATION_DIRECTIONS.includes(value.directionality || "directed")) pushError(errors, `${path}.directionality`, "INVALID_ENUM", "directionality non valida", { allowedValues: RELATION_DIRECTIONS });
    for (const field of ["domain", "range"]) {
      if (!Array.isArray(value[field])) { pushError(errors, `${path}.${field}`, "INVALID_TYPE", `${field} deve essere un array`); continue; }
      value[field].forEach((key, keyIndex) => { if (!itemTypeSet.has(key)) pushError(errors, `${path}.${field}[${keyIndex}]`, "UNKNOWN_ITEM_TYPE", `itemType non presente: ${key}`); });
    }
    validateSemanticRefs(value.semanticRefs || [], `${path}.semanticRefs`, errors);
  });
}

function validatePresentationAspects(values, errors) {
  if (!Array.isArray(values)) return pushError(errors, "presentationAspects", "INVALID_TYPE", "presentationAspects deve essere un array");
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `presentationAspects[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "Ogni PresentationAspect deve essere un oggetto");
    if (!value.key) pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label) pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    validateSemanticRefs(value.semanticRefs || [], `${path}.semanticRefs`, errors);
  });
}

function validateVocabularyPayload(payload) {
  const errors = [];
  validateOrderedVocabulary(payload.languageLevels, "languageLevels", errors);
  validateDurationTypes(payload.durationTypes, errors);
  validateItemTypes(payload.itemTypes, errors);
  validateRelationTypes(payload.relationTypes || [], payload.itemTypes || [], errors);
  validatePresentationAspects(payload.presentationAspects || [], errors);
  return errors;
}

function legacyConfigToVocabulary(config = {}) {
  return normalizeVocabularyPayload({
    languageLevels: config.languageLevels || [],
    durationTypes: config.durationTypes || [],
    itemTypes: (config.itemTypes || []).map((entry) => typeof entry === "string" ? { key: entry, label: entry, capabilities: ["semantic_context"] } : entry),
    relationTypes: config.relationTypes || [],
    presentationAspects: config.presentationAspects || [],
  });
}

function semanticRefKey(ref) {
  return `${String(ref?.scheme || "").toLowerCase()}::${String(ref?.id || "")}`;
}

function isObjectId(value) { return mongoose.isValidObjectId(value); }

module.exports = {
  MATCH_TYPES,
  ITEM_CAPABILITIES,
  normalizeSemanticRefs,
  normalizeVocabularyPayload,
  validateSemanticRefs,
  validateVocabularyPayload,
  legacyConfigToVocabulary,
  semanticRefKey,
  isObjectId,
};
