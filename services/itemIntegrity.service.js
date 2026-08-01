const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");
const { invalidateVisitsUsingItem } = require("./visitDependency.service");
const { assertMuseumRole } = require("./museumAuthorization.service");

function buildIntegrityUpdate({ currentStatus, issues }) {
  const hasIssues = issues.length > 0;
  const update = {
    "integrity.status": hasIssues ? "needs_review" : "valid",
    "integrity.issues": issues,
  };

  if (currentStatus === "published" && hasIssues) update.status = "draft";
  return update;
}

async function checkItemConsistency({ museumId, itemId, userId }) {
  await assertMuseumRole({ userId, museumId, minimumRole: "manager" });

  const item = await Item.findOne({ _id: itemId, museumId });
  if (!item) throw new AppError("Item non trovato", 404);

  const vocabulary = await getMuseumVocabulary(museumId);
  const issues = await computeItemIntegrityIssues({
    item: item.toObject(),
    museumId,
    vocabulary,
  });
  const wasPublished = item.status === "published";
  const update = buildIntegrityUpdate({ currentStatus: item.status, issues });

  Object.entries(update).forEach(([path, value]) => item.set(path, value));
  item.updatedBy = userId;
  await item.save();

  if (wasPublished && issues.length > 0) {
    await invalidateVisitsUsingItem({
      itemId: item._id,
      code: "ITEM_INTEGRITY_CHANGED",
      message: "Un item pubblicato usato dalla visita non e piu integro",
      context: { itemLabel: item.label },
    });
  }

  return { item, issues, integrity: item.integrity };
}

async function publishItem({ museumId, itemId, userId }) {
  const consistency = await checkItemConsistency({ museumId, itemId, userId });

  if (consistency.item.status === "archived") {
    throw new AppError("Impossibile pubblicare un item archiviato", 400);
  }

  if (consistency.issues.length > 0) {
    throw new AppError(
      "Impossibile pubblicare un item con problemi di integrita",
      400,
      consistency.issues,
    );
  }

  consistency.item.status = "published";
  consistency.item.integrity = { status: "valid", issues: [] };
  consistency.item.updatedBy = userId;

  await consistency.item.save();
  return consistency.item;
}

async function auditItemsAfterMuseumConfigChange({ museumId, vocabulary }) {
  const items = await Item.find({ museumId })
    .select("_id museumId status label itemType representations relations")
    .lean();

  const operations = [];
  const invalidatedItems = [];
  let validCount = 0;
  let needsReviewCount = 0;
  let demotedCount = 0;

  for (const item of items) {
    const issues = await computeItemIntegrityIssues({ item, museumId, vocabulary });
    const hasIssues = issues.length > 0;
    const update = buildIntegrityUpdate({ currentStatus: item.status, issues });

    if (hasIssues) {
      needsReviewCount += 1;
      invalidatedItems.push(item);
    } else {
      validCount += 1;
    }

    if (item.status === "published" && hasIssues) demotedCount += 1;

    operations.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: update },
      },
    });
  }

  if (operations.length > 0) await Item.bulkWrite(operations);

  for (const item of invalidatedItems) {
    await invalidateVisitsUsingItem({
      itemId: item._id,
      code: "MUSEUM_VOCABULARY_CHANGED",
      message: "La configurazione del museo ha reso incoerente un item della visita",
      context: { itemLabel: item.label },
    });
  }

  return {
    auditedItemsCount: items.length,
    validCount,
    needsReviewCount,
    demotedCount,
  };
}

module.exports = {
  buildIntegrityUpdate,
  checkItemConsistency,
  publishItem,
  auditItemsAfterMuseumConfigChange,
};
