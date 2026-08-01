const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const { isPlainObject } = require("./validation.utils");

function pushIssue(issues, field, code, message, context = {}) {
  issues.push({ field, code, message, context });
}

function validateRepresentationIntegrity({ representation, index, vocabulary, issues }) {
  const basePath = `representations[${index}]`;
  const allowedLanguageLevelKeys = new Set(
    (vocabulary.languageLevels || []).map((level) => level.key),
  );
  const allowedDurationKeys = new Set(
    (vocabulary.durationTypes || []).map((duration) => duration.key),
  );

  if (!isPlainObject(representation)) {
    pushIssue(issues, basePath, "INVALID_REPRESENTATION", "Ogni representation deve essere un oggetto");
    return;
  }

  if (!representation.languageLevelKey || typeof representation.languageLevelKey !== "string") {
    pushIssue(
      issues,
      `${basePath}.languageLevelKey`,
      "MISSING_LANGUAGE_LEVEL_KEY",
      "languageLevelKey e obbligatoria per pubblicare",
    );
  } else if (!allowedLanguageLevelKeys.has(representation.languageLevelKey)) {
    pushIssue(
      issues,
      `${basePath}.languageLevelKey`,
      "INVALID_LANGUAGE_LEVEL_KEY",
      `languageLevelKey non valida: ${representation.languageLevelKey}`,
      {
        value: representation.languageLevelKey,
        allowedValues: Array.from(allowedLanguageLevelKeys),
      },
    );
  }

  if (!representation.durationKey || typeof representation.durationKey !== "string") {
    pushIssue(
      issues,
      `${basePath}.durationKey`,
      "MISSING_DURATION_KEY",
      "durationKey e obbligatoria per pubblicare",
    );
  } else if (!allowedDurationKeys.has(representation.durationKey)) {
    pushIssue(
      issues,
      `${basePath}.durationKey`,
      "INVALID_DURATION_KEY",
      `durationKey non valida: ${representation.durationKey}`,
      {
        value: representation.durationKey,
        allowedValues: Array.from(allowedDurationKeys),
      },
    );
  }

  if (!representation.text || typeof representation.text !== "string") {
    pushIssue(
      issues,
      `${basePath}.text`,
      "MISSING_TEXT",
      "Il testo della representation e obbligatorio per pubblicare",
    );
  }
}

async function computeItemIntegrityIssues({ item, museumId, vocabulary }) {
  const issues = [];
  const allowedItemTypes = new Set(vocabulary.itemTypes || []);
  const relationTypesByKey = new Map(
    (vocabulary.relationTypes || []).map((type) => [type.key, type]),
  );

  if (!item.label || typeof item.label !== "string") {
    pushIssue(issues, "label", "MISSING_LABEL", "label e obbligatoria per pubblicare");
  }

  if (!item.itemType || typeof item.itemType !== "string") {
    pushIssue(issues, "itemType", "MISSING_ITEM_TYPE", "itemType e obbligatorio per pubblicare");
  } else if (!allowedItemTypes.has(item.itemType)) {
    pushIssue(
      issues,
      "itemType",
      "INVALID_ITEM_TYPE",
      `itemType non presente nel config: ${item.itemType}`,
    );
  }

  if (!Array.isArray(item.representations) || item.representations.length === 0) {
    pushIssue(
      issues,
      "representations",
      "MISSING_REPRESENTATIONS",
      "Almeno una representation completa e obbligatoria per pubblicare",
    );
  } else {
    const seenPairs = new Set();
    let defaultCount = 0;

    item.representations.forEach((representation, index) => {
      validateRepresentationIntegrity({ representation, index, vocabulary, issues });
      if (!isPlainObject(representation)) return;

      if (representation.isDefault === true) defaultCount += 1;

      if (representation.languageLevelKey && representation.durationKey) {
        const pairKey = `${representation.languageLevelKey}::${representation.durationKey}`;
        if (seenPairs.has(pairKey)) {
          pushIssue(
            issues,
            `representations[${index}]`,
            "DUPLICATE_REPRESENTATION",
            `Coppia languageLevelKey/durationKey duplicata: ${pairKey}`,
          );
        } else {
          seenPairs.add(pairKey);
        }
      }
    });

    if (defaultCount === 0) {
      pushIssue(
        issues,
        "representations",
        "MISSING_DEFAULT_REPRESENTATION",
        "E obbligatoria una representation di default per pubblicare l'item",
      );
    } else if (defaultCount > 1) {
      pushIssue(
        issues,
        "representations",
        "MULTIPLE_DEFAULTS",
        "E consentita una sola representation di default",
      );
    }
  }

  const relations = Array.isArray(item.relations) ? item.relations : [];
  const targetIds = [
    ...new Set(
      relations
        .map((relation) => relation?.target)
        .filter((target) => mongoose.isValidObjectId(target))
        .map(String),
    ),
  ];
  const targetItems = await Item.find({ _id: { $in: targetIds } })
    .select("_id museumId itemType")
    .lean();
  const targetsById = new Map(targetItems.map((target) => [String(target._id), target]));
  const seenRelations = new Set();
  const occurrences = new Map();

  relations.forEach((relation, index) => {
    const basePath = `relations[${index}]`;

    if (!isPlainObject(relation)) {
      pushIssue(issues, basePath, "INVALID_RELATION", "Ogni relation deve essere un oggetto");
      return;
    }

    const relationType = relationTypesByKey.get(relation.relationTypeKey);
    if (!relation.relationTypeKey || !relationType) {
      pushIssue(
        issues,
        `${basePath}.relationTypeKey`,
        "INVALID_RELATION_TYPE",
        `relationTypeKey non valida: ${relation.relationTypeKey}`,
      );
      return;
    }

    if (relationType.domain?.length && !relationType.domain.includes(item.itemType)) {
      pushIssue(
        issues,
        `${basePath}.relationTypeKey`,
        "INVALID_RELATION_DOMAIN",
        `La relazione ${relation.relationTypeKey} non e compatibile con itemType ${item.itemType}`,
      );
    }

    const count = occurrences.get(relation.relationTypeKey) || 0;
    if (relationType.validationRules?.allowMultiple === false && count >= 1) {
      pushIssue(
        issues,
        basePath,
        "MULTIPLE_RELATIONS_NOT_ALLOWED",
        `La relazione ${relation.relationTypeKey} ammette un solo target`,
      );
    }
    occurrences.set(relation.relationTypeKey, count + 1);

    if (!relation.target || !mongoose.isValidObjectId(relation.target)) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "INVALID_OBJECT_ID",
        "target deve essere un ObjectId valido",
      );
      return;
    }

    if (String(relation.target) === String(item._id)) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "SELF_RELATION",
        "Un item non puo essere in relazione con se stesso",
      );
      return;
    }

    const targetItem = targetsById.get(String(relation.target));
    if (!targetItem) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "TARGET_NOT_FOUND",
        "L'item target non esiste piu",
      );
      return;
    }

    if (String(targetItem.museumId) !== String(museumId)) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "CROSS_MUSEUM_TARGET",
        "Il target appartiene a un museo diverso",
      );
      return;
    }

    if (relationType.range?.length && !relationType.range.includes(targetItem.itemType)) {
      pushIssue(
        issues,
        `${basePath}.target`,
        "INVALID_RELATION_RANGE",
        `Il target di tipo ${targetItem.itemType} non e compatibile con la relazione ${relation.relationTypeKey}`,
      );
    }

    if (relation.weight !== undefined) {
      const weight = Number(relation.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
        pushIssue(
          issues,
          `${basePath}.weight`,
          "INVALID_WEIGHT",
          "weight deve essere compreso tra 0 e 10",
        );
      }
    }

    const duplicateKey = `${relation.relationTypeKey}::${String(relation.target)}`;
    if (seenRelations.has(duplicateKey)) {
      pushIssue(
        issues,
        basePath,
        "DUPLICATE_RELATION",
        "Relazione duplicata verso lo stesso target con lo stesso tipo",
      );
    } else {
      seenRelations.add(duplicateKey);
    }
  });

  return issues;
}

module.exports = {
  computeItemIntegrityIssues,
};
