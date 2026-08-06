const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
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
      ? payload.representations.map((representation) =>
          isPlainObject(representation)
            ? {
                languageLevelKey: normalizeKey(representation.languageLevelKey),
                durationKey: normalizeKey(representation.durationKey),
                text: trimIfString(representation.text),
                isDefault: normalizeBoolean(representation.isDefault) === true,
              }
            : representation,
        )
      : payload.representations;
  }
  if (hasOwn(payload, "relations")) {
    normalized.relations = Array.isArray(payload.relations)
      ? payload.relations.map((relation) =>
          isPlainObject(relation)
            ? {
                relationTypeKey: normalizeKey(relation.relationTypeKey),
                target: relation.target,
                weight: relation.weight === undefined ? 1 : Number(relation.weight),
              }
            : relation,
        )
      : payload.relations;
  }
  return normalized;
}

function validateRepresentations(representations, vocabulary, errors, { requireDefault = false } = {}) {
  if (!Array.isArray(representations)) {
    pushError(errors, "representations", "INVALID_TYPE", "representations deve essere un array");
    return;
  }
  const languages = new Set(vocabulary.languageLevels.map((entry) => entry.key));
  const durations = new Set(vocabulary.durationTypes.map((entry) => entry.key));
  const pairs = new Set();
  let defaultCount = 0;
  representations.forEach((representation, index) => {
    const path = `representations[${index}]`;
    if (!isPlainObject(representation)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni representation deve essere un oggetto");
      return;
    }
    if (!languages.has(representation.languageLevelKey)) {
      pushError(errors, `${path}.languageLevelKey`, "INVALID_CONTROLLED_VALUE", "languageLevelKey non appartiene al vocabolario", { allowedValues: Array.from(languages) });
    }
    if (!durations.has(representation.durationKey)) {
      pushError(errors, `${path}.durationKey`, "INVALID_CONTROLLED_VALUE", "durationKey non appartiene al vocabolario", { allowedValues: Array.from(durations) });
    }
    if (!representation.text || typeof representation.text !== "string") {
      pushError(errors, `${path}.text`, "REQUIRED", "Il testo e obbligatorio");
    }
    const pair = `${representation.languageLevelKey}::${representation.durationKey}`;
    if (pairs.has(pair)) pushError(errors, path, "DUPLICATE_REPRESENTATION", `Coppia duplicata: ${pair}`);
    pairs.add(pair);
    if (representation.isDefault) defaultCount += 1;
  });
  if (defaultCount > 1) pushError(errors, "representations", "MULTIPLE_DEFAULTS", "E consentita una sola representation di default");
  if (requireDefault && defaultCount !== 1) pushError(errors, "representations", "DEFAULT_REQUIRED", "Per pubblicare e richiesta esattamente una representation di default");
}

async function validateRelations({ museumId, itemType, itemId, relations, vocabulary, errors, requirePublishedTargets = false }) {
  if (!Array.isArray(relations)) {
    pushError(errors, "relations", "INVALID_TYPE", "relations deve essere un array");
    return;
  }
  const types = new Map(vocabulary.relationTypes.map((entry) => [entry.key, entry]));
  const seen = new Set();
  const counts = new Map();
  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index];
    const path = `relations[${index}]`;
    if (!isPlainObject(relation)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni relation deve essere un oggetto");
      continue;
    }
    const type = types.get(relation.relationTypeKey);
    if (!type) {
      pushError(errors, `${path}.relationTypeKey`, "INVALID_RELATION_TYPE", "relationTypeKey non valida");
      continue;
    }
    if (type.domain?.length && !type.domain.includes(itemType)) {
      pushError(errors, `${path}.relationTypeKey`, "INVALID_DOMAIN", `La relazione non e applicabile a ${itemType}`);
    }
    if (!mongoose.isValidObjectId(relation.target)) {
      pushError(errors, `${path}.target`, "INVALID_OBJECT_ID", "target deve essere un ObjectId valido");
      continue;
    }
    if (String(relation.target) === String(itemId)) {
      pushError(errors, `${path}.target`, "SELF_RELATION", "Un item non puo riferirsi a se stesso");
      continue;
    }
    const target = await Item.findOne({ _id: relation.target, lifecycleStatus: "active" }).lean();
    if (!target) {
      pushError(errors, `${path}.target`, "TARGET_NOT_FOUND", "L'item target non esiste o e nel cestino");
      continue;
    }
    if (String(target.museumId) !== String(museumId)) {
      pushError(errors, `${path}.target`, "CROSS_MUSEUM_TARGET", "Il target appartiene a un museo diverso");
    }
    if (type.range?.length && !type.range.includes(target.itemType)) {
      pushError(errors, `${path}.target`, "INVALID_RANGE", `Il target di tipo ${target.itemType} non e compatibile`);
    }
    if (requirePublishedTargets) {
      if (!target.publishedRevisionId) {
        pushError(errors, `${path}.target`, "TARGET_NOT_PUBLISHED", "L'item target non ha una revisione pubblicata");
      } else {
        const targetRevision = await ItemRevision.findById(target.publishedRevisionId)
          .select("_id status integrity.status")
          .lean();
        if (!targetRevision || targetRevision.status !== "published" || targetRevision.integrity?.status !== "valid") {
          pushError(errors, `${path}.target`, "TARGET_NOT_AVAILABLE", "La revisione pubblicata del target non e disponibile o integra");
        }
      }
    }
    const duplicate = `${relation.relationTypeKey}::${String(relation.target)}`;
    if (seen.has(duplicate)) pushError(errors, path, "DUPLICATE_RELATION", "Relazione duplicata");
    seen.add(duplicate);
    const count = counts.get(relation.relationTypeKey) || 0;
    if (type.validationRules?.allowMultiple === false && count >= 1) {
      pushError(errors, path, "MULTIPLE_RELATIONS_NOT_ALLOWED", "Il tipo di relazione ammette un solo target");
    }
    counts.set(relation.relationTypeKey, count + 1);
    if (!Number.isFinite(relation.weight) || relation.weight < 0 || relation.weight > 10) {
      pushError(errors, `${path}.weight`, "INVALID_NUMBER", "weight deve essere compreso tra 0 e 10");
    }
  }
}

async function validateItemDraftPayload({ museumId, itemId = null, itemType, payload, vocabulary, mode }) {
  const errors = [];
  if (mode === "create" || hasOwn(payload, "itemType")) {
    const effectiveType = payload.itemType || itemType;
    if (!effectiveType || !vocabulary.itemTypes.includes(effectiveType)) {
      pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", "itemType non valido", { allowedValues: vocabulary.itemTypes });
    }
  }
  if (mode === "create" || hasOwn(payload, "label")) {
    if (!payload.label || typeof payload.label !== "string") pushError(errors, "label", "REQUIRED", "label e obbligatoria");
  }
  if (hasOwn(payload, "tags") && !Array.isArray(payload.tags)) pushError(errors, "tags", "INVALID_TYPE", "tags deve essere un array");
  if (hasOwn(payload, "representations")) validateRepresentations(payload.representations, vocabulary, errors);
  if (hasOwn(payload, "relations")) {
    await validateRelations({ museumId, itemType: payload.itemType || itemType, itemId, relations: payload.relations, vocabulary, errors });
  }
  return errors;
}

module.exports = {
  normalizeItemPayload,
  validateItemDraftPayload,
  validateRepresentations,
  validateRelations,
};
