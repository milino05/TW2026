const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemDraftPayload } = require("./validation/item.validation");
const { applyRelationCommands } = require("./itemRelations.service");
const { invalidateVisitsUsingItem } = require("./visitDependency.service");

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
        message: "Lo stato editoriale si modifica soltanto tramite le operazioni dedicate",
      },
    ]);
  }
}

function markAsDraftNeedingReview(item, userId = null, issues = []) {
  if (item.status !== "archived") item.status = "draft";

  item.integrity = {
    status: "needs_review",
    issues,
  };

  if (userId !== null) item.updatedBy = userId;
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
  return { itemPayload, relationCommands };
}

function buildMergedPayload(existingItem, rawPayload, normalizedPayload) {
  const fields = [
    "externalId",
    "itemType",
    "label",
    "tags",
    "recognitionImage",
    "metadata",
    "jsonld",
    "representations",
    "relations",
  ];

  return fields.reduce((merged, field) => {
    merged[field] = hasOwn(rawPayload, field) ? normalizedPayload[field] : existingItem[field];
    return merged;
  }, {});
}

async function saveUniqueItems(items) {
  const itemsById = new Map();
  items.filter(Boolean).forEach((item) => itemsById.set(String(item._id), item));

  for (const item of itemsById.values()) {
    await item.save();
  }

  return Array.from(itemsById.values());
}

async function invalidateVisitsForChangedItems(items, code = "ITEM_CHANGED") {
  for (const item of items) {
    await invalidateVisitsUsingItem({
      itemId: item._id,
      code,
      message: "Un item usato dalla visita e cambiato e deve essere ricontrollato",
      context: { itemLabel: item.label },
    });
  }
}

async function findItemByIdInMuseumOrFail({ museumId, itemId }) {
  const item = await Item.findOne({ _id: itemId, museumId });
  if (!item) throw new AppError("Item non trovato", 404);
  return item;
}

async function createItem({ museumId, payload, userId = null }) {
  rejectStatusInPayload(payload);

  const vocabulary = await getMuseumVocabulary(museumId);
  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);
  const normalizedPayload = normalizeItemPayload(itemPayload);
  const validationErrors = await validateItemDraftPayload({
    museumId,
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
    integrity: { status: "needs_review", issues: [] },
    createdBy: userId,
    updatedBy: userId,
  });

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: item,
    relationCommands,
    vocabulary,
  });

  touchedItems.forEach((touchedItem) => {
    if (!sameId(touchedItem._id, item._id)) {
      markAsDraftNeedingReview(touchedItem, userId);
    }
  });

  const savedItems = await saveUniqueItems([item, ...touchedItems]);
  await invalidateVisitsForChangedItems(savedItems.filter((savedItem) => !sameId(savedItem._id, item._id)));

  return item;
}

async function updateItem({ museumId, itemId, payload, userId = null }) {
  rejectStatusInPayload(payload);

  const existingItem = await findItemByIdInMuseumOrFail({ museumId, itemId });
  const vocabulary = await getMuseumVocabulary(museumId);
  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);
  const normalizedPayload = normalizeItemPayload(itemPayload);
  const validationErrors = await validateItemDraftPayload({
    museumId,
    payload: normalizedPayload,
    vocabulary,
    mode: "update",
    existingItem,
    currentItemId: itemId,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  Object.assign(existingItem, buildMergedPayload(existingItem.toObject(), itemPayload, normalizedPayload), {
    updatedBy: userId,
  });
  markAsDraftNeedingReview(existingItem, userId);

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: existingItem,
    relationCommands,
    vocabulary,
  });
  touchedItems.forEach((touchedItem) => markAsDraftNeedingReview(touchedItem, userId));

  const savedItems = await saveUniqueItems([existingItem, ...touchedItems]);
  await invalidateVisitsForChangedItems(savedItems);

  return existingItem;
}

async function listItems({ museumId, filters = {} }) {
  const query = { museumId };
  if (filters.itemType) query.itemType = filters.itemType;
  if (filters.status) query.status = filters.status;
  if (filters.integrity) query["integrity.status"] = filters.integrity;

  return Item.find(query).sort({ updatedAt: -1, label: 1 });
}

async function getItemById({ museumId, itemId }) {
  return findItemByIdInMuseumOrFail({ museumId, itemId });
}

async function findItemsTargetingItem({ museumId, targetItemId }) {
  return Item.find({ museumId, "relations.target": targetItemId });
}

function buildDeletedTargetIntegrityIssues({ sourceItem, deletedItem }) {
  return (sourceItem.relations || [])
    .map((relation, index) => ({ relation, index }))
    .filter(({ relation }) => sameId(relation.target, deletedItem._id))
    .map(({ relation, index }) => ({
      field: `relations[${index}].target`,
      code: "RELATION_TARGET_DELETED",
      message: `La relazione punta a un item eliminato: ${deletedItem.label}`,
      context: {
        deletedItemId: deletedItem._id,
        deletedItemLabel: deletedItem.label,
        relationTypeKey: relation.relationTypeKey,
        relationId: relation._id,
      },
    }));
}

async function deleteItem({ museumId, itemId, userId = null }) {
  const item = await findItemByIdInMuseumOrFail({ museumId, itemId });
  const affectedItems = await findItemsTargetingItem({ museumId, targetItemId: item._id });

  affectedItems.forEach((affectedItem) => {
    const existingIssues = Array.isArray(affectedItem.integrity?.issues) ? affectedItem.integrity.issues : [];
    markAsDraftNeedingReview(
      affectedItem,
      userId,
      [...existingIssues, ...buildDeletedTargetIntegrityIssues({ sourceItem: affectedItem, deletedItem: item })],
    );
  });

  await saveUniqueItems(affectedItems);
  await invalidateVisitsForChangedItems(affectedItems);
  await invalidateVisitsUsingItem({
    itemId: item._id,
    code: "VISIT_ITEM_DELETED",
    message: "Un item della visita e stato eliminato",
    context: { itemLabel: item.label },
  });

  await item.deleteOne();

  return { item, affectedItemsCount: affectedItems.length };
}

module.exports = {
  createItem,
  updateItem,
  listItems,
  getItemById,
  deleteItem,
};
