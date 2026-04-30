const mongoose = require("mongoose");
const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { getRelationViewByKey } = require("./relationView.utils");
const { isPlainObject } = require("./validation/validation.utils");

function sameId(a, b) {
  return String(a) === String(b);
}

function isAllowedType(allowedTypes = [], itemType) {
  return allowedTypes.length === 0 || allowedTypes.includes(itemType);
}

function ensureRelationsArray(item) {
  if (!Array.isArray(item.relations)) {
    item.relations = [];
  }
}

function touchItem(touchedItemsById, item) {
  touchedItemsById.set(String(item._id), item);
}

async function getItemOrFail({ museumId, itemId }) {
  if (!mongoose.isValidObjectId(itemId)) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "target",
        code: "INVALID_OBJECT_ID",
        message: "target non è un ObjectId valido",
      },
    ]);
  }

  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

  return item;
}

async function getCommandTargetItemOrFail({ museumId, target, field }) {
  if (!mongoose.isValidObjectId(target)) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "INVALID_OBJECT_ID",
        message: `${field} non è un ObjectId valido`,
      },
    ]);
  }

  const item = await Item.findOne({ _id: target, museumId });

  if (!item) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "TARGET_NOT_FOUND",
        message: "L'item target non esiste nel museo corrente",
      },
    ]);
  }

  return item;
}

function normalizeRelationCommands(relationCommands) {
  if (relationCommands === undefined) {
    return [];
  }

  if (!Array.isArray(relationCommands)) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "relationCommands",
        code: "INVALID_TYPE",
        message: "relationCommands deve essere un array",
      },
    ]);
  }

  const errors = [];
  const normalizedCommands = [];

  relationCommands.forEach((command, index) => {
    const basePath = `relationCommands[${index}]`;

    if (!isPlainObject(command)) {
      errors.push({
        field: basePath,
        code: "INVALID_TYPE",
        message: "Ogni relationCommand deve essere un oggetto",
      });
      return;
    }

    const op = typeof command.op === "string" ? command.op.trim().toLowerCase() : command.op;
    const viewKey = typeof command.viewKey === "string" ? command.viewKey.trim().toLowerCase() : command.viewKey;

    if (!["add", "remove"].includes(op)) {
      errors.push({
        field: `${basePath}.op`,
        code: "INVALID_ENUM",
        message: "op deve essere add oppure remove",
        allowedValues: ["add", "remove"],
      });
    }

    if (!viewKey || typeof viewKey !== "string") {
      errors.push({
        field: `${basePath}.viewKey`,
        code: "REQUIRED",
        message: "viewKey è obbligatorio",
      });
    }

    if (!command.target) {
      errors.push({
        field: `${basePath}.target`,
        code: "REQUIRED",
        message: "target è obbligatorio",
      });
    } else if (!mongoose.isValidObjectId(command.target)) {
      errors.push({
        field: `${basePath}.target`,
        code: "INVALID_OBJECT_ID",
        message: "target non è un ObjectId valido",
      });
    }

    normalizedCommands.push({
      op,
      viewKey,
      target: command.target,
      weight: command.weight,
      basePath,
    });
  });

  if (errors.length > 0) {
    throw new AppError("Payload non valido", 400, errors);
  }

  return normalizedCommands;
}

function mapOutgoingRelations({ item, vocabulary }) {
  const relationTypesByKey = new Map(vocabulary.relationTypes.map((relationType) => [relationType.key, relationType]));

  return (item.relations || []).map((rel) => {
    const relationType = relationTypesByKey.get(rel.relationTypeKey);

    return {
      relationId: rel._id,
      viewKey: rel.relationTypeKey,
      baseRelationTypeKey: rel.relationTypeKey,
      relationTypeKey: rel.relationTypeKey,
      direction: relationType?.directionality === "symmetric" ? "symmetric" : "direct",
      label: relationType?.label || rel.relationTypeKey,
      target: rel.target,
      weight: rel.weight,
      generated: false,
    };
  });
}

async function mapIncomingRelations({ museumId, itemId, vocabulary }) {
  const relationTypesByKey = new Map(vocabulary.relationTypes.map((relationType) => [relationType.key, relationType]));

  const sourceItems = await Item.find({
    museumId,
    "relations.target": itemId,
  })
    .select("_id label itemType relations")
    .lean();

  const incoming = [];

  sourceItems.forEach((sourceItem) => {
    (sourceItem.relations || []).forEach((rel) => {
      if (!sameId(rel.target, itemId)) {
        return;
      }

      const relationType = relationTypesByKey.get(rel.relationTypeKey);

      if (!relationType) {
        return;
      }

      const isSymmetric = relationType.directionality === "symmetric";

      incoming.push({
        relationId: rel._id,
        viewKey: isSymmetric ? relationType.key : `${relationType.key}:reverse`,
        baseRelationTypeKey: relationType.key,
        relationTypeKey: relationType.key,
        direction: isSymmetric ? "symmetric" : "reverse",
        label: isSymmetric ? relationType.label : relationType.reverse?.label || `Inverso di ${relationType.label}`,
        target: sourceItem._id,
        targetLabel: sourceItem.label,
        targetItemType: sourceItem.itemType,
        sourceItemId: sourceItem._id,
        sourceRelationId: rel._id,
        weight: rel.weight,
        generated: true,
      });
    });
  });

  return incoming;
}

async function getItemRelationsView({ museumId, itemId }) {
  const item = await getItemOrFail({ museumId, itemId });
  const vocabulary = await getMuseumVocabulary(museumId);

  const outgoing = mapOutgoingRelations({
    item,
    vocabulary,
  });

  const incoming = await mapIncomingRelations({
    museumId,
    itemId,
    vocabulary,
  });

  return {
    itemId: item._id,
    outgoing,
    incoming,
  };
}

function canonicalizeRelationWrite({ currentItem, targetItem, relationView }) {
  if (relationView.direction === "reverse") {
    return {
      sourceItem: targetItem,
      targetItem: currentItem,
      relationTypeKey: relationView.baseRelationTypeKey,
    };
  }

  return {
    sourceItem: currentItem,
    targetItem,
    relationTypeKey: relationView.baseRelationTypeKey,
  };
}

function ensureRelationViewMatchesItemTypes({ relationView, currentItem, targetItem, field }) {
  if (!isAllowedType(relationView.domain, currentItem.itemType)) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "INVALID_RELATION_VIEW_DOMAIN",
        message: `La relationView ${relationView.viewKey} non è applicabile a itemType ${currentItem.itemType}`,
        allowedValues: relationView.domain,
      },
    ]);
  }

  if (!isAllowedType(relationView.range, targetItem.itemType)) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "INVALID_RELATION_VIEW_RANGE",
        message: `Il target di tipo ${targetItem.itemType} non è compatibile con relationView ${relationView.viewKey}`,
        allowedValues: relationView.range,
      },
    ]);
  }
}

function normalizeWeight(weight, field) {
  if (weight === undefined) {
    return 1;
  }

  const normalizedWeight = Number(weight);

  if (!Number.isFinite(normalizedWeight) || normalizedWeight < 0 || normalizedWeight > 10) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "INVALID_NUMBER",
        message: "weight deve essere un numero compreso tra 0 e 10",
      },
    ]);
  }

  return normalizedWeight;
}

function addCanonicalRelation({ sourceItem, targetItem, relationTypeKey, relationView, weight, field }) {
  ensureRelationsArray(sourceItem);

  const alreadyExists = sourceItem.relations.some((rel) => rel.relationTypeKey === relationTypeKey && sameId(rel.target, targetItem._id));

  if (alreadyExists) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "DUPLICATE_RELATION",
        message: "La relazione esiste già",
      },
    ]);
  }

  if (relationView.validationRules?.allowMultiple === false) {
    const alreadyHasRelationOfType = sourceItem.relations.some((rel) => rel.relationTypeKey === relationTypeKey);

    if (alreadyHasRelationOfType) {
      throw new AppError("Payload non valido", 400, [
        {
          field,
          code: "MULTIPLE_RELATIONS_NOT_ALLOWED",
          message: `La relazione ${relationTypeKey} ammette un solo target`,
        },
      ]);
    }
  }

  if (relationView.direction === "symmetric") {
    const reciprocalAlreadyExists = (targetItem.relations || []).some((rel) => rel.relationTypeKey === relationTypeKey && sameId(rel.target, sourceItem._id));

    if (reciprocalAlreadyExists) {
      throw new AppError("Payload non valido", 400, [
        {
          field,
          code: "RECIPROCAL_SYMMETRIC_RELATION_ALREADY_EXISTS",
          message: "Esiste già la stessa relazione simmetrica nel verso opposto",
        },
      ]);
    }
  }

  sourceItem.relations.push({
    relationTypeKey,
    target: targetItem._id,
    weight,
  });
}

function removeCanonicalRelation({ sourceItem, targetItem, relationTypeKey, field }) {
  ensureRelationsArray(sourceItem);

  const beforeCount = sourceItem.relations.length;

  sourceItem.relations = sourceItem.relations.filter((rel) => !(rel.relationTypeKey === relationTypeKey && sameId(rel.target, targetItem._id)));

  if (sourceItem.relations.length === beforeCount) {
    throw new AppError("Payload non valido", 400, [
      {
        field,
        code: "RELATION_NOT_FOUND",
        message: "Relazione non trovata",
      },
    ]);
  }
}

/**
 * Applica comandi relationCommands sull'item corrente.
 *
 * Non salva i documenti.
 * Modifica in memoria currentItem e/o altri item target.
 * Ritorna gli item modificati oltre al currentItem.
 */
async function applyRelationCommands({ museumId, currentItem, relationCommands, vocabulary }) {
  const commands = normalizeRelationCommands(relationCommands);

  if (commands.length === 0) {
    return [];
  }

  const touchedItemsById = new Map();
  const targetItemsById = new Map();

  for (const command of commands) {
    const relationView = getRelationViewByKey(vocabulary.relationViews, command.viewKey);

    if (!relationView) {
      throw new AppError("Payload non valido", 400, [
        {
          field: `${command.basePath}.viewKey`,
          code: "UNKNOWN_RELATION_VIEW",
          message: `relationView non valida: ${command.viewKey}`,
        },
      ]);
    }

    let targetItem = targetItemsById.get(String(command.target));

    if (!targetItem) {
      targetItem = await getCommandTargetItemOrFail({
        museumId,
        target: command.target,
        field: `${command.basePath}.target`,
      });

      targetItemsById.set(String(command.target), targetItem);
    }

    if (sameId(currentItem._id, targetItem._id)) {
      throw new AppError("Payload non valido", 400, [
        {
          field: `${command.basePath}.target`,
          code: "SELF_RELATION",
          message: "Un item non può essere in relazione con sé stesso",
        },
      ]);
    }

    ensureRelationViewMatchesItemTypes({
      relationView,
      currentItem,
      targetItem,
      field: `${command.basePath}.viewKey`,
    });

    const canonical = canonicalizeRelationWrite({
      currentItem,
      targetItem,
      relationView,
    });

    if (command.op === "add") {
      const weight = normalizeWeight(command.weight, `${command.basePath}.weight`);

      addCanonicalRelation({
        sourceItem: canonical.sourceItem,
        targetItem: canonical.targetItem,
        relationTypeKey: canonical.relationTypeKey,
        relationView,
        weight,
        field: command.basePath,
      });

      touchItem(touchedItemsById, canonical.sourceItem);
    }

    if (command.op === "remove") {
      removeCanonicalRelation({
        sourceItem: canonical.sourceItem,
        targetItem: canonical.targetItem,
        relationTypeKey: canonical.relationTypeKey,
        field: command.basePath,
      });

      touchItem(touchedItemsById, canonical.sourceItem);
    }
  }

  return Array.from(touchedItemsById.values());
}

module.exports = {
  getItemRelationsView,
  applyRelationCommands,
};
