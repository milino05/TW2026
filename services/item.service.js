const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemDraftPayload } = require("./validation/item.validation");
const { applyRelationCommands } = require("./itemRelations.service");

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function sameId(a, b) {
  return String(a) === String(b);
}

function rejectStatusInPayload(payload = {}) {
  if (hasOwn(payload, "status")) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "status",
        code: "FORBIDDEN_FIELD",
        message: "Lo stato editoriale non può essere modificato tramite create/update. Usa la route dedicata di pubblicazione.",
      },
    ]);
  }
}

function markAsDraftNeedingReview(item, userId = null, issues = []) {
  if (item.status !== "archived") {
    item.status = "draft";
  }

  item.integrity = {
    status: "needs_review",
    issues,
  };

  if (userId !== null) {
    item.updatedBy = userId;
  }
}

function splitItemPayloadAndRelationCommands(payload = {}) {
  const hasRelations = hasOwn(payload, "relations");
  const hasRelationCommands = hasOwn(payload, "relationCommands");

  if (hasRelations && hasRelationCommands) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "relationCommands",
        code: "AMBIGUOUS_RELATION_UPDATE",
        message: "Non puoi usare relations e relationCommands nella stessa richiesta",
      },
    ]);
  }

  const { relationCommands, ...itemPayload } = payload;

  return {
    itemPayload,
    relationCommands,
  };
}

function buildMergedPayload(existingItem, rawPayload, normalizedPayload) {
  return {
    externalId: hasOwn(rawPayload, "externalId") ? normalizedPayload.externalId : existingItem.externalId,

    itemType: hasOwn(rawPayload, "itemType") ? normalizedPayload.itemType : existingItem.itemType,

    label: hasOwn(rawPayload, "label") ? normalizedPayload.label : existingItem.label,

    tags: hasOwn(rawPayload, "tags") ? normalizedPayload.tags : existingItem.tags,

    recognitionImage: hasOwn(rawPayload, "recognitionImage") ? normalizedPayload.recognitionImage : existingItem.recognitionImage,

    metadata: hasOwn(rawPayload, "metadata") ? normalizedPayload.metadata : existingItem.metadata,

    jsonld: hasOwn(rawPayload, "jsonld") ? normalizedPayload.jsonld : existingItem.jsonld,

    representations: hasOwn(rawPayload, "representations") ? normalizedPayload.representations : existingItem.representations,

    relations: hasOwn(rawPayload, "relations") ? normalizedPayload.relations : existingItem.relations,
  };
}

async function saveUniqueItems(items) {
  const itemsById = new Map();

  items.filter(Boolean).forEach((item) => {
    itemsById.set(String(item._id), item);
  });

  for (const item of itemsById.values()) {
    await item.save();
  }
}

async function findItemByIdInMuseumOrFail({ museumId, itemId }) {
  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

  return item;
}

async function createItem({ museumId, payload, userId = null }) {
  rejectStatusInPayload(payload);

  const vocabulary = await getMuseumVocabulary(museumId);

  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);

  const normalizedPayload = normalizeItemPayload(itemPayload);

  const validationErrors = await validateItemDraftPayload({
    payload: normalizedPayload,
    vocabulary,
    mode: "create",
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  const item = new Item({
    ...normalizedPayload,
    museumId,
    status: "draft",
    integrity: {
      status: "needs_review",
      issues: [],
    },
    createdBy: userId,
    updatedBy: userId,
  });

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: item,
    relationCommands,
    vocabulary,
  });

  //PERCHÉ MARCHIARE TUTTI GLI ITEM TOCCATI DALLE RELATION COMMANDS CON NEEDING REVIEW
  touchedItems.forEach((touchedItem) => {
    if (String(touchedItem._id) !== String(item._id)) {
      markAsDraftNeedingReview(touchedItem, userId);
    }
  });

  await saveUniqueItems([item, ...touchedItems]);

  return item;
}

async function updateItem({ museumId, itemId, payload, userId = null }) {
  rejectStatusInPayload(payload);

  const existingItem = await findItemByIdInMuseumOrFail({
    museumId,
    itemId,
  });

  const vocabulary = await getMuseumVocabulary(museumId);

  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);

  const normalizedPayload = normalizeItemPayload(itemPayload);

  const validationErrors = await validateItemDraftPayload({
    payload: normalizedPayload,
    vocabulary,
    mode: "update",
    existingItem,
    currentItemId: itemId,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  const mergedPayload = buildMergedPayload(existingItem.toObject(), itemPayload, normalizedPayload);

  Object.assign(existingItem, mergedPayload, {
    updatedBy: userId,
  });

  markAsDraftNeedingReview(existingItem, userId);

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: existingItem,
    relationCommands,
    vocabulary,
  });

  touchedItems.forEach((touchedItem) => {
    markAsDraftNeedingReview(touchedItem, userId);
  });

  await saveUniqueItems([existingItem, ...touchedItems]);

  return existingItem;
}

async function listItems({ museumId, filters = {} }) {
  const query = { museumId };

  if (filters.itemType) {
    query.itemType = filters.itemType;
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.integrity) {
    query["integrity.status"] = filters.integrity;
  }

  return Item.find(query).sort({ updatedAt: -1, label: 1 });
}

async function getItemById({ museumId, itemId }) {
  return findItemByIdInMuseumOrFail({ museumId, itemId });
}

async function findItemsTargetingItem({ museumId, targetItemId }) {
  return Item.find({
    museumId,
    "relations.target": targetItemId,
  });
}

function buildDeletedTargetIntegrityIssues({ sourceItem, deletedItem }) {
  const relations = Array.isArray(sourceItem.relations) ? sourceItem.relations : [];

  return relations
    .map((relation, index) => ({
      relation,
      index,
    }))
    .filter(({ relation }) => sameId(relation.target, deletedItem._id)) //prende le relation del sourceItem e tiene solo quelle che hanno come target l'item eliminato
    .map(({ relation, index }) => ({
      field: `relations[${index}].target`,
      code: "RELATION_TARGET_DELETED",
      message: `La relazione punta a un item eliminato: ${deletedItem.label}`,
      context: {
        deletedItemId: deletedItem._id,
        deletedItemLabel: deletedItem.label,
        deletedItemType: deletedItem.itemType,
        deletedItemExternalId: deletedItem.externalId || null,
        relationTypeKey: relation.relationTypeKey,
        relationId: relation._id,
        relationWeight: relation.weight,
      },
    }));
}

async function deleteItem({ museumId, itemId, userId = null }) {
  const item = await findItemByIdInMuseumOrFail({ museumId, itemId });

  const affectedItems = await findItemsTargetingItem({
    museumId,
    targetItemId: item._id,
  });

  affectedItems.forEach((affectedItem) => {
    const deletionIssues = buildDeletedTargetIntegrityIssues({
      sourceItem: affectedItem,
      deletedItem: item,
    });

    const existingIssues = Array.isArray(affectedItem.integrity?.issues)
      ? affectedItem.integrity.issues
      : [];

    markAsDraftNeedingReview(affectedItem, userId, [
      ...existingIssues,
      ...deletionIssues,
    ]);
  });

  await saveUniqueItems(affectedItems);

  await item.deleteOne();

  return {
    item,
    affectedItemsCount: affectedItems.length,
  };
}

module.exports = {
  createItem,
  updateItem,
  listItems,
  getItemById,
  deleteItem,
};
