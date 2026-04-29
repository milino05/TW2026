const { pushError } = require("./validation.utils");

function buildRelationTypeMap(relationTypes) {
  const relationTypesByKey = new Map();
  const duplicateKeys = new Set();

  relationTypes.forEach((relationType, index) => {
    if (!relationType || typeof relationType !== "object") {
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

/**
 * Sincronizza automaticamente le inverse dei relationTypes.
 *
 * Esempio:
 * [
 *   { key: "created_by" },
 *   { key: "creator_of", inverseKey: "created_by" }
 * ]
 *
 * diventa:
 * [
 *   { key: "created_by", inverseKey: "creator_of" },
 *   { key: "creator_of", inverseKey: "created_by" }
 * ]
 *
 * La funzione modifica l'array in memoria e restituisce eventuali errori.
 */
function synchronizeRelationTypeInverses(relationTypes) {
  const errors = [];

  if (!Array.isArray(relationTypes)) {
    return errors;
  }

  const { relationTypesByKey, duplicateKeys } = buildRelationTypeMap(relationTypes);

  /*
    Se ci sono key duplicate, non sincronizziamo le inverse.
    Sarà museum.validation.js a produrre l'errore DUPLICATE_KEY.

    Questo evita comportamenti ambigui: se due relationTypes hanno la stessa key,
    non è chiaro quale delle due debba essere considerata l'inversa corretta.
  */
  if (duplicateKeys.size > 0) {
    return errors;
  }

  relationTypes.forEach((relationType, index) => {
    if (!relationType || typeof relationType !== "object") {
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

    /*
      Caso semplice:
      A.inverseKey = B
      B.inverseKey è vuoto

      Allora il backend completa automaticamente:
      B.inverseKey = A
    */
    if (!inverseRelationType.inverseKey) {
      inverseRelationType.inverseKey = key;
      return;
    }

    /*
      Caso già corretto:
      A.inverseKey = B
      B.inverseKey = A

      Non bisogna fare nulla.
    */
    if (inverseRelationType.inverseKey === key) {
      return;
    }

    /*
      Caso incoerente:
      A.inverseKey = B
      ma B.inverseKey = C

      Qui il backend non può decidere automaticamente chi ha ragione.
    */
    pushError(errors, `config.relationTypes[${inverseIndex}].inverseKey`, "INCONSISTENT_INVERSE_KEY", `La relationType ${inverseRelationType.key} è già inversa di ${inverseRelationType.inverseKey}, quindi non può essere inversa anche di ${key}`);
  });

  return errors;
}

module.exports = {
  synchronizeRelationTypeInverses,
};
