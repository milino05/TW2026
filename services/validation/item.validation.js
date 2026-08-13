const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const ItemRevision = require("../../models/itemRevision.model");
const { validateSemanticRefs, normalizeSemanticRefs } = require("./vocabulary.validation");
const { pushError, hasOwn, trimIfString, isPlainObject, normalizeKey } = require("./validation.utils");

function normalizeRepresentation(value) {
  if (!isPlainObject(value)) return value;
  return {
    languageLevelKey: normalizeKey(value.languageLevelKey),
    durationKey: normalizeKey(value.durationKey),
    text: trimIfString(value.text),
  };
}

function normalizeSemanticFocus(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    kind: normalizeKey(value.kind),
    itemId: value.itemId || null,
    key: value.key ? normalizeKey(value.key) : null,
    scheme: value.scheme ? normalizeKey(value.scheme) : null,
    refId: trimIfString(value.refId) || null,
    weight: value.weight === undefined ? 1 : Number(value.weight),
  } : value);
}

function normalizePresentationVariants(values) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => isPlainObject(value) ? {
    key: normalizeKey(value.key),
    label: trimIfString(value.label),
    description: trimIfString(value.description),
    semanticFocus: normalizeSemanticFocus(value.semanticFocus || []),
    presentationAspects: Array.isArray(value.presentationAspects)
      ? value.presentationAspects.map((aspect) => isPlainObject(aspect) ? {
          key: normalizeKey(aspect.key),
          weight: aspect.weight === undefined ? 1 : Number(aspect.weight),
        } : aspect)
      : value.presentationAspects,
    representations: Array.isArray(value.representations)
      ? value.representations.map(normalizeRepresentation)
      : value.representations,
  } : value);
}

function normalizeItemPayload(payload = {}) {
  const normalized = {};
  ["externalId", "itemType", "label"].forEach((field) => {
    if (hasOwn(payload, field)) normalized[field] = trimIfString(payload[field]);
  });
  if (hasOwn(payload, "tags")) normalized.tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => typeof tag === "string" ? tag.trim() : tag) : payload.tags;
  if (hasOwn(payload, "recognitionImage")) normalized.recognitionImage = isPlainObject(payload.recognitionImage) ? { url: trimIfString(payload.recognitionImage.url), altText: trimIfString(payload.recognitionImage.altText) } : payload.recognitionImage;
  if (hasOwn(payload, "metadata")) normalized.metadata = isPlainObject(payload.metadata) ? { license: trimIfString(payload.metadata.license) } : payload.metadata;
  if (hasOwn(payload, "semanticRefs")) normalized.semanticRefs = normalizeSemanticRefs(payload.semanticRefs);
  if (hasOwn(payload, "jsonld")) normalized.jsonld = payload.jsonld;
  if (hasOwn(payload, "presentationVariants")) normalized.presentationVariants = normalizePresentationVariants(payload.presentationVariants);
  if (hasOwn(payload, "defaultPresentation")) normalized.defaultPresentation = isPlainObject(payload.defaultPresentation) ? {
    variantKey: normalizeKey(payload.defaultPresentation.variantKey),
    durationKey: normalizeKey(payload.defaultPresentation.durationKey),
    languageLevelKey: normalizeKey(payload.defaultPresentation.languageLevelKey),
  } : payload.defaultPresentation;
  if (hasOwn(payload, "relations")) normalized.relations = Array.isArray(payload.relations)
    ? payload.relations.map((relation) => isPlainObject(relation) ? {
        relationTypeKey: normalizeKey(relation.relationTypeKey),
        target: relation.target,
        weight: relation.weight === undefined ? 1 : Number(relation.weight),
      } : relation)
    : payload.relations;
  return normalized;
}

function validateRepresentationArray(representations, vocabulary, errors, field) {
  if (!Array.isArray(representations)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }
  const languages = new Set(vocabulary.languageLevels.map((entry) => entry.key));
  const durations = new Set(vocabulary.durationTypes.map((entry) => entry.key));
  const pairs = new Set();
  representations.forEach((representation, index) => {
    const path = `${field}[${index}]`;
    if (!isPlainObject(representation)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni representation deve essere un oggetto");
      return;
    }
    if (hasOwn(representation, "isDefault")) pushError(errors, `${path}.isDefault`, "REMOVED_FIELD", "isDefault non e supportato: usare ItemRevision.defaultPresentation");
    if (!languages.has(representation.languageLevelKey)) pushError(errors, `${path}.languageLevelKey`, "INVALID_CONTROLLED_VALUE", "languageLevelKey non appartiene al vocabolario", { allowedValues: [...languages] });
    if (!durations.has(representation.durationKey)) pushError(errors, `${path}.durationKey`, "INVALID_CONTROLLED_VALUE", "durationKey non appartiene al vocabolario", { allowedValues: [...durations] });
    if (!representation.text || typeof representation.text !== "string") pushError(errors, `${path}.text`, "REQUIRED", "Il testo e obbligatorio");
    const pair = `${representation.languageLevelKey}::${representation.durationKey}`;
    if (pairs.has(pair)) pushError(errors, path, "DUPLICATE_REPRESENTATION", `Coppia duplicata nella stessa variante: ${pair}`);
    pairs.add(pair);
  });
}

async function validatePresentationVariants({ museumId, variants, defaultPresentation, vocabulary, errors, requireDefault = false, requirePublishedTargets = false }) {
  if (!Array.isArray(variants)) {
    pushError(errors, "presentationVariants", "INVALID_TYPE", "presentationVariants deve essere un array");
    return;
  }
  const aspectKeys = new Set((vocabulary.presentationAspects || []).map((entry) => entry.key));
  const relationKeys = new Set((vocabulary.relationTypes || []).map((entry) => entry.key));
  const itemTypeKeys = new Set(vocabulary.itemTypes || []);
  const variantKeys = new Set();
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const path = `presentationVariants[${index}]`;
    if (!isPlainObject(variant)) {
      pushError(errors, path, "INVALID_TYPE", "Ogni variante deve essere un oggetto");
      continue;
    }
    if (!variant.key) pushError(errors, `${path}.key`, "REQUIRED", "key e obbligatoria");
    else if (variantKeys.has(variant.key)) pushError(errors, `${path}.key`, "DUPLICATE_KEY", `variant key duplicata: ${variant.key}`);
    else variantKeys.add(variant.key);
    if (!variant.label) pushError(errors, `${path}.label`, "REQUIRED", "label e obbligatoria");
    validateRepresentationArray(variant.representations || [], vocabulary, errors, `${path}.representations`);
    if (!Array.isArray(variant.representations) || !variant.representations.length) pushError(errors, `${path}.representations`, "EMPTY_ARRAY", "Ogni variante deve contenere almeno una representation");
    const aspectSeen = new Set();
    for (let a = 0; a < (variant.presentationAspects || []).length; a += 1) {
      const aspect = variant.presentationAspects[a];
      const aspectPath = `${path}.presentationAspects[${a}]`;
      if (!isPlainObject(aspect) || !aspect.key) {
        pushError(errors, aspectPath, "INVALID_TYPE", "PresentationAspect non valido");
        continue;
      }
      if (!aspectKeys.has(aspect.key)) pushError(errors, `${aspectPath}.key`, "UNKNOWN_PRESENTATION_ASPECT", `PresentationAspect non presente nel vocabolario: ${aspect.key}`);
      if (aspectSeen.has(aspect.key)) pushError(errors, `${aspectPath}.key`, "DUPLICATE_KEY", "PresentationAspect duplicato nella variante");
      aspectSeen.add(aspect.key);
      if (!Number.isFinite(aspect.weight) || aspect.weight < 0 || aspect.weight > 1) pushError(errors, `${aspectPath}.weight`, "INVALID_NUMBER", "weight deve essere tra 0 e 1");
    }
    for (let f = 0; f < (variant.semanticFocus || []).length; f += 1) {
      const focus = variant.semanticFocus[f];
      const focusPath = `${path}.semanticFocus[${f}]`;
      if (!isPlainObject(focus) || !["item", "relation_type", "item_type", "canonical"].includes(focus.kind)) {
        pushError(errors, focusPath, "INVALID_SEMANTIC_FOCUS", "semanticFocus non valido");
        continue;
      }
      if (!Number.isFinite(focus.weight) || focus.weight < 0 || focus.weight > 1) pushError(errors, `${focusPath}.weight`, "INVALID_NUMBER", "weight deve essere tra 0 e 1");
      if (focus.kind === "relation_type" && !relationKeys.has(focus.key)) pushError(errors, `${focusPath}.key`, "UNKNOWN_RELATION_TYPE", `relationType non presente nel vocabolario: ${focus.key}`);
      if (focus.kind === "item_type" && !itemTypeKeys.has(focus.key)) pushError(errors, `${focusPath}.key`, "UNKNOWN_ITEM_TYPE", `itemType non presente nel vocabolario: ${focus.key}`);
      if (focus.kind === "canonical" && (!focus.scheme || !focus.refId)) pushError(errors, focusPath, "SEMANTIC_REF_REQUIRED", "semanticFocus canonical richiede scheme e refId");
      if (focus.kind === "item") {
        if (!mongoose.isValidObjectId(focus.itemId)) {
          pushError(errors, `${focusPath}.itemId`, "INVALID_OBJECT_ID", "itemId non valido");
          continue;
        }
        const target = await Item.findOne({ _id: focus.itemId, museumId, lifecycleStatus: "active" }).lean();
        if (!target) pushError(errors, `${focusPath}.itemId`, "TARGET_NOT_FOUND", "L'Item di semanticFocus non appartiene al museo o non esiste");
        else if (requirePublishedTargets && !target.publishedRevisionId) pushError(errors, `${focusPath}.itemId`, "TARGET_NOT_PUBLISHED", "L'Item di semanticFocus deve essere pubblicato");
      }
    }
  }
  if (requireDefault) {
    if (!isPlainObject(defaultPresentation)) pushError(errors, "defaultPresentation", "DEFAULT_REQUIRED", "defaultPresentation e obbligatoria");
    else {
      const variant = variants.find((entry) => entry?.key === defaultPresentation.variantKey);
      if (!variant) pushError(errors, "defaultPresentation.variantKey", "UNKNOWN_VARIANT", "variantKey di default non esiste");
      else if (!(variant.representations || []).some((entry) => entry.durationKey === defaultPresentation.durationKey && entry.languageLevelKey === defaultPresentation.languageLevelKey)) pushError(errors, "defaultPresentation", "DEFAULT_REPRESENTATION_NOT_FOUND", "La representation di default non esiste nella variante indicata");
    }
  }
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
    if (type.domain?.length && !type.domain.includes(itemType)) pushError(errors, `${path}.relationTypeKey`, "INVALID_DOMAIN", `La relazione non e applicabile a ${itemType}`);
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
    if (String(target.museumId) !== String(museumId)) pushError(errors, `${path}.target`, "CROSS_MUSEUM_TARGET", "Il target appartiene a un museo diverso");
    if (type.range?.length && !type.range.includes(target.itemType)) pushError(errors, `${path}.target`, "INVALID_RANGE", `Il target di tipo ${target.itemType} non e compatibile`);
    if (requirePublishedTargets) {
      if (!target.publishedRevisionId) pushError(errors, `${path}.target`, "TARGET_NOT_PUBLISHED", "L'item target non ha una revisione pubblicata");
      else {
        const targetRevision = await ItemRevision.findById(target.publishedRevisionId).select("_id status integrity.status").lean();
        if (!targetRevision || targetRevision.status !== "published" || targetRevision.integrity?.status !== "valid") pushError(errors, `${path}.target`, "TARGET_NOT_AVAILABLE", "La revisione pubblicata del target non e disponibile o integra");
      }
    }
    const duplicate = `${relation.relationTypeKey}::${String(relation.target)}`;
    if (seen.has(duplicate)) pushError(errors, path, "DUPLICATE_RELATION", "Relazione duplicata");
    seen.add(duplicate);
    const count = counts.get(relation.relationTypeKey) || 0;
    if (type.validationRules?.allowMultiple === false && count >= 1) pushError(errors, path, "MULTIPLE_RELATIONS_NOT_ALLOWED", "Il tipo di relazione ammette un solo target");
    counts.set(relation.relationTypeKey, count + 1);
    if (!Number.isFinite(relation.weight) || relation.weight < 0 || relation.weight > 10) pushError(errors, `${path}.weight`, "INVALID_NUMBER", "weight deve essere compreso tra 0 e 10");
  }
}

async function validateItemDraftPayload({ museumId, itemId = null, itemType, payload, vocabulary, mode }) {
  const errors = [];
  if (hasOwn(payload, "representations")) pushError(errors, "representations", "REMOVED_FIELD", "representations non e piu un campo diretto: usare presentationVariants");
  if (mode === "create" || hasOwn(payload, "itemType")) {
    const effectiveType = payload.itemType || itemType;
    if (!effectiveType || !vocabulary.itemTypes.includes(effectiveType)) pushError(errors, "itemType", "INVALID_CONTROLLED_VALUE", "itemType non valido", { allowedValues: vocabulary.itemTypes });
  }
  if (mode === "create" || hasOwn(payload, "label")) {
    if (!payload.label || typeof payload.label !== "string") pushError(errors, "label", "REQUIRED", "label e obbligatoria");
  }
  if (hasOwn(payload, "tags") && !Array.isArray(payload.tags)) pushError(errors, "tags", "INVALID_TYPE", "tags deve essere un array");
  if (hasOwn(payload, "semanticRefs")) validateSemanticRefs(payload.semanticRefs, "semanticRefs", errors);
  if (hasOwn(payload, "presentationVariants")) await validatePresentationVariants({ museumId, variants: payload.presentationVariants, defaultPresentation: payload.defaultPresentation, vocabulary, errors, requireDefault: false });
  if (hasOwn(payload, "relations")) await validateRelations({ museumId, itemType: payload.itemType || itemType, itemId, relations: payload.relations, vocabulary, errors });
  return errors;
}

module.exports = {
  normalizeItemPayload,
  validatePresentationVariants,
  validateRelations,
  validateItemDraftPayload,
};
