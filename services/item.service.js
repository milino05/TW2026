const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemPayload, toSlug } = require("./validation/item.validation");

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

//PER ES: DISTINGUE CASO IN CUI NELLA RICHIESTA NON CI SIA UN CAMPO A QUANDO SI VUOLE RESETTARE IL CAMPO
function buildMergedPayload(existingItem, rawPayload, normalizedPayload) {
  const mergedPayload = {
    externalId: hasOwn(rawPayload, "externalId") ? normalizedPayload.externalId : existingItem.externalId,
    itemType: hasOwn(rawPayload, "itemType") ? normalizedPayload.itemType : existingItem.itemType,
    label: hasOwn(rawPayload, "label") ? normalizedPayload.label : existingItem.label,
    slug: hasOwn(rawPayload, "slug") ? normalizedPayload.slug : existingItem.slug,
    tags: hasOwn(rawPayload, "tags") ? normalizedPayload.tags : existingItem.tags,
    status: hasOwn(rawPayload, "status") ? normalizedPayload.status : existingItem.status,
    recognitionImage: hasOwn(rawPayload, "recognitionImage") ? normalizedPayload.recognitionImage : existingItem.recognitionImage,
    metadata: hasOwn(rawPayload, "metadata") ? normalizedPayload.metadata : existingItem.metadata,
    jsonld: hasOwn(rawPayload, "jsonld") ? normalizedPayload.jsonld : existingItem.jsonld,
    representations: hasOwn(rawPayload, "representations") ? normalizedPayload.representations : existingItem.representations,
    relations: hasOwn(rawPayload, "relations") ? normalizedPayload.relations : existingItem.relations,
  };

  return mergedPayload;
}

async function ensureUniqueSlug({ museumId, slug, currentItemId = null }) {
  const query = { museumId, slug };

  if (currentItemId) {
    query._id = { $ne: currentItemId };
  }

  const conflictingItem = await Item.findOne(query).select("_id slug label museumId").lean();

  if (conflictingItem) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "slug",
        code: "DUPLICATE_SLUG",
        message: `Esiste già un item con slug ${slug} in questo museo`,
      },
    ]);
  }
}

async function createItem({ museumId, payload, userId = null }) {
  const vocabulary = await getMuseumVocabulary(museumId);
  const normalizedPayload = normalizeItemPayload(payload);

  if (!normalizedPayload.slug && normalizedPayload.label) {
    normalizedPayload.slug = toSlug(normalizedPayload.label);
  }

  const validationErrors = await validateItemPayload({
    museumId,
    payload: normalizedPayload,
    vocabulary,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  await ensureUniqueSlug({ museumId, slug: normalizedPayload.slug });
  const item = new Item({
    ...normalizedPayload,
    museumId,
    createdBy: userId,
    updatedBy: userId,
  });

  await item.save();

  return item;
}

async function updateItem({ museumId, itemId, payload, userId = null }) {
  const existingItem = await Item.findById(itemId);

  if (!existingItem) {
    throw new AppError("Item non trovato", 404);
  }

  if (String(existingItem.museumId) !== String(museumId)) {
    throw new AppError("Item non appartenente al museo corrente", 400);
  }

  const vocabulary = await getMuseumVocabulary(museumId);
  const normalizedPayload = normalizeItemPayload(payload);
  const mergedPayload = buildMergedPayload(existingItem.toObject(), payload, normalizedPayload);

  const validationErrors = await validateItemPayload({
    museumId,
    payload: mergedPayload,
    vocabulary,
    currentItemId: itemId,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  await ensureUniqueSlug({ museumId, slug: mergedPayload.slug, currentItemId: itemId });
  Object.assign(existingItem, mergedPayload, {
    updatedBy: userId,
  });

  await existingItem.save();

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
  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

  return item;
}

async function deleteItem({ museumId, itemId }) {
  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

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
