const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemPayload } = require("./validation/item.validation");
const { applyRelationCommands } = require("./itemRelations.service");

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

    status: hasOwn(rawPayload, "status") ? normalizedPayload.status : existingItem.status,

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
  const vocabulary = await getMuseumVocabulary(museumId);

  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);

  const normalizedPayload = normalizeItemPayload(itemPayload);

  const validationErrors = await validateItemPayload({
    museumId,
    payload: normalizedPayload,
    vocabulary,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  const item = new Item({
    ...normalizedPayload,
    museumId,
    createdBy: userId,
    updatedBy: userId,
  });

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: item,
    relationCommands,
    vocabulary,
  });

  await saveUniqueItems([item, ...touchedItems]);

  return item;
}

async function updateItem({ museumId, itemId, payload, userId = null }) {
  const existingItem = await findItemByIdInMuseumOrFail({
    museumId,
    itemId,
  });

  const vocabulary = await getMuseumVocabulary(museumId);

  const { itemPayload, relationCommands } = splitItemPayloadAndRelationCommands(payload);

  const normalizedPayload = normalizeItemPayload(itemPayload);

  const mergedPayload = buildMergedPayload(existingItem.toObject(), itemPayload, normalizedPayload);

  const validationErrors = await validateItemPayload({
    museumId,
    payload: mergedPayload,
    vocabulary,
    currentItemId: itemId,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  Object.assign(existingItem, mergedPayload, {
    updatedBy: userId,
  });

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: existingItem,
    relationCommands,
    vocabulary,
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

  return Item.find(query).sort({ updatedAt: -1, label: 1 });
}

async function getItemById({ museumId, itemId }) {
  return findItemByIdInMuseumOrFail({ museumId, itemId });
}

async function deleteItem({ museumId, itemId }) {
  const item = await findItemByIdInMuseumOrFail({ museumId, itemId });

  await item.deleteOne();

  return item;
}

module.exports = {
  createItem,
  updateItem,
  listItems,
  getItemById,
  deleteItem,
};
