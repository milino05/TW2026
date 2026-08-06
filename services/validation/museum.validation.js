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

function normalizeLanguageLevels(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) =>
    isPlainObject(value)
      ? {
          key: normalizeKey(value.key),
          label: trimIfString(value.label),
          description: trimIfString(value.description),
          ...(hasOwn(value, "level") ? { level: value.level } : {}),
        }
      : value,
  );
}

function normalizeDurationTypes(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) =>
    isPlainObject(value)
      ? {
          key: normalizeKey(value.key),
          label: trimIfString(value.label),
          description: trimIfString(value.description),
          targetSeconds: toNumberIfPresent(value.targetSeconds),
          ...(hasOwn(value, "level") ? { level: value.level } : {}),
        }
      : value,
  );
}

function normalizeRelationTypes(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => {
    if (!isPlainObject(value)) return value;
    const normalized = {
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
    };
    if (isPlainObject(value.validationRules)) {
      normalized.validationRules = {
        allowMultiple: normalizeBoolean(value.validationRules.allowMultiple),
        targetRequired: normalizeBoolean(value.validationRules.targetRequired),
      };
    }
    return normalized;
  });
}

function normalizeMuseumPayload(payload = {}) {
  const normalized = {};
  if (hasOwn(payload, "name")) normalized.name = trimIfString(payload.name);
  if (hasOwn(payload, "config")) {
    if (!isPlainObject(payload.config)) {
      normalized.config = payload.config;
    } else {
      normalized.config = {};
      if (hasOwn(payload.config, "languageLevels")) {
        normalized.config.languageLevels = normalizeLanguageLevels(payload.config.languageLevels);
      }
      if (hasOwn(payload.config, "durationTypes")) {
        normalized.config.durationTypes = normalizeDurationTypes(payload.config.durationTypes);
      }
      if (hasOwn(payload.config, "itemTypes")) {
        normalized.config.itemTypes = normalizeStringArrayStrict(payload.config.itemTypes, {
          lowercase: true,
        });
      }
      if (hasOwn(payload.config, "relationTypes")) {
        normalized.config.relationTypes = normalizeRelationTypes(payload.config.relationTypes);
      }
    }
  }
  return normalized;
}

function validateBaseVocabulary(values, field, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  if (values.length === 0) {
    pushError(errors, field, "EMPTY_ARRAY", `Almeno un valore in ${field} e obbligatorio`);
    return;
  }
  const seen = new Set();
  values.forEach((value, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(value)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni valore deve essere un oggetto");
      return;
    }
    if (hasOwn(value, "level")) {
      pushError(errors, `${path}.level`, "FORBIDDEN_FIELD", "level e derivato dall'ordine dell'array e non deve essere inviato");
    }
    if (!value.key || typeof value.key !== "string") {
      pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    } else if (seen.has(value.key)) {
      pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    } else {
      seen.add(value.key);
    }
    if (!value.label || typeof value.label !== "string") {
      pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    }
  });
}

function validateDurationTypes(values, errors) {
  validateBaseVocabulary(values, "config.durationTypes", errors);
  if (!Array.isArray(values)) return;
  let previousSeconds = null;
  const seenSeconds = new Set();
  values.forEach((value, index) => {
    if (!isPlainObject(value)) return;
    const path = `config.durationTypes[${index}].targetSeconds`;
    if (!Number.isInteger(value.targetSeconds) || value.targetSeconds < 1) {
      pushError(errors, path, "INVALID_NUMBER", "targetSeconds deve essere un intero positivo");
      return;
    }
    if (seenSeconds.has(value.targetSeconds)) {
      pushError(errors, path, "DUPLICATE_TARGET_SECONDS", "targetSeconds deve essere univoco");
    }
    if (previousSeconds !== null && value.targetSeconds <= previousSeconds) {
      pushError(errors, path, "NON_INCREASING_TARGET_SECONDS", "targetSeconds deve crescere seguendo l'ordine dell'array");
    }
    seenSeconds.add(value.targetSeconds);
    previousSeconds = value.targetSeconds;
  });
}

function validateRelationTypes(values, itemTypes, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, "config.relationTypes", "INVALID_TYPE", "relationTypes deve essere un array");
    return;
  }
  const seen = new Set();
  const allowedCategories = ["semantic", "logistic", "contextual", "editorial"];
  const allowedDirections = ["directed", "symmetric"];
  const itemTypeSet = new Set(Array.isArray(itemTypes) ? itemTypes : []);
  values.forEach((value, index) => {
    const path = `config.relationTypes[${index}]`;
    if (!isPlainObject(value)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni relationType deve essere un oggetto");
      return;
    }
    if (!value.key || typeof value.key !== "string") {
      pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    } else if (value.key.includes(":")) {
      pushError(errors, `${path}.key`, "RESERVED_KEY_FORMAT", "La key non puo contenere ':'");
    } else if (seen.has(value.key)) {
      pushError(errors, `${path}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    } else {
      seen.add(value.key);
    }
    if (!value.label || typeof value.label !== "string") {
      pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    }
    if (!allowedCategories.includes(value.category)) {
      pushError(errors, `${path}.category`, "INVALID_ENUM", "category non valida", { allowedValues: allowedCategories });
    }
    const directionality = value.directionality || "directed";
    if (!allowedDirections.includes(directionality)) {
      pushError(errors, `${path}.directionality`, "INVALID_ENUM", "directionality non valida", { allowedValues: allowedDirections });
    }
    for (const field of ["domain", "range"]) {
      if (!Array.isArray(value[field])) {
        pushError(errors, `${path}.${field}`, "INVALID_TYPE", `${field} deve essere un array`);
        continue;
      }
      value[field].forEach((itemType, itemIndex) => {
        if (typeof itemType !== "string" || !itemTypeSet.has(itemType)) {
          pushError(errors, `${path}.${field}[${itemIndex}]`, "UNKNOWN_ITEM_TYPE", `itemType non presente in config.itemTypes: ${itemType}`);
        }
      });
    }
  });
}

function validateMuseumPayload({ payload }) {
  const errors = [];
  if (!payload.name || typeof payload.name !== "string") {
    pushError(errors, "name", "REQUIRED", "Il campo name e obbligatorio");
  }
  if (!isPlainObject(payload.config)) {
    pushError(errors, "config", "REQUIRED", "Il campo config e obbligatorio e deve essere un oggetto");
    return errors;
  }

  validateBaseVocabulary(payload.config.languageLevels, "config.languageLevels", errors);
  validateDurationTypes(payload.config.durationTypes, errors);
  validateUniqueStringArray(payload.config.itemTypes, "config.itemTypes", errors);
  if (Array.isArray(payload.config.itemTypes) && payload.config.itemTypes.length === 0) {
    pushError(errors, "config.itemTypes", "EMPTY_ARRAY", "Almeno un itemType e obbligatorio");
  }
  validateRelationTypes(payload.config.relationTypes || [], payload.config.itemTypes, errors);
  return errors;
}

module.exports = {
  normalizeMuseumPayload,
  validateMuseumPayload,
};
