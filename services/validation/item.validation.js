const mongoose = require("mongoose");
const Item = require("../../models/item.model");

const {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeBoolean,
  normalizeKey,
} = require("./validation.utils");

function normalizeItemPayload(payload = {}) {
  const normalized = {};

  ["externalId", "itemType", "label"].forEach((field) => {
    if (hasOwn(payload, field)) normalized[field] = trimIfString(payload[field]);
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
      ? { license: trimIfString(payload.metadata.license) }
      : payload.metadata;
  }

  if (hasOwn(payload, "jsonld")) normalized.jsonld = payload.jsonld;

  if (hasOwn(payload, "representations")) {
    normalized.representations = Array.isArray(payload.representations)
      ? payload.representations.map((representation) => {
          if (!isPlainObject(representation)) return representation;

          return {
            languageLevelKey: normalizeKey(representation.languageLevelKey),
            durationKey: normalizeKey(representation.durationKey),
            text: trimIfString(representation.text),
            isDefault: normalizeBoolean(representation.isDefault) === true,
          };
        })
      : payload.representations;
  }

  if (hasOwn(payload, "relations")) {
    normalized.relations = Array.isArray(payload.relations)
      ? payload.relations.map((relation) => {
          if (!isPlainObject(relation)) return relation;

          return {
            relationTypeKey: normalizeKey(relation.relationTypeKey),
            target: relation.target,
            weight: relation.weight,
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
      pushError(errors, "label", "REQUIRED", "Il campo label e obbligatorio");
    }
  }

  if (isCreate || hasOwn(payload, "itemType")) {
    if (!payload.itemType || typeof payload.itemType !== "string") {
      pushError(errors, "itemType", "REQUIRED", "Il campo itemType e obbligatorio");
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
      const seen = new Set();
      payload.tags.forEach((tag, index) => {
        if (!tag || typeof tag !== "string") {
          pushError(errors, `tags[${index}]`, "INVALID_VALUE", "Ogni tag deve essere una stringa non vuota");
        } else if (seen.has(tag)) {
          pushError(errors, `tags[${index}]`, "DUPLICATE_VALUE", `Tag duplicato: ${tag}`);
        } else {
          seen.add(tag);
        }
      });
    }
  }

  if (hasOwn(payload, "recognitionImage")) {
    if (payload.recognitionImage !== null && !isPlainObject(payload.recognitionImage)) {
      pushError(errors, "recognitionImage", "INVALID_TYPE", "recognitionImage deve essere un oggetto oppure null");
    } else if (isPlainObject(payload.recognitionImage)) {
      if (!payload.recognitionImage.url || typeof payload.recognitionImage.url !== "string") {
        pushError(errors, "recognitionImage.url", "REQUIRED", "recognitionImage.url e obbligatorio");
      }
      if (!payload.recognitionImage.altText || typeof payload.recognitionImage.altText !== "string") {
        pushError(errors, "recognitionImage.altText", "REQUIRED", "recognitionImage.altText e obbligatorio");
      }
    }
  }

  if (hasOwn(payload, "metadata")) {
    if (payload.metadata !== null && !isPlainObject(payload.metadata)) {
      pushError(errors, "metadata", "INVALID_TYPE", "metadata deve essere un oggetto oppure null");
    } else if (isPlainObject(payload.metadata)) {
      if (!payload.metadata.license || typeof payload.metadata.license !== "string") {
        pushError(errors, "metadata.license", "REQUIRED", "metadata.license deve essere una stringa non vuota");
      }
    }
  }
}

function validateRepresentations(representations, vocabulary, errors) {
  if (representations === undefined) return;

  if (!Array.isArray(representations)) {
    pushError(errors, "representations", "INVALID_TYPE", "representations deve essere un array");
    return;
  }

  const allowedLanguageLevelKeys = new Set(vocabulary.languageLevels.map((level) => level.key));
  const allowedDurationKeys = new Set(vocabulary.durationTypes.map((duration) => duration.key));
  const seenPairs = new Set();
  let defaultCount = 0;

  representations.forEach((representation, index) => {
    const basePath = `representations[${index}]`;

    if (!isPlainObject(representation)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni representation deve essere un oggetto");
      return;
    }

    if (!representation.languageLevelKey || typeof representation.languageLevelKey !== "string") {
      pushError(errors, `${basePath}.languageLevelKey`, "REQUIRED", "languageLevelKey e obbligatoria");
    } else if (!allowedLanguageLevelKeys.has(representation.languageLevelKey)) {
      pushError(errors, `${basePath}.languageLevelKey`, "INVALID_CONTROLLED_VALUE", `languageLevelKey non valida: ${representation.languageLevelKey}`, {
        allowedValues: Array.from(allowedLanguageLevelKeys),
      });
    }

    if (!representation.durationKey || typeof representation.durationKey !== "string") {
      pushError(errors, `${basePath}.durationKey`, "REQUIRED", "durationKey e obbligatoria");
    } else if (!allowedDurationKeys.has(representation.durationKey)) {
      pushError(errors, `${basePath}.durationKey`, "INVALID_CONTROLLED_VALUE", `durationKey non valida: ${representation.durationKey}`, {
        allowedValues: Array.from(allowedDurationKeys),
      });
    }

    if (!representation.text || typeof representation.text !== "string") {
      pushError(errors, `${basePath}.text`, "REQUIRED", "Il testo e obbligatorio");
    }

    if (representation.languageLevelKey && representation.durationKey) {
      const pairKey = `${representation.languageLevelKey}::${representation.durationKey}`;
      if (seenPairs.has(pairKey)) {
        pushError(errors, basePath, "DUPLICATE_REPRESENTATION", `Coppia languageLevelKey/durationKey duplicata: ${pairKey}`);
      } else {
        seenPairs.add(pairKey);
      }
    }

    if (representation.isDefault === true) defaultCount += 1;
  });

  if (defaultCount > 1) {
    pushError(errors, "representations", "MULTIPLE_DEFAULTS", "E consentita una sola representation di default");
  }
}

async function validateRelations({ museumId, itemType, relations, vocabulary, errors, currentItemId = null }) {
  if (relations === undefined) return;

  if (!Array.isArray(relations)) {
    pushError(errors, "relations", "INVALID_TYPE", "relations deve essere un array");
    return;
  }

  const relationTypesByKey = new Map(vocabulary.relationTypes.map((type) => [type.key, type]));
  const seenRelations = new Set();
  const occurrences = new Map();

  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index];
    const basePath = `relations[${index}]`;

    if (!isPlainObject(relation)) {
      pushError(errors, basePath, "INVALID_TYPE", "Ogni relation deve essere un oggetto");
      continue;
    }

    const relationType = relationTypesByKey.get(relation.relationTypeKey);
    if (!relation.relationTypeKey || !relationType) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_RELATION_TYPE", `relationTypeKey non valida: ${relation.relationTypeKey}`);
      continue;
    }

    if (relationType.domain?.length && !relationType.domain.includes(itemType)) {
      pushError(errors, `${basePath}.relationTypeKey`, "INVALID_DOMAIN", `La relazione ${relationType.label} non e applicabile a itemType ${itemType}`);
    }

    const count = occurrences.get(relation.relationTypeKey) || 0;
    if (relationType.validationRules?.allowMultiple === false && count >= 1) {
      pushError(errors, basePath, "MULTIPLE_RELATIONS_NOT_ALLOWED", `La relazione ${relationType.label} ammette un solo target`);
    }
    occurrences.set(relation.relationTypeKey, count + 1);

    if (!relation.target || !mongoose.isValidObjectId(relation.target)) {
      pushError(errors, `${basePath}.target`, "INVALID_OBJECT_ID", "target deve essere un ObjectId valido");
      continue;
    }

    if (currentItemId && String(relation.target) === String(currentItemId)) {
      pushError(errors, `${basePath}.target`, "SELF_RELATION", "Un item non puo essere in relazione con se stesso");
      continue;
    }

    const targetItem = await Item.findById(relation.target).select("_id itemType museumId").lean();
    if (!targetItem) {
      pushError(errors, `${basePath}.target`, "TARGET_NOT_FOUND", "L'item target non esiste");
      continue;
    }

    if (String(targetItem.museumId) !== String(museumId)) {
      pushError(errors, `${basePath}.target`, "CROSS_MUSEUM_TARGET", "Il target appartiene a un museo diverso");
      continue;
    }

    if (relationType.range?.length && !relationType.range.includes(targetItem.itemType)) {
      pushError(errors, `${basePath}.target`, "INVALID_RANGE", `Il target di tipo ${targetItem.itemType} non e compatibile con la relazione ${relationType.label}`);
    }

    if (relation.weight !== undefined) {
      const weight = Number(relation.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
        pushError(errors, `${basePath}.weight`, "INVALID_NUMBER", "weight deve essere compreso tra 0 e 10");
      }
    }

    const duplicateKey = `${relation.relationTypeKey}::${String(relation.target)}`;
    if (seenRelations.has(duplicateKey)) {
      pushError(errors, basePath, "DUPLICATE_RELATION", "Relazione duplicata verso lo stesso target con lo stesso tipo");
    } else {
      seenRelations.add(duplicateKey);
    }
  }
}

async function validateItemDraftPayload({ museumId, payload, vocabulary, mode, existingItem = null, currentItemId = null }) {
  const errors = [];
  const effectiveItemType = hasOwn(payload, "itemType") ? payload.itemType : existingItem?.itemType;

  validateTopLevelFields({ payload, vocabulary, errors, mode });
  validateRepresentations(payload.representations, vocabulary, errors);
  await validateRelations({
    museumId,
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
