const { pushError, hasOwn, trimIfString, isPlainObject, normalizeKey, normalizeBoolean, normalizeStringArray, toNumberIfPresent, validateUniqueStringArray } = require("./validation.utils");

function normalizeDurationTypes(durationTypes) {
  return Array.isArray(durationTypes)
    ? durationTypes.filter(isPlainObject).map((durationType) => ({
        key: normalizeKey(durationType.key),
        label: trimIfString(durationType.label),
        level: durationType.level !== undefined && durationType.level !== null ? Number(durationType.level) : durationType.level,
        description: trimIfString(durationType.description),
      }))
    : durationTypes;
}

function normalizeRelationTypes(relationTypes) {
  return Array.isArray(relationTypes)
    ? relationTypes.filter(isPlainObject).map((relationType) => {
        const normalized = {
          key: normalizeKey(relationType.key),
          label: trimIfString(relationType.label),
          description: trimIfString(relationType.description),
          domain: normalizeStringArray(relationType.domain),
          range: normalizeStringArray(relationType.range),
          category: trimIfString(relationType.category),
          strength: trimIfString(relationType.strength),
          userIntents: normalizeStringArray(relationType.userIntents),
          inverseKey: normalizeKey(relationType.inverseKey),
        };

        if (isPlainObject(relationType.validationRules)) {
          normalized.validationRules = {};

          if (hasOwn(relationType.validationRules, "allowMultiple")) {
            normalized.validationRules.allowMultiple = normalizeBoolean(relationType.validationRules.allowMultiple);
          }

          if (hasOwn(relationType.validationRules, "targetRequired")) {
            normalized.validationRules.targetRequired = normalizeBoolean(relationType.validationRules.targetRequired);
          }
        }

        return normalized;
      })
    : relationTypes;
}

function normalizeMuseumPayload(payload = {}) {
  const normalized = {};

  if (hasOwn(payload, "name")) {
    normalized.name = trimIfString(payload.name);
  }

  if (hasOwn(payload, "config")) {
    if (!isPlainObject(payload.config)) {
      normalized.config = payload.config;
      return normalized;
    }

    normalized.config = {};

    if (hasOwn(payload.config, "languageLevels")) {
      normalized.config.languageLevels = normalizeStringArray(payload.config.languageLevels);
    }

    if (hasOwn(payload.config, "itemTypes")) {
      normalized.config.itemTypes = normalizeStringArray(payload.config.itemTypes);
    }

    if (hasOwn(payload.config, "durationTypes")) {
      normalized.config.durationTypes = normalizeDurationTypes(payload.config.durationTypes);
    }

    if (hasOwn(payload.config, "relationTypes")) {
      normalized.config.relationTypes = normalizeRelationTypes(payload.config.relationTypes);
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

function validateRelationTypes(relationTypes, itemTypes, errors) {
  if (!Array.isArray(relationTypes)) {
    pushError(errors, "config.relationTypes", "INVALID_TYPE", "relationTypes deve essere un array");
    return;
  }

  const allowedCategories = ["semantic", "logistic", "contextual", "editorial"];
  const allowedStrengths = ["strong", "medium", "weak"];
  const itemTypeSet = new Set(itemTypes || []);
  const relationTypeKeys = new Set();

  relationTypes.forEach((relationType, index) => {
    const basePath = `config.relationTypes[${index}]`;

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

    if (relationType.strength !== undefined && !allowedStrengths.includes(relationType.strength)) {
      pushError(errors, `${basePath}.strength`, "INVALID_ENUM", `strength non valida: ${relationType.strength}`, {
        allowedValues: allowedStrengths,
      });
    }

    ["domain", "range"].forEach((field) => {
      if (relationType[field] !== undefined && !Array.isArray(relationType[field])) {
        pushError(errors, `${basePath}.${field}`, "INVALID_TYPE", `${field} deve essere un array`);
        return;
      }

      if (Array.isArray(relationType[field])) {
        relationType[field].forEach((itemType, itemTypeIndex) => {
          if (!itemTypeSet.has(itemType)) {
            pushError(errors, `${basePath}.${field}[${itemTypeIndex}]`, "UNKNOWN_ITEM_TYPE", `itemType non presente in config.itemTypes: ${itemType}`);
          }
        });
      }
    });

    if (relationType.inverseKey !== undefined && typeof relationType.inverseKey !== "string") {
      pushError(errors, `${basePath}.inverseKey`, "INVALID_TYPE", "inverseKey deve essere una stringa");
    }

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
  validateRelationTypes(payload.config.relationTypes || [], payload.config.itemTypes || [], errors);

  return errors;
}

module.exports = {
  normalizeMuseumPayload,
  validateMuseumPayload,
};
