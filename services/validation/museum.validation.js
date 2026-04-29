const { pushError, hasOwn, trimIfString, isPlainObject, normalizeKey, normalizeBoolean, normalizeStringArrayStrict, toNumberIfPresent, validateUniqueStringArray } = require("./validation.utils");

function normalizeDurationTypes(durationTypes) {
  if (!Array.isArray(durationTypes)) {
    return durationTypes;
  }

  return durationTypes.map((durationType) => {
    if (!isPlainObject(durationType)) {
      return durationType;
    }

    return {
      key: normalizeKey(durationType.key),
      label: trimIfString(durationType.label),
      level: toNumberIfPresent(durationType.level),
      description: trimIfString(durationType.description),
    };
  });
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

      domain: normalizeStringArrayStrict(relationType.domain, {
        allowNumbers: false,
      }),

      range: normalizeStringArrayStrict(relationType.range, {
        allowNumbers: false,
      }),

      category: trimIfString(relationType.category),
      strength: trimIfString(relationType.strength),

      userIntents: normalizeStringArrayStrict(relationType.userIntents, {
        allowNumbers: false,
      }),

      directionality: trimIfString(relationType.directionality),

      reverse: isPlainObject(relationType.reverse)
        ? {
            label: trimIfString(relationType.reverse.label),
            description: trimIfString(relationType.reverse.description),
            userIntents: normalizeStringArrayStrict(relationType.reverse.userIntents, {
              allowNumbers: false,
            }),
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
        normalized.config.languageLevels = normalizeStringArrayStrict(payload.config.languageLevels, { allowNumbers: false });
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

function validateDurationTypes(durationTypes, errors) {
  if (!Array.isArray(durationTypes)) {
    pushError(errors, "config.durationTypes", "INVALID_TYPE", "durationTypes deve essere un array");
    return;
  }

  if (durationTypes.length === 0) {
    pushError(errors, "config.durationTypes", "EMPTY_ARRAY", "Almeno un durationType è obbligatorio");
    return;
  }

  const seenKeys = new Set();

  durationTypes.forEach((durationType, index) => {
    const basePath = `config.durationTypes[${index}]`;

    if (!isPlainObject(durationType)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni durationType deve essere un oggetto");
      return;
    }

    if (!durationType.key || typeof durationType.key !== "string") {
      pushError(errors, `${basePath}.key`, "REQUIRED", "key è obbligatoria");
    } else if (seenKeys.has(durationType.key)) {
      pushError(errors, `${basePath}.key`, "DUPLICATE_KEY", `durationType key duplicata: ${durationType.key}`);
    } else {
      seenKeys.add(durationType.key);
    }

    if (!durationType.label || typeof durationType.label !== "string") {
      pushError(errors, `${basePath}.label`, "REQUIRED", "label è obbligatoria");
    }

    if (!Number.isFinite(durationType.level) || durationType.level < 1) {
      pushError(errors, `${basePath}.level`, "INVALID_NUMBER", "level deve essere un numero maggiore o uguale a 1");
    }
  });
}

function validateStringArrayValues(values, field, errors) {
  if (values === undefined) {
    return;
  }

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
      pushError(errors, `${basePath}.key`, "REQUIRED", "key è obbligatoria");
    } else if (relationTypeKeys.has(relationType.key)) {
      pushError(errors, `${basePath}.key`, "DUPLICATE_KEY", `relationType key duplicata: ${relationType.key}`);
    } else {
      relationTypeKeys.add(relationType.key);
    }

    if (!relationType.label || typeof relationType.label !== "string") {
      pushError(errors, `${basePath}.label`, "REQUIRED", "label è obbligatoria");
    }

    if (!allowedCategories.includes(relationType.category)) {
      pushError(errors, `${basePath}.category`, "INVALID_ENUM", `category non valida: ${relationType.category}`, {
        allowedValues: allowedCategories,
      });
    }

    const directionality = relationType.directionality || "directed";

    if (!allowedDirectionalities.includes(directionality)) {
      pushError(errors, `${basePath}.directionality`, "INVALID_ENUM", `directionality non valida: ${relationType.directionality}`, {
        allowedValues: allowedDirectionalities,
      });
    }

    if (typeof relationType.key === "string" && relationType.key.includes(":")) {
      pushError(errors, `${basePath}.key`, "RESERVED_KEY_FORMAT", "La key della relationType non può contenere ':' perché è riservato alle relationViews generate dal sistema");
    }

    if (relationType.reverse !== undefined) {
      if (!isPlainObject(relationType.reverse)) {
        pushError(errors, `${basePath}.reverse`, "INVALID_TYPE", "reverse deve essere un oggetto");
      } else {
        if (relationType.reverse.label !== undefined && typeof relationType.reverse.label !== "string") {
          pushError(errors, `${basePath}.reverse.label`, "INVALID_TYPE", "reverse.label deve essere una stringa");
        }

        validateStringArrayValues(relationType.reverse.userIntents, `${basePath}.reverse.userIntents`, errors);
      }
    }
    if (relationType.strength !== undefined && !allowedStrengths.includes(relationType.strength)) {
      pushError(errors, `${basePath}.strength`, "INVALID_ENUM", `strength non valida: ${relationType.strength}`, {
        allowedValues: allowedStrengths,
      });
    }

    validateStringArrayValues(relationType.domain, `${basePath}.domain`, errors);

    validateStringArrayValues(relationType.range, `${basePath}.range`, errors);

    validateStringArrayValues(relationType.userIntents, `${basePath}.userIntents`, errors);

    ["domain", "range"].forEach((field) => {
      const values = relationType[field];

      if (!Array.isArray(values)) {
        return;
      }

      values.forEach((itemType, itemTypeIndex) => {
        if (typeof itemType !== "string" || !itemType) {
          return;
        }

        if (!itemTypeSet.has(itemType)) {
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
    pushError(errors, "name", "REQUIRED", "Il campo name è obbligatorio");
  }

  if (!isPlainObject(payload.config)) {
    pushError(errors, "config", "REQUIRED", "Il campo config è obbligatorio e deve essere un oggetto");
    return errors;
  }

  validateUniqueStringArray(payload.config.languageLevels, "config.languageLevels", errors);

  validateUniqueStringArray(payload.config.itemTypes, "config.itemTypes", errors);

  if (Array.isArray(payload.config.languageLevels) && payload.config.languageLevels.length === 0) {
    pushError(errors, "config.languageLevels", "EMPTY_ARRAY", "Almeno un languageLevel è obbligatorio");
  }

  if (Array.isArray(payload.config.itemTypes) && payload.config.itemTypes.length === 0) {
    pushError(errors, "config.itemTypes", "EMPTY_ARRAY", "Almeno un itemType è obbligatorio");
  }

  validateDurationTypes(payload.config.durationTypes, errors);

  const relationTypesForValidation = payload.config.relationTypes === undefined ? [] : payload.config.relationTypes;

  validateRelationTypes(relationTypesForValidation, payload.config.itemTypes, errors);

  return errors;
}

module.exports = {
  normalizeMuseumPayload,
  validateMuseumPayload,
};
