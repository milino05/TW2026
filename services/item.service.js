const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getEditorVocabulary } = require("./museumVocabulary.service");
const {
  normalizeItemPayload,
  validateItemPayload,
} = require("./validation/item.validation");

async function createItem({ museumId, payload, userId = null }) {
  const vocabulary = await getEditorVocabulary(museumId);
  const normalizedPayload = normalizeItemPayload(payload);

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

  const vocabulary = await getEditorVocabulary(museumId);
  const normalizedPayload = normalizeItemPayload(payload);

  const validationErrors = await validateItemPayload({
    museumId,
    payload: normalizedPayload,
    vocabulary,
    currentItemId: itemId,
  });

  if (validationErrors.length > 0) {
    throw new AppError("Payload non valido", 400, validationErrors);
  }

  Object.assign(existingItem, normalizedPayload, {
    updatedBy: userId,
  });

  await existingItem.save();

  return existingItem;
}

async function getEditorVocabularyForClient(museumId) {
  return getEditorVocabulary(museumId);
}

module.exports = {
  createItem,
  updateItem,
  getEditorVocabularyForClient,
};
