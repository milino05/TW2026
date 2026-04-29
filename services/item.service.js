const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemPayload } = require("./validation/item.validation");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");

function issueSignature(issue) {
  return JSON.stringify({
    code: issue.code,
    field: issue.field,
    context: issue.context || {},
  });
}

function findNewIssues(beforeIssues, afterIssues) {
  const beforeIssueSignatures = new Set(
    beforeIssues.map(issueSignature),
  );

  return afterIssues.filter((issue) => {
    return !beforeIssueSignatures.has(issueSignature(issue));
  });
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

//PER ES: DISTINGUE CASO IN CUI NELLA RICHIESTA NON CI SIA UN CAMPO A QUANDO SI VUOLE RESETTARE IL CAMPO
function buildMergedPayload(existingItem, rawPayload, normalizedPayload) {
  const mergedPayload = {
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

  return mergedPayload;
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
  const existingItem = await findItemByIdInMuseumOrFail({ museumId, itemId });

  const vocabulary = await getMuseumVocabulary(museumId);
  const normalizedPayload = normalizeItemPayload(payload);

  const mergedPayload = buildMergedPayload(
    existingItem.toObject(),
    payload,
    normalizedPayload,
  );

  const itemAfterUpdateForIntegrityCheck = {
    ...mergedPayload,
    _id: existingItem._id,
    museumId: existingItem.museumId,
  };

  const beforeIssues = Array.isArray(existingItem.integrity?.issues)
    ? existingItem.integrity.issues
    : [];

  const afterIssues = await computeItemIntegrityIssues({
    item: itemAfterUpdateForIntegrityCheck,
    museumId,
    vocabulary,
  });

  const newIssues = findNewIssues(beforeIssues, afterIssues);

  if (newIssues.length > 0) {
    throw new AppError(
      "La modifica introduce nuovi problemi di integrità",
      400,
      newIssues,
    );
  }

  const hasIssuesAfterUpdate = afterIssues.length > 0;

  if (mergedPayload.status === "published" && hasIssuesAfterUpdate) {
    throw new AppError(
      "Impossibile pubblicare un item con problemi di integrità",
      400,
      afterIssues,
    );
  }

  Object.assign(existingItem, mergedPayload, {
    updatedBy: userId,
  });

  existingItem.integrity = {
    status: hasIssuesAfterUpdate ? "needs_review" : "valid",
    issues: afterIssues,
  };

  if (hasIssuesAfterUpdate && existingItem.status === "published") {
    existingItem.status = "draft";
  }

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

  if (filters.integrity) {
    query["integrity.status"] = filters.integrity;
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
