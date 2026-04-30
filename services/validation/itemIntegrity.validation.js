const mongoose = require("mongoose");
const Item = require("../../models/item.model");

function pushIssue(issues, field, code, message, context = {}) {
  issues.push({
    field,
    code,
    message,
    context,
  });
}

async function computeItemIntegrityIssues({ item, museumId, vocabulary }) {
  const issues = [];

  const allowedItemTypes = new Set(vocabulary.itemTypes || []);
  const allowedLanguageLevels = new Set(vocabulary.languageLevels || []);
  const allowedDurationKeys = new Set(
    (vocabulary.durationTypes || []).map((durationType) => durationType.key),
  );

  const relationTypesByKey = new Map(
    (vocabulary.relationTypes || []).map((relationType) => [
      relationType.key,
      relationType,
    ]),
  );

  if (!allowedItemTypes.has(item.itemType)) {
    pushIssue(
      issues,
      "itemType",
      "INVALID_ITEM_TYPE",
      `itemType non più presente nel config: ${item.itemType}`,
      { value: item.itemType },
    );
  }

  item.representations?.forEach((rep, index) => {
    const basePath = `representations[${index}]`;

    if (!allowedLanguageLevels.has(rep.languageLevel)) {
      pushIssue(
        issues,
        `${basePath}.languageLevel`,
        "INVALID_LANGUAGE_LEVEL",
        `languageLevel non più valido: ${rep.languageLevel}`,
        { value: rep.languageLevel },
      );
    }

    if (!allowedDurationKeys.has(rep.durationKey)) {
      pushIssue(
        issues,
        `${basePath}.durationKey`,
        "INVALID_DURATION_KEY",
        `durationKey non più valida: ${rep.durationKey}`,
        { value: rep.durationKey },
      );
    }
  });

  const targetIds = [
    ...new Set(
      (item.relations || [])
        .map((rel) => rel.target)
        .filter((target) => mongoose.isValidObjectId(target))
        .map(String),
    ),
  ];

  const targetItems = await Item.find({ _id: { $in: targetIds } })
    .select("_id museumId itemType")
    .lean();

  const targetItemsById = new Map(
    targetItems.map((targetItem) => [String(targetItem._id), targetItem]),
  );

  for (let index = 0; index < (item.relations || []).length; index += 1) {
    const rel = item.relations[index];
    const basePath = `relations[${index}]`;

    const relationType = relationTypesByKey.get(rel.relationTypeKey);

    if (!relationType) {
      pushIssue(
        issues,
        `${basePath}.relationTypeKey`,
        "INVALID_RELATION_TYPE",
        `relationTypeKey non più valida: ${rel.relationTypeKey}`,
        { value: rel.relationTypeKey },
      );

      continue;
    }

    if (
      Array.isArray(relationType.domain) &&
      relationType.domain.length > 0 &&
      !relationType.domain.includes(item.itemType)
    ) {
      pushIssue(
        issues,
        `${basePath}.relationTypeKey`,
        "INVALID_RELATION_DOMAIN",
        `La relazione ${rel.relationTypeKey} non è compatibile con itemType ${item.itemType}`,
        {
          relationTypeKey: rel.relationTypeKey,
          itemType: item.itemType,
          allowedDomain: relationType.domain,
        },
      );
    }

    const targetItem = targetItemsById.get(String(rel.target));

    if (!targetItem) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "TARGET_NOT_FOUND",
        "L'item target non esiste più",
        { target: rel.target },
      );

      continue;
    }

    if (String(targetItem.museumId) !== String(museumId)) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "CROSS_MUSEUM_TARGET",
        "Il target appartiene a un museo diverso",
        { target: rel.target },
      );

      continue;
    }

    if (
      Array.isArray(relationType.range) &&
      relationType.range.length > 0 &&
      !relationType.range.includes(targetItem.itemType)
    ) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "INVALID_RELATION_RANGE",
        `Il target di tipo ${targetItem.itemType} non è compatibile con la relazione ${rel.relationTypeKey}`,
        {
          relationTypeKey: rel.relationTypeKey,
          targetType: targetItem.itemType,
          allowedRange: relationType.range,
        },
      );
    }
  }

  return issues;
}

module.exports = {
  computeItemIntegrityIssues,
};
