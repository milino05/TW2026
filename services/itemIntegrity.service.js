const Item = require("../models/item.model");
const { computeItemIntegrityIssues } = require("./validation/itemIntegrity.validation");

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

    const update = {
      "integrity.status": hasIssues ? "needs_review" : "valid",
      "integrity.issues": issues,
    };

    if (hasIssues) {
      needsReviewCount += 1;
    } else {
      validCount += 1;
    }

    if (hasIssues && item.status === "published") {
      update.status = "draft";
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
  auditItemsAfterMuseumConfigChange,
};
