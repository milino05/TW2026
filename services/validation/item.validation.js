const mongoose = require("mongoose");
const Item = require("../../models/item.model");

function pushError(errors, field, code, message, extra = {}) {
  errors.push({
    field,
    code,
    message,
    ...extra,
  });
}


function normalizeItemPayload(payload = {}) {
  const trimIfString = (value) =>
    typeof value === "string" ? value.trim() : value;

  const isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value;

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }

    return Boolean(value);
  };

  const normalized = {};

  ["externalId", "itemType", "label"].forEach((field) => {
    normalized[field] = trimIfString(payload[field]);
  });

  normalized.tags = Array.isArray(payload.tags)
    ? payload.tags
      .filter((tag) => typeof tag === "string" || typeof tag === "number")
      .map((tag) => String(tag).trim())
      .filter(Boolean)
    : [];

  normalized.representations = Array.isArray(payload.representations)
    ? payload.representations
      .filter(isPlainObject)
      .map((rep) => ({
        languageLevel: trimIfString(rep.languageLevel),
        duration: trimIfString(rep.duration),
        text: trimIfString(rep.text),
        isDefault: normalizeBoolean(rep.isDefault),
      }))
    : [];

  normalized.relations = Array.isArray(payload.relations)
    ? payload.relations
      .filter(isPlainObject)
      .map((rel) => ({
        relationType: rel.relationType,
        target: rel.target,
        weight: rel.weight,
      }))
    : [];

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
    pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", `itemType non valido: ${payload.itemType}`, { allowedValues: vocabulary.itemTypes });
  }
}

function validateRepresentations(representations, vocabulary, errors) {
  if (!Array.isArray(representations)) {
    pushError(errors, "representations", "INVALID_TYPE", "representations deve essere un array");
    return;
  }

  const seenPairs = new Set();
  let defaultCount = 0;

  representations.forEach((rep, index) => {
    const basePath = `representations[${index}]`;

    if (!rep.languageLevel || typeof rep.languageLevel !== "string") {
      pushError(errors, `${basePath}.languageLevel`, "REQUIRED", "languageLevel è mancante o non è una stringa");
    } else if (!vocabulary.languageLevels.includes(rep.languageLevel)) {
      pushError(errors, `${basePath}.languageLevel`, "INVALID_CONTROLLED_VALUE", `languageLevel non valido: ${rep.languageLevel}`, { allowedValues: vocabulary.languageLevels });
    }

    if (!rep.duration || typeof rep.duration !== "string") {
      pushError(errors, `${basePath}.duration`, "REQUIRED", "duration è obbligatorio");
    } else if (!vocabulary.durationTypes.includes(rep.duration)) {
      pushError(errors, `${basePath}.duration`, "INVALID_CONTROLLED_VALUE", `duration non valida: ${rep.duration}`, { allowedValues: vocabulary.durationTypes });
    }

    if (!rep.text || typeof rep.text !== "string") {
      pushError(errors, `${basePath}.text`, "REQUIRED", "Il testo della representation è mancante o non è una stringa");
    }

    const pairKey = `${rep.languageLevel}::${rep.duration}`;
    if (rep.languageLevel && rep.duration && seenPairs.has(pairKey)) {
      pushError(errors, basePath, "DUPLICATE_REPRESENTATION", `Coppia languageLevel/duration duplicata: ${pairKey}`);
    } else {
      seenPairs.add(pairKey);
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
  if (!Array.isArray(relations)) {
    pushError(errors, "relations", "INVALID_TYPE", "relations deve essere un array");
    return;
  }

  const relationTypesById = new Map(vocabulary.relationTypes.map((rt) => [String(rt._id), rt]));

  const seenRelations = new Set();

  for (let index = 0; index < relations.length; index += 1) {
    const rel = relations[index];
    const basePath = `relations[${index}]`;

    if (!mongoose.isValidObjectId(rel.relationType)) {
      pushError(errors, `${basePath}.relationType`, "INVALID_OBJECT_ID", "relationType non è un ObjectId valido");
      continue;
    }

    const relationTypeId = String(rel.relationType);
    const relationType = relationTypesById.get(relationTypeId);

    if (!relationType) {
      pushError(errors, `${basePath}.relationType`, "INVALID_RELATION_TYPE", "Il tipo di relazione non appartiene al vocabolario del museo");
      continue;
    }

    if (Array.isArray(relationType.domain) && relationType.domain.length > 0 && !relationType.domain.includes(itemType)) {
      pushError(errors, `${basePath}.relationType`, "INVALID_DOMAIN", `La relazione ${relationType.label} non è applicabile a itemType ${itemType}`);
    }

    if (!mongoose.isValidObjectId(rel.target)) {
      pushError(errors, `${basePath}.target`, "INVALID_OBJECT_ID", "target non è un ObjectId valido");
      continue;
    }

    if (currentItemId && String(rel.target) === String(currentItemId)) {
      pushError(errors, `${basePath}.target`, "SELF_RELATION", "Un item non può essere in relazione con sé stesso");
      continue;
    }

    const targetItem = await Item.findById(rel.target).select("_id itemType museumId").lean(); //richiesta asincrona per validare gli item target della relation

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

    const duplicateKey = `${relationTypeId}::${String(rel.target)}`;
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
