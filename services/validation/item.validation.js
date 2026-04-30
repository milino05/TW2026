const mongoose = require("mongoose");
const Item = require("../../models/item.model");

const { pushError, hasOwn, trimIfString, isPlainObject, normalizeBoolean } = require("./validation.utils");

function normalizeItemPayload(payload = {}) {
  const normalized = {};

  ["externalId", "itemType", "label", "status"].forEach((field) => {
    if (hasOwn(payload, field)) {
      normalized[field] = trimIfString(payload[field]);
    }
  });

  if (hasOwn(payload, "tags")) {
    normalized.tags = Array.isArray(payload.tags)
      ? payload.tags
          .filter((tag) => typeof tag === "string" || typeof tag === "number")
          .map((tag) => String(tag).trim())
          .filter(Boolean)
      : payload.tags;
  }

  if (hasOwn(payload, "recognitionImage")) {
    normalized.recognitionImage = isPlainObject(payload.recognitionImage)
      ? {
          url: trimIfString(payload.recognitionImage.url),
          altText: trimIfString(payload.recognitionImage.altText),
        }
      : payload.recognitionImage;
  }

  if (hasOwn(payload, "metadata")) {
    normalized.metadata = isPlainObject(payload.metadata)
      ? {
          license: trimIfString(payload.metadata.license),
        }
      : payload.metadata;
  }

  if (hasOwn(payload, "jsonld")) {
    normalized.jsonld = payload.jsonld;
  }

  if (hasOwn(payload, "representations")) {
    normalized.representations = Array.isArray(payload.representations)
      ? payload.representations.filter(isPlainObject).map((rep) => ({
          languageLevel: trimIfString(rep.languageLevel),
          durationKey: trimIfString(rep.durationKey)?.toLowerCase(),
          text: trimIfString(rep.text),
          isDefault: normalizeBoolean(rep.isDefault),
        }))
      : payload.representations;
  }

  if (Array.isArray(normalized.representations)) {
    const defaultCount = normalized.representations.filter((rep) => rep.isDefault === true).length;
    if (normalized.representations.length > 0 && defaultCount === 0) {
      //METTE IL PRIMO ELEMENTO COME DEFAULT SE NON È SPECIFICATO
      normalized.representations[0].isDefault = true;
    }

    //TRASFORMA I TRUTY E I FALSY IN BOOLEANI VERI
    normalized.representations = normalized.representations.map((rep) => ({
      ...rep,
      isDefault: rep.isDefault === true,
    }));
  }

  if (hasOwn(payload, "relations")) {
    normalized.relations = Array.isArray(payload.relations)
      ? payload.relations.map((rel) => {
          if (!isPlainObject(rel)) {
            return rel;
          }

          return {
            relationTypeKey: trimIfString(rel.relationTypeKey)?.toLowerCase(),
            target: rel.target,
            weight: rel.weight,
          };
        })
      : payload.relations;
  }

  return normalized;
}

function validateTopLevelFields(payload, vocabulary, errors) {
  if (!payload.label || typeof payload.label !== "string") {
    pushError(errors, "label", "REQUIRED", "Il campo label è mancante o non è una stringa");
  }

  if (!payload.itemType || typeof payload.itemType !== "string") {
    pushError(errors, "itemType", "REQUIRED", "Il campo itemType è mancante o non è una stringa");
    return;
  }

  if (!vocabulary.itemTypes.includes(payload.itemType)) {
    pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", `itemType non valido: ${payload.itemType}`, {
      allowedValues: vocabulary.itemTypes,
    });
  }

  if (payload.status !== undefined) {
    //MEGLIO FAR RIFERIMENTO AD UN FILE A PARTE, COSÌ SE VOGLIAMO MODIFICARE È PIÙ SEMPLICE
    const allowedStatus = ["draft", "published", "archived"];
    if (!allowedStatus.includes(payload.status)) {
      pushError(errors, "status", "INVALID_ENUM", `status non valido: ${payload.status}`, {
        allowedValues: allowedStatus,
      });
    }
  }

  if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
    pushError(errors, "tags", "INVALID_TYPE", "tags deve essere un array");
  }

  if (payload.recognitionImage !== undefined && payload.recognitionImage !== null && !isPlainObject(payload.recognitionImage)) {
    pushError(errors, "recognitionImage", "INVALID_TYPE", "recognitionImage deve essere un oggetto");
  }

  if (payload.metadata !== undefined && payload.metadata !== null && !isPlainObject(payload.metadata)) {
    pushError(errors, "metadata", "INVALID_TYPE", "metadata deve essere un oggetto");
  }
}

function validateRepresentations(representations, vocabulary, errors) {
  if (representations === undefined) {
    pushError(errors, "representations", "REQUIRED", "Almeno una representation è obbligatoria");
    return;
  }

  if (!Array.isArray(representations)) {
    pushError(errors, "representations", "INVALID_TYPE", "representations deve essere un array");
    return;
  }

  if (representations.length === 0) {
    pushError(errors, "representations", "EMPTY_ARRAY", "Almeno una representation è obbligatoria");
    return;
  }

  const allowedDurationKeys = vocabulary.durationTypes.map((durationType) => durationType.key);
  const seenPairs = new Set();
  let defaultCount = 0;
  //CONTROLLARE BENE I CAMPI CHE NON VOGLIAMO OBBLIGATORI
  representations.forEach((rep, index) => {
    const basePath = `representations[${index}]`;

    if (!isPlainObject(rep)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni representation deve essere un oggetto");
      return;
    }

    if (!rep.languageLevel || typeof rep.languageLevel !== "string") {
      pushError(errors, `${basePath}.languageLevel`, "REQUIRED", "languageLevel è obbligatorio");
    } else if (!vocabulary.languageLevels.includes(rep.languageLevel)) {
      pushError(errors, `${basePath}.languageLevel`, "INVALID_CONTROLLED_VALUE", `languageLevel non valido: ${rep.languageLevel}`, {
        allowedValues: vocabulary.languageLevels,
      });
    }

    if (!rep.durationKey || typeof rep.durationKey !== "string") {
      pushError(errors, `${basePath}.durationKey`, "REQUIRED", "durationKey è obbligatorio");
    } else if (!allowedDurationKeys.includes(rep.durationKey)) {
      pushError(errors, `${basePath}.durationKey`, "INVALID_CONTROLLED_VALUE", `durationKey non valido: ${rep.durationKey}`, {
        allowedValues: allowedDurationKeys,
      });
    }

    if (!rep.text || typeof rep.text !== "string") {
      pushError(errors, `${basePath}.text`, "REQUIRED", "Il testo della representation è obbligatorio");
    }

    const pairKey = `${rep.languageLevel}::${rep.durationKey}`;
    if (rep.languageLevel && rep.durationKey) {
      if (seenPairs.has(pairKey)) {
        pushError(errors, basePath, "DUPLICATE_REPRESENTATION", `Coppia languageLevel/durationKey duplicata: ${pairKey}`);
      } else {
        seenPairs.add(pairKey);
      }
    }

    if (rep.isDefault === true) {
      defaultCount += 1;
    }
  });

  if (defaultCount > 1) {
    pushError(errors, "representations", "MULTIPLE_DEFAULTS", "È consentita una sola representation di default");
  }
}

async function validateRelations({ museumId, itemType, relations, vocabulary, errors, currentItemId = null }) {
  if (relations === undefined) {
    //QUI SI ASSUME CHE LE RELATIONS NON SONO OBBLIGATORIE NEGLI ITEMS
    return;
  }

  if (!Array.isArray(relations)) {
    pushError(errors, "relations", "INVALID_TYPE", "relations deve essere un array");
    return;
  }

  const relationTypesByKey = new Map(vocabulary.relationTypes.map((relationType) => [relationType.key, relationType]));

  const seenRelations = new Set();
  const seenRelationTypeOccurrences = new Map();

  for (let index = 0; index < relations.length; index += 1) {
    const rel = relations[index];
    const basePath = `relations[${index}]`;

    if (!isPlainObject(rel)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni relation deve essere un oggetto");
      continue;
    }

    if (!rel.relationTypeKey || typeof rel.relationTypeKey !== "string") {
      pushError(errors, `${basePath}.relationTypeKey`, "REQUIRED", "relationTypeKey è obbligatorio");
      continue;
    }

    const relationType = relationTypesByKey.get(rel.relationTypeKey);
    //OTTIMIZZAZIONE INTERESSANTE. SI USA LA MAPPA PER VERIFICARE CHE LA KEY È VALIDA
    if (!relationType) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_RELATION_TYPE", `relationTypeKey non presente nel vocabolario del museo: ${rel.relationTypeKey}`);
      continue;
    }

    if (Array.isArray(relationType.domain) && relationType.domain.length > 0 && !relationType.domain.includes(itemType)) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_DOMAIN", `La relazione ${relationType.label} non è applicabile a itemType ${itemType}`);
    }

    const alreadySeenForType = seenRelationTypeOccurrences.get(rel.relationTypeKey) || 0;
    if (relationType.validationRules?.allowMultiple === false && alreadySeenForType >= 1) {
      pushError(errors, basePath, "MULTIPLE_RELATIONS_NOT_ALLOWED", `La relazione ${relationType.label} ammette un solo target`);
    }
    seenRelationTypeOccurrences.set(rel.relationTypeKey, alreadySeenForType + 1);

    if (!mongoose.isValidObjectId(rel.target)) {
      pushError(errors, `${basePath}.target`, "INVALID_OBJECT_ID", "target non è un ObjectId valido");
      continue;
    }

    if (currentItemId && String(rel.target) === String(currentItemId)) {
      pushError(errors, `${basePath}.target`, "SELF_RELATION", "Un item non può essere in relazione con sé stesso");
      continue;
    }

    const targetItem = await Item.findById(rel.target).select("_id itemType museumId").lean();

    if (!targetItem) {
      pushError(errors, `${basePath}.target`, "TARGET_NOT_FOUND", "L'item target non esiste");
      continue;
    }

    if (String(targetItem.museumId) !== String(museumId)) {
      pushError(errors, `${basePath}.target`, "CROSS_MUSEUM_TARGET", "Il target appartiene a un museo diverso");
    }

    if (Array.isArray(relationType.range) && relationType.range.length > 0 && !relationType.range.includes(targetItem.itemType)) {
      pushError(errors, `${basePath}.target`, "INVALID_RANGE", `Il target di tipo ${targetItem.itemType} non è compatibile con la relazione ${relationType.label}`);
    }

    if (rel.weight !== undefined) {
      const weight = Number(rel.weight);
      //STESSO DISCORSO, SALVARE GLI INTERVALLI 0-10 IN UN FILE A PARTE, COSÌ FACILMENTE MODIFICABILI OVUNQUE
      if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
        pushError(errors, `${basePath}.weight`, "INVALID_NUMBER", "weight deve essere un numero compreso tra 0 e 10");
      }
    }

    const duplicateKey = `${rel.relationTypeKey}::${String(rel.target)}`;
    if (seenRelations.has(duplicateKey)) {
      pushError(errors, basePath, "DUPLICATE_RELATION", "Relazione duplicata verso lo stesso target con lo stesso tipo");
    } else {
      seenRelations.add(duplicateKey);
    }
  }
}

async function validateItemPayload({ museumId, payload, vocabulary, currentItemId = null }) {
  const errors = [];

  validateTopLevelFields(payload, vocabulary, errors);
  validateRepresentations(payload.representations, vocabulary, errors);

  await validateRelations({
    museumId,
    itemType: payload.itemType,
    relations: payload.relations,
    vocabulary,
    errors,
    currentItemId,
  });

  return errors;
}

module.exports = {
  normalizeItemPayload,
  validateItemPayload,
};
