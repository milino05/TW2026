const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { getRelationViewByKey } = require("./relationView.utils");

function sameId(a, b) {
  return String(a) === String(b);
}

function isAllowedType(allowedTypes = [], itemType) {
  return allowedTypes.length === 0 || allowedTypes.includes(itemType);
}

//FUNZIONE RIPETUTA
async function getItemOrFail({ museumId, itemId }) {
  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

  return item;
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

function ensureRelationViewMatchesItemTypes({ relationView, currentItem, targetItem }) {
  if (!isAllowedType(relationView.domain, currentItem.itemType)) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "viewKey",
        code: "INVALID_RELATION_VIEW_DOMAIN",
        message: `La relationView ${relationView.viewKey} non è applicabile a itemType ${currentItem.itemType}`,
        allowedValues: relationView.domain,
      },
    ]);
  }

  if (!isAllowedType(relationView.range, targetItem.itemType)) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "target",
        code: "INVALID_RELATION_VIEW_RANGE",
        message: `Il target di tipo ${targetItem.itemType} non è compatibile con relationView ${relationView.viewKey}`,
        allowedValues: relationView.range,
      },
    ]);
  }
}

function ensureValidWeight(weight) {
  if (weight === undefined) {
    return 1;
  }

  const normalizedWeight = Number(weight);

  if (!Number.isFinite(normalizedWeight) || normalizedWeight < 0 || normalizedWeight > 10) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "weight",
        code: "INVALID_NUMBER",
        message: "weight deve essere un numero compreso tra 0 e 10",
      },
    ]);
  }

  return normalizedWeight;
}

function ensureRelationCanBeAdded({ sourceItem, targetItem, relationTypeKey, relationView }) {
  const alreadyExists = (sourceItem.relations || []).some((rel) => rel.relationTypeKey === relationTypeKey && sameId(rel.target, targetItem._id));

  if (alreadyExists) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "relations",
        code: "DUPLICATE_RELATION",
        message: "La relazione esiste già",
      },
    ]);
  }

  if (relationView.validationRules?.allowMultiple === false) {
    const alreadyHasRelationOfType = (sourceItem.relations || []).some((rel) => rel.relationTypeKey === relationTypeKey);

    if (alreadyHasRelationOfType) {
      throw new AppError("Payload non valido", 400, [
        {
          field: "relations",
          code: "MULTIPLE_RELATIONS_NOT_ALLOWED",
          message: `La relazione ${relationTypeKey} ammette un solo target`,
        },
      ]);
    }
  }
}

async function ensureNoSymmetricReciprocalDuplicate({ museumId, sourceItem, targetItem, relationTypeKey, relationView }) {
  if (relationView.direction !== "symmetric") {
    return;
  }

  const reciprocal = await Item.findOne({
    _id: targetItem._id,
    museumId,
    relations: {
      $elemMatch: {
        relationTypeKey,
        target: sourceItem._id,
      },
    },
  })
    .select("_id")
    .lean();
  //PERCHÈ DARE ERRORE E NON SEMPLICEMENTE INGORARE LA COSA
  if (reciprocal) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "relations",
        code: "RECIPROCAL_SYMMETRIC_RELATION_ALREADY_EXISTS",
        message: "Esiste già la stessa relazione simmetrica nel verso opposto",
      },
    ]);
  }
}

async function addRelationByView({ museumId, itemId, payload }) {
  const { viewKey, target, weight } = payload || {};
  //CHE ROBA È VIEWKEY
  if (!viewKey || typeof viewKey !== "string") {
    throw new AppError("Payload non valido", 400, [
      {
        field: "viewKey",
        code: "REQUIRED",
        message: "viewKey è obbligatorio",
      },
    ]);
  }

  const currentItem = await getItemOrFail({ museumId, itemId });
  const targetItem = await getItemOrFail({ museumId, itemId: target });

  if (sameId(currentItem._id, targetItem._id)) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "target",
        code: "SELF_RELATION",
        message: "Un item non può essere in relazione con sé stesso",
      },
    ]);
  }

  const vocabulary = await getMuseumVocabulary(museumId);
  const relationView = getRelationViewByKey(vocabulary.relationViews, viewKey);

  if (!relationView) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "viewKey",
        code: "UNKNOWN_RELATION_VIEW",
        message: `relationView non valida: ${viewKey}`,
      },
    ]);
  }

  ensureRelationViewMatchesItemTypes({
    relationView,
    currentItem,
    targetItem,
  });

  const canonical = canonicalizeRelationWrite({
    currentItem,
    targetItem,
    relationView,
  });

  const normalizedWeight = ensureValidWeight(weight);

  ensureRelationCanBeAdded({
    sourceItem: canonical.sourceItem,
    targetItem: canonical.targetItem,
    relationTypeKey: canonical.relationTypeKey,
    relationView,
  });

  await ensureNoSymmetricReciprocalDuplicate({
    museumId,
    sourceItem: canonical.sourceItem,
    targetItem: canonical.targetItem,
    relationTypeKey: canonical.relationTypeKey,
    relationView,
  });

  canonical.sourceItem.relations.push({
    relationTypeKey: canonical.relationTypeKey,
    target: canonical.targetItem._id,
    weight: normalizedWeight,
  });

  await canonical.sourceItem.save();

  return {
    storedOnItemId: canonical.sourceItem._id,
    relationTypeKey: canonical.relationTypeKey,
    target: canonical.targetItem._id,
    relationView,
  };
}

async function removeRelationByView({ museumId, itemId, payload }) {
  const { viewKey, target } = payload || {};

  if (!viewKey || typeof viewKey !== "string") {
    throw new AppError("Payload non valido", 400, [
      {
        field: "viewKey",
        code: "REQUIRED",
        message: "viewKey è obbligatorio",
      },
    ]);
  }

  const currentItem = await getItemOrFail({ museumId, itemId });
  const targetItem = await getItemOrFail({ museumId, itemId: target });

  const vocabulary = await getMuseumVocabulary(museumId);
  const relationView = getRelationViewByKey(vocabulary.relationViews, viewKey);

  if (!relationView) {
    throw new AppError("Payload non valido", 400, [
      {
        field: "viewKey",
        code: "UNKNOWN_RELATION_VIEW",
        message: `relationView non valida: ${viewKey}`,
      },
    ]);
  }

  const canonical = canonicalizeRelationWrite({
    currentItem,
    targetItem,
    relationView,
  });

  const beforeCount = canonical.sourceItem.relations.length;

  canonical.sourceItem.relations = canonical.sourceItem.relations.filter((rel) => !(rel.relationTypeKey === canonical.relationTypeKey && sameId(rel.target, canonical.targetItem._id)));

  if (canonical.sourceItem.relations.length === beforeCount) {
    throw new AppError("Relazione non trovata", 404);
  }

  await canonical.sourceItem.save();

  return {
    removed: true,
    storedOnItemId: canonical.sourceItem._id,
    relationTypeKey: canonical.relationTypeKey,
    target: canonical.targetItem._id,
  };
}

module.exports = {
  getItemRelationsView,
  addRelationByView,
  removeRelationByView,
};
