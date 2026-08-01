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

function normalizeOrderedVocabulary(values) {
  if (!Array.isArray(values)) {
    return values;
  }

  return values.map((value) => {
    if (!isPlainObject(value)) {
      return value;
    }

    return {
      key: normalizeKey(value.key),
      label: trimIfString(value.label),
      level: toNumberIfPresent(value.level),
      description: trimIfString(value.description),
    };
  });
}

function normalizeDurationTypes(durationTypes) {
  return normalizeOrderedVocabulary(durationTypes);
}

function normalizeLanguageLevels(languageLevels) {
  return normalizeOrderedVocabulary(languageLevels);
}

function normalizeRelationTypes(relationTypes) {
  if (!Array.isArray(relationTypes)) {
    return relationTypes;
  }

  return relationTypes.map((relationType) => {
    if (!isPlainObject(relationType)) {
      return relationType;
    }

    const normalized = {
      key: normalizeKey(relationType.key),
      label: trimIfString(relationType.label),
      description: trimIfString(relationType.description),
      domain: normalizeStringArrayStrict(relationType.domain, { allowNumbers: false }),
      range: normalizeStringArrayStrict(relationType.range, { allowNumbers: false }),
      category: trimIfString(relationType.category),
      strength: trimIfString(relationType.strength),
      userIntents: normalizeStringArrayStrict(relationType.userIntents, { allowNumbers: false }),
      directionality: trimIfString(relationType.directionality),
      reverse: isPlainObject(relationType.reverse)
        ? {
            label: trimIfString(relationType.reverse.label),
            description: trimIfString(relationType.reverse.description),
            userIntents: normalizeStringArrayStrict(relationType.reverse.userIntents, { allowNumbers: false }),
          }
        : relationType.reverse,
    };

    if (isPlainObject(relationType.validationRules)) {
      normalized.validationRules = {};
      if (hasOwn(relationType.validationRules, "allowMultiple")) {
        normalized.validationRules.allowMultiple = normalizeBoolean(relationType.validationRules.allowMultiple);
      }
      if (hasOwn(relationType.validationRules, "targetRequired")) {
        normalized.validationRules.targetRequired = normalizeBoolean(relationType.validationRules.targetRequired);
      }
    } else if (hasOwn(relationType, "validationRules")) {
      normalized.validationRules = relationType.validationRules;
    }

    return normalized;
  });
}

function normalizeMuseumPayload(payload = {}) {
  const normalized = {};

  if (hasOwn(payload, "name")) {
    normalized.name = trimIfString(payload.name);
  }

  if (hasOwn(payload, "config")) {
    if (!isPlainObject(payload.config)) {
      normalized.config = payload.config;
    } else {
      normalized.config = {};

      if (hasOwn(payload.config, "languageLevels")) {
        normalized.config.languageLevels = normalizeLanguageLevels(payload.config.languageLevels);
      }
      if (hasOwn(payload.config, "itemTypes")) {
        normalized.config.itemTypes = normalizeStringArrayStrict(payload.config.itemTypes, { allowNumbers: false });
      }
      if (hasOwn(payload.config, "durationTypes")) {
        normalized.config.durationTypes = normalizeDurationTypes(payload.config.durationTypes);
      }
      if (hasOwn(payload.config, "relationTypes")) {
        normalized.config.relationTypes = normalizeRelationTypes(payload.config.relationTypes);
      }
    }
  }

  return normalized;
}

function validateOrderedVocabulary(values, field, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }

  if (values.length === 0) {
    pushError(errors, field, "EMPTY_ARRAY", `Almeno un valore in ${field} e obbligatorio`);
    return;
  }

  const seenKeys = new Set();
  const seenLevels = new Set();

  values.forEach((value, index) => {
    const basePath = `${field}[${index}]`;

    if (!isPlainObject(value)) {
      pushError(errors, basePath, "INVALID_TYPE", `Ogni valore di ${field} deve essere un oggetto`);
      return;
    }

    if (!value.key || typeof value.key !== "string") {
      pushError(errors, `${basePath}.key`, "REQUIRED", "key e obbligatoria");
    } else if (seenKeys.has(value.key)) {
      pushError(errors, `${basePath}.key`, "DUPLICATE_KEY", `key duplicata: ${value.key}`);
    } else {
      seenKeys.add(value.key);
    }

    if (!value.label || typeof value.label !== "string") {
      pushError(errors, `${basePath}.label`, "REQUIRED", "label e obbligatoria");
    }

    if (!Number.isFinite(value.level) || value.level < 1) {
      pushError(errors, `${basePath}.level`, "INVALID_NUMBER", "level deve essere un numero maggiore o uguale a 1");
    } else if (seenLevels.has(value.level)) {
      pushError(errors, `${basePath}.level`, "DUPLICATE_LEVEL", `level duplicato: ${value.level}`);
    } else {
      seenLevels.add(value.level);
    }
  });
}

function validateStringArrayValues(values, field, errors) {
  if (values === undefined) return;
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  values.forEach((value, index) => {
    if (!value || typeof value !== "string") {
      pushError(errors, `${field}[${index}]`, "INVALID_VALUE", `${field}[${index}] deve essere una stringa non vuota`);
    }
  });
}

function validateRelationTypes(relationTypes, itemTypes, errors) {
  if (!Array.isArray(relationTypes)) {
    pushError(errors, "config.relationTypes", "INVALID_TYPE", "relationTypes deve essere un array");
    return;
  }

  const allowedCategories = ["semantic", "logistic", "contextual", "editorial"];
  const allowedStrengths = ["strong", "medium", "weak"];
  const allowedDirectionalities = ["directed", "symmetric"];
  const itemTypeSet = new Set(Array.isArray(itemTypes) ? itemTypes : []);
  const relationTypeKeys = new Set();

  relationTypes.forEach((relationType, index) => {
    const basePath = `config.relationTypes[${index}]`;
    if (!isPlainObject(relationType)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni relationType deve essere un oggetto");
      return;
    }

    if (!relationType.key || typeof relationType.key !== "string") {
      pushError(errors, `${basePath}.key`, "REQUIRED", "key e obbligatoria");
    } else if (relationTypeKeys.has(relationType.key)) {
      pushError(errors, `${basePath}.key`, "DUPLICATE_KEY", `relationType key duplicata: ${relationType.key}`);
    } else {
      relationTypeKeys.add(relationType.key);
    }

    if (!relationType.label || typeof relationType.label !== "string") {
      pushError(errors, `${basePath}.label`, "REQUIRED", "label e obbligatoria");
    }
    if (!allowedCategories.includes(relationType.category)) {
      pushError(errors, `${basePath}.category`, "INVALID_ENUM", `category non valida: ${relationType.category}`, { allowedValues: allowedCategories });
    }

    const directionality = relationType.directionality || "directed";
    if (!allowedDirectionalities.includes(directionality)) {
      pushError(errors, `${basePath}.directionality`, "INVALID_ENUM", `directionality non valida: ${relationType.directionality}`, { allowedValues: allowedDirectionalities });
    }
    if (directionality === "symmetric" && relationType.reverse !== undefined) {
      pushError(errors, `${basePath}.reverse`, "REVERSE_NOT_ALLOWED_FOR_SYMMETRIC_RELATION", "reverse non deve essere definito per relationTypes simmetriche");
    }
    if (typeof relationType.key === "string" && relationType.key.includes(":")) {
      pushError(errors, `${basePath}.key`, "RESERVED_KEY_FORMAT", "La key della relationType non puo contenere ':'");
    }
    if (relationType.strength !== undefined && !allowedStrengths.includes(relationType.strength)) {
      pushError(errors, `${basePath}.strength`, "INVALID_ENUM", `strength non valida: ${relationType.strength}`, { allowedValues: allowedStrengths });
    }

    validateStringArrayValues(relationType.domain, `${basePath}.domain`, errors);
    validateStringArrayValues(relationType.range, `${basePath}.range`, errors);
    validateStringArrayValues(relationType.userIntents, `${basePath}.userIntents`, errors);

    if (relationType.reverse !== undefined) {
      if (!isPlainObject(relationType.reverse)) {
        pushError(errors, `${basePath}.reverse`, "INVALID_TYPE", "reverse deve essere un oggetto");
      } else {
        validateStringArrayValues(relationType.reverse.userIntents, `${basePath}.reverse.userIntents`, errors);
      }
    }

    ["domain", "range"].forEach((field) => {
      if (!Array.isArray(relationType[field])) return;
      relationType[field].forEach((itemType, itemTypeIndex) => {
        if (typeof itemType === "string" && itemType && !itemTypeSet.has(itemType)) {
          pushError(errors, `${basePath}.${field}[${itemTypeIndex}]`, "UNKNOWN_ITEM_TYPE", `itemType non presente in config.itemTypes: ${itemType}`);
        }
      });
    });

    if (relationType.validationRules !== undefined) {
      if (!isPlainObject(relationType.validationRules)) {
        pushError(errors, `${basePath}.validationRules`, "INVALID_TYPE", "validationRules deve essere un oggetto");
      } else {
        ["allowMultiple", "targetRequired"].forEach((field) => {
          if (relationType.validationRules[field] !== undefined && typeof relationType.validationRules[field] !== "boolean") {
            pushError(errors, `${basePath}.validationRules.${field}`, "INVALID_TYPE", `${field} deve essere booleano`);
          }
        });
      }
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

  validateOrderedVocabulary(payload.config.languageLevels, "config.languageLevels", errors);
  validateOrderedVocabulary(payload.config.durationTypes, "config.durationTypes", errors);
  validateUniqueStringArray(payload.config.itemTypes, "config.itemTypes", errors);

  if (Array.isArray(payload.config.itemTypes) && payload.config.itemTypes.length === 0) {
    pushError(errors, "config.itemTypes", "EMPTY_ARRAY", "Almeno un itemType e obbligatorio");
  }

  validateRelationTypes(payload.config.relationTypes === undefined ? [] : payload.config.relationTypes, payload.config.itemTypes, errors);
  return errors;
}

module.exports = {
  normalizeMuseumPayload,
  validateMuseumPayload,
};
