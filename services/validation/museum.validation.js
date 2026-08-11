const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeKey,
  normalizeBoolean,
  normalizeStringArrayStrict,
  toNumberIfPresent,
  validateUniqueStringArray,
} = require("./validation.utils");

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

function normalizeRelationTypes(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => {
    if (!isPlainObject(value)) return value;
    return {
      key: normalizeKey(value.key),
      label: trimIfString(value.label),
      description: trimIfString(value.description),
      domain: normalizeStringArrayStrict(value.domain, { lowercase: true }),
      range: normalizeStringArrayStrict(value.range, { lowercase: true }),
      category: trimIfString(value.category),
      strength: trimIfString(value.strength),
      userIntents: normalizeStringArrayStrict(value.userIntents),
      directionality: trimIfString(value.directionality),
      reverse: isPlainObject(value.reverse)
        ? {
            label: trimIfString(value.reverse.label),
            description: trimIfString(value.reverse.description),
            userIntents: normalizeStringArrayStrict(value.reverse.userIntents),
          }
        : value.reverse,
      ...(isPlainObject(value.validationRules)
        ? {
            validationRules: {
              allowMultiple: normalizeBoolean(value.validationRules.allowMultiple),
              targetRequired: normalizeBoolean(value.validationRules.targetRequired),
            },
          }
        : {}),
    };
  });
}

function normalizeMuseumPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  if (!hasOwn(payload, "config")) return normalized;
  if (!isPlainObject(payload.config)) {
    normalized.config = payload.config;
    return normalized;
  }
  normalized.config = {};
  if (hasOwn(payload.config, "languageLevels")) normalized.config.languageLevels = normalizeOrderedVocabulary(payload.config.languageLevels);
  if (hasOwn(payload.config, "durationTypes")) normalized.config.durationTypes = normalizeOrderedVocabulary(payload.config.durationTypes, true);
  if (hasOwn(payload.config, "itemTypes")) normalized.config.itemTypes = normalizeStringArrayStrict(payload.config.itemTypes, { lowercase: true });
  if (hasOwn(payload.config, "relationTypes")) normalized.config.relationTypes = normalizeRelationTypes(payload.config.relationTypes);
  return normalized;
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
    if (hasOwn(value, "level")) pushError(errors, `${path}.level`, "FORBIDDEN_FIELD", "level e derivato dall'ordine dell'array e non deve essere inviato");
    if (!value.key || typeof value.key !== "string") pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label || typeof value.label !== "string") pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
  });
}

function validateDurationTypes(values, errors) {
  validateOrderedVocabulary(values, "config.durationTypes", errors);
  if (!Array.isArray(values)) return;
  let previous = null;
  const seen = new Set();
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `config.durationTypes[${index}].targetSeconds`;
    if (!Number.isInteger(value.targetSeconds) || value.targetSeconds < 1) return pushError(errors, path, "INVALID_NUMBER", "targetSeconds deve essere un intero positivo");
    if (seen.has(value.targetSeconds)) pushError(errors, path, "DUPLICATE_TARGET_SECONDS", "targetSeconds deve essere univoco");
    if (previous !== null && value.targetSeconds <= previous) pushError(errors, path, "NON_INCREASING_TARGET_SECONDS", "targetSeconds deve crescere seguendo l'ordine dell'array");
    seen.add(value.targetSeconds);
    previous = value.targetSeconds;
  });
}

function validateRelationTypes(values, itemTypes, errors) {
  if (!Array.isArray(values)) return pushError(errors, "config.relationTypes", "INVALID_TYPE", "relationTypes deve essere un array");
  const allowedCategories = ["semantic", "contextual", "editorial"];
  const allowedDirections = ["directed", "symmetric"];
  const itemTypeSet = new Set(Array.isArray(itemTypes) ? itemTypes : []);
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `config.relationTypes[${index}]`;
    if (!isPlainObject(value)) return pushError(errors, path, "INVALID_TYPE", "Ogni relationType deve essere un oggetto");
    if (!value.key || typeof value.key !== "string") pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (value.key.includes(":")) pushError(errors, `${path}.key`, "RESERVED_KEY_FORMAT", "La key non puo contenere ':'");
    else if (seen.has(value.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    else seen.add(value.key);
    if (!value.label || typeof value.label !== "string") pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    if (!allowedCategories.includes(value.category)) pushError(errors, `${path}.category`, "INVALID_ENUM", "category non valida", { allowedValues: allowedCategories });
    if (!allowedDirections.includes(value.directionality || "directed")) pushError(errors, `${path}.directionality`, "INVALID_ENUM", "directionality non valida", { allowedValues: allowedDirections });
    for (const field of ["domain", "range"]) {
      if (!Array.isArray(value[field])) {
        pushError(errors, `${path}.${field}`, "INVALID_TYPE", `${field} deve essere un array`);
        continue;
      }
      value[field].forEach((itemType, itemIndex) => {
        if (typeof itemType !== "string" || !itemTypeSet.has(itemType)) pushError(errors, `${path}.${field}[${itemIndex}]`, "UNKNOWN_ITEM_TYPE", `itemType non presente in config.itemTypes: ${itemType}`);
      });
    }
  });
}

function validateMuseumPayload({ payload }) {
  const errors = [];
  if (!payload.name || typeof payload.name !== "string") pushError(errors, "name", "REQUIRED", "Il campo name e obbligatorio");
  if (!isPlainObject(payload.config)) {
    pushError(errors, "config", "REQUIRED", "Il campo config e obbligatorio e deve essere un oggetto");
    return errors;
  }
  validateOrderedVocabulary(payload.config.languageLevels, "config.languageLevels", errors);
  validateDurationTypes(payload.config.durationTypes, errors);
  validateUniqueStringArray(payload.config.itemTypes, "config.itemTypes", errors);
  if (Array.isArray(payload.config.itemTypes) && !payload.config.itemTypes.length) pushError(errors, "config.itemTypes", "EMPTY_ARRAY", "Almeno un itemType e obbligatorio");
  validateRelationTypes(payload.config.relationTypes || [], payload.config.itemTypes, errors);
  return errors;
}

module.exports = { normalizeMuseumPayload, validateMuseumPayload };
