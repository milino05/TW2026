const Item = require("../models/item.model");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");

function buildIntegrityUpdate({ currentStatus, issues }) {
  const hasIssues = issues.length > 0;

  const update = {
    "integrity.status": hasIssues ? "needs_review" : "valid",
    "integrity.issues": issues,
  };

  if (currentStatus === "published" && hasIssues) {
    update.status = "draft";
  }

  return update;
}

async function checkItemConsistency({ museumId, itemId }) {
  const item = await Item.findOne({ _id: itemId, museumId });

  if (!item) {
    throw new AppError("Item non trovato", 404);
  }

  const vocabulary = await getMuseumVocabulary(museumId);

  const issues = await computeItemIntegrityIssues({
    item: item.toObject(),
    museumId,
    vocabulary,
  });

  const update = buildIntegrityUpdate({
    currentStatus: item.status,
    issues,
  });

  Object.entries(update).forEach(([path, value]) => {
    item.set(path, value);
  });

  await item.save();

  return {
    item,
    issues,
    integrity: item.integrity,
  };
}

async function publishItem({ museumId, itemId }) {
  const consistency = await checkItemConsistency({
    museumId,
    itemId,
  });

  if (consistency.item.status === "archived") {
    throw new AppError("Impossibile pubblicare un item archiviato", 400);
  }

  if (consistency.issues.length > 0) {
    throw new AppError("Impossibile pubblicare un item con problemi di integrità", 400, consistency.issues);
  }

  consistency.item.status = "published";
  consistency.item.integrity = {
    status: "valid",
    issues: [],
  };

  await consistency.item.save();

  return consistency.item;
}

async function auditItemsAfterMuseumConfigChange({ museumId, vocabulary }) {
  const items = await Item.find({ museumId })
    .select("_id museumId status itemType representations relations")
    .lean();

  const operations = [];

  let validCount = 0;
  let needsReviewCount = 0;
  let demotedCount = 0;

  for (const item of items) {
    const issues = await computeItemIntegrityIssues({
      item,
      museumId,
      vocabulary,
    });

    const hasIssues = issues.length > 0;
    const update = buildIntegrityUpdate({
      currentStatus: item.status,
      issues,
    });

    if (hasIssues) {
      needsReviewCount += 1;
    } else {
      validCount += 1;
    }

    if (item.status === "published" && hasIssues) {
      demotedCount += 1;
    }

    operations.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: update },
      },
    });
  }

  if (operations.length > 0) {
    await Item.bulkWrite(operations);
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
