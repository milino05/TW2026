const { pushError, isPlainObject } = require("./validation.utils");

function buildRelationTypeMap(relationTypes) {
  const relationTypesByKey = new Map();
  const duplicateKeys = new Set();

  relationTypes.forEach((relationType, index) => {
    if (!isPlainObject(relationType)) {
      return;
    }

    const { key } = relationType;

    if (!key || typeof key !== "string") {
      return;
    }

    if (relationTypesByKey.has(key)) {
      duplicateKeys.add(key);
      return;
    }

    relationTypesByKey.set(key, {
      relationType,
      index,
    });
  });

  return {
    relationTypesByKey,
    duplicateKeys,
  };
}

function synchronizeRelationTypeInverses(relationTypes) {
  const errors = [];

  if (!Array.isArray(relationTypes)) {
    return errors;
  }

  const { relationTypesByKey, duplicateKeys } = buildRelationTypeMap(relationTypes);

  if (duplicateKeys.size > 0) {
    return errors;
  }

  relationTypes.forEach((relationType, index) => {
    if (!isPlainObject(relationType)) {
      return;
    }

    const { key, inverseKey } = relationType;

    if (!key || typeof key !== "string") {
      return;
    }

    if (!inverseKey) {
      return;
    }

    const basePath = `config.relationTypes[${index}]`;

    if (inverseKey === key) {
      pushError(errors, `${basePath}.inverseKey`, "SELF_INVERSE_KEY", "inverseKey non può essere uguale alla key della stessa relationType");
      return;
    }

    const inverseEntry = relationTypesByKey.get(inverseKey);

    if (!inverseEntry) {
      pushError(errors, `${basePath}.inverseKey`, "UNKNOWN_INVERSE_KEY", `inverseKey non presente tra i relationTypes: ${inverseKey}`);
      return;
    }

    const inverseRelationType = inverseEntry.relationType;
    const inverseIndex = inverseEntry.index;

    if (!inverseRelationType.inverseKey) {
      inverseRelationType.inverseKey = key;
      return;
    }

    if (inverseRelationType.inverseKey === key) {
      return;
    }

    pushError(errors, `config.relationTypes[${inverseIndex}].inverseKey`, "INCONSISTENT_INVERSE_KEY", `La relationType ${inverseRelationType.key} è già inversa di ${inverseRelationType.inverseKey}, quindi non può essere inversa anche di ${key}`);
  });

  return errors;
}

module.exports = {
  synchronizeRelationTypeInverses,
};
