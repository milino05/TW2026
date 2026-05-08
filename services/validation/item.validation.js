const mongoose = require("mongoose");

const { pushError, hasOwn, trimIfString, isPlainObject, normalizeBoolean } = require("./validation.utils");

function normalizeItemPayload(payload = {}) {
  const normalized = {};

  ["externalId", "itemType", "label"].forEach((field) => {
    if (hasOwn(payload, field)) {
      normalized[field] = trimIfString(payload[field]);
    }
  });

  if (hasOwn(payload, "tags")) {
    normalized.tags = Array.isArray(payload.tags)
      ? payload.tags.map((tag) => (typeof tag === "string" ? tag.trim() : tag))
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
      ? payload.representations.map((rep) => {
        if (!isPlainObject(rep)) {
          return rep;
        }

        return {
          languageLevel: trimIfString(rep.languageLevel),
          durationKey: trimIfString(rep.durationKey)?.toLowerCase(),
          text: trimIfString(rep.text),
          isDefault: normalizeBoolean(rep.isDefault),
        };
      })
      : payload.representations;
  }

  if (Array.isArray(normalized.representations)) {
    const defaultCount = normalized.representations.filter((rep) => isPlainObject(rep) && rep.isDefault === true).length;

    if (normalized.representations.length > 0 && defaultCount === 0 && isPlainObject(normalized.representations[0])) {
      normalized.representations[0].isDefault = true;
    }

    normalized.representations = normalized.representations.map((rep) => {
      if (!isPlainObject(rep)) {
        return rep;
      }

      return {
        ...rep,
        isDefault: rep.isDefault === true,
      };
    });
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

function validateTopLevelFields({ payload, vocabulary, errors, mode }) {
  const isCreate = mode === "create";

  if (isCreate || hasOwn(payload, "label")) {
    if (!payload.label || typeof payload.label !== "string") {
      pushError(errors, "label", "REQUIRED", "Il campo label è mancante o non è una stringa");
    }
  }

  if (isCreate || hasOwn(payload, "itemType")) {
    if (!payload.itemType || typeof payload.itemType !== "string") {
      pushError(errors, "itemType", "REQUIRED", "Il campo itemType è mancante o non è una stringa");
    } else if (!vocabulary.itemTypes.includes(payload.itemType)) {
      pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", `itemType non valido: ${payload.itemType}`, {
        allowedValues: vocabulary.itemTypes,
      });
    }
  }

  if (hasOwn(payload, "tags")) {
    if (!Array.isArray(payload.tags)) {
      pushError(errors, "tags", "INVALID_TYPE", "tags deve essere un array");
    } else {
      const seenTags = new Set();

      payload.tags.forEach((tag, index) => {
        const path = `tags[${index}]`;

        if (!tag || typeof tag !== "string") {
          pushError(errors, path, "INVALID_VALUE", "Ogni tag deve essere una stringa non vuota");
          return;
        }

        if (seenTags.has(tag)) {
          pushError(errors, path, "DUPLICATE_VALUE", `Tag duplicato: ${tag}`);
          return;
        }

        seenTags.add(tag);
      });
    }
  }

  if (hasOwn(payload, "recognitionImage")) {
    if (payload.recognitionImage !== null && !isPlainObject(payload.recognitionImage)) {
      pushError(errors, "recognitionImage", "INVALID_TYPE", "recognitionImage deve essere un oggetto oppure null");
    }

    if (isPlainObject(payload.recognitionImage)) {
      if (!payload.recognitionImage.url || typeof payload.recognitionImage.url !== "string") {
        pushError(errors, "recognitionImage.url", "REQUIRED", "recognitionImage.url è obbligatorio quando recognitionImage è presente");
      }

      if (!payload.recognitionImage.altText || typeof payload.recognitionImage.altText !== "string") {
        pushError(errors, "recognitionImage.altText", "REQUIRED", "recognitionImage.altText è obbligatorio quando recognitionImage è presente");
      }
    }
  }

  if (hasOwn(payload, "metadata")) {
    if (payload.metadata !== null && !isPlainObject(payload.metadata)) {
      pushError(errors, "metadata", "INVALID_TYPE", "metadata deve essere un oggetto oppure null");
    }

    if (isPlainObject(payload.metadata)) {
      if (!hasOwn(payload.metadata, "license")) {
        pushError(errors, "metadata.license", "REQUIRED", "metadata.license è obbligatorio quando metadata è presente");
      } else if (!payload.metadata.license || typeof payload.metadata.license !== "string") {
        pushError(errors, "metadata.license", "INVALID_VALUE", "metadata.license deve essere una stringa non vuota");
      }
    }
  }
}

function validateRepresentations(representations, vocabulary, errors) {
  if (representations === undefined) {
    return;
  }

  if (!Array.isArray(representations)) {
    pushError(errors, "representations", "INVALID_TYPE", "representations deve essere un array");
    return;
  }

  const allowedDurationKeys = vocabulary.durationTypes.map((durationType) => durationType.key);
  const seenPairs = new Set();
  let defaultCount = 0;

  representations.forEach((rep, index) => {
    const basePath = `representations[${index}]`;

    if (!isPlainObject(rep)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni representation deve essere un oggetto");
      return;
    }

    if (!rep.languageLevel || typeof rep.languageLevel !== "string") {
      pushError(errors, `${basePath}.languageLevel`, "REQUIRED", "languageLevel è obbligatorio se la representation è presente");
    } else if (!vocabulary.languageLevels.includes(rep.languageLevel)) {
      pushError(errors, `${basePath}.languageLevel`, "INVALID_CONTROLLED_VALUE", `languageLevel non valido: ${rep.languageLevel}`, {
        allowedValues: vocabulary.languageLevels,
      });
    }

    if (!rep.durationKey || typeof rep.durationKey !== "string") {
      pushError(errors, `${basePath}.durationKey`, "REQUIRED", "durationKey è obbligatorio se la representation è presente");
    } else if (!allowedDurationKeys.includes(rep.durationKey)) {
      pushError(errors, `${basePath}.durationKey`, "INVALID_CONTROLLED_VALUE", `durationKey non valido: ${rep.durationKey}`, {
        allowedValues: allowedDurationKeys,
      });
    }

    if (!rep.text || typeof rep.text !== "string") {
      pushError(errors, `${basePath}.text`, "REQUIRED", "Il testo è obbligatorio se la representation è presente");
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

function validateRelations({ itemType, relations, vocabulary, errors, currentItemId = null }) {
  if (relations === undefined) {
    return;
  }

  if (!Array.isArray(relations)) {
    pushError(errors, "relations", "INVALID_TYPE", "relations deve essere un array");
    return;
  }

  const relationTypesByKey = new Map(vocabulary.relationTypes.map((relationType) => [relationType.key, relationType]));
  const seenRelations = new Set();
  const seenRelationTypeOccurrences = new Map();

  relations.forEach((rel, index) => {
    const basePath = `relations[${index}]`;

    if (!isPlainObject(rel)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni relation deve essere un oggetto");
      return;
    }

    if (!rel.relationTypeKey || typeof rel.relationTypeKey !== "string") {
      pushError(errors, `${basePath}.relationTypeKey`, "REQUIRED", "relationTypeKey è obbligatorio se la relation è presente");
      return;
    }

    const relationType = relationTypesByKey.get(rel.relationTypeKey);

    if (!relationType) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_RELATION_TYPE", `relationTypeKey non presente nel vocabolario del museo: ${rel.relationTypeKey}`);
      return;
    }

    if (Array.isArray(relationType.domain) && relationType.domain.length > 0 && !relationType.domain.includes(itemType)) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_DOMAIN", `La relazione ${relationType.label} non è applicabile a itemType ${itemType}`);
    }

    const alreadySeenForType = seenRelationTypeOccurrences.get(rel.relationTypeKey) || 0;
    if (relationType.validationRules?.allowMultiple === false && alreadySeenForType >= 1) {
      pushError(errors, basePath, "MULTIPLE_RELATIONS_NOT_ALLOWED", `La relazione ${relationType.label} ammette un solo target`);
    }
    seenRelationTypeOccurrences.set(rel.relationTypeKey, alreadySeenForType + 1);

    if (!rel.target) {
      pushError(errors, `${basePath}.target`, "REQUIRED", "target è obbligatorio se la relation è presente");
      return;
    }

    if (!mongoose.isValidObjectId(rel.target)) {
      pushError(errors, `${basePath}.target`, "INVALID_OBJECT_ID", "target non è un ObjectId valido");
      return;
    }

    if (currentItemId && String(rel.target) === String(currentItemId)) {
      pushError(errors, `${basePath}.target`, "SELF_RELATION", "Un item non può essere in relazione con sé stesso");
      return;
    }

    if (rel.weight !== undefined) {
      const weight = Number(rel.weight);
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
  });
}

async function validateItemDraftPayload({ payload, vocabulary, mode, existingItem = null, currentItemId = null }) {
  const errors = [];
  const effectiveItemType = hasOwn(payload, "itemType") ? payload.itemType : existingItem?.itemType;

  validateTopLevelFields({
    payload,
    vocabulary,
    errors,
    mode,
  });

  validateRepresentations(payload.representations, vocabulary, errors);

  validateRelations({
    itemType: effectiveItemType,
    relations: payload.relations,
    vocabulary,
    errors,
    currentItemId,
  });

  return errors;
}

module.exports = {
  normalizeItemPayload,
  validateItemDraftPayload,
};
