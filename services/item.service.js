const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { normalizeItemPayload, validateItemPayload } = require("./validation/item.validation");
const { applyRelationCommands } = require("./itemRelations.service");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");

function issueSignature(issue) {
  return JSON.stringify({
    code: issue.code,
    field: issue.field,
    value: issue.context?.value ?? null,
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

  //serve prima creare l'item e poi validare le relation
  //magari ci sono relation inverse che puntano entranti nell'item che ancora non ho creato
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

  const beforeIssues = Array.isArray(existingItem.integrity?.issues)
    ? existingItem.integrity.issues
    : [];

  Object.assign(existingItem, mergedPayload, {
    updatedBy: userId,
  });

  const touchedItems = await applyRelationCommands({
    museumId,
    currentItem: existingItem,
    relationCommands,
    vocabulary,
  });

  const afterIssues = await computeItemIntegrityIssues({
    item: existingItem.toObject(),
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
  //controllo alla richiesta dell'utente (dopo la update)
  //blocca solo se qualcuno prova effettivamente a pubblicare
  if ("status" in payload && payload.status === "published" && hasIssuesAfterUpdate) {
    throw new AppError(
      "Impossibile pubblicare un item con problemi di integrità",
      400,
      afterIssues,
    );
  }
  //controllo allo stato attuale del DB (prima della update)
  if (existingItem.status === "published" && hasIssuesAfterUpdate) {
    existingItem.status = "draft";
  }

  existingItem.integrity = {
    status: hasIssuesAfterUpdate ? "needs_review" : "valid",
    issues: afterIssues,
  };

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
