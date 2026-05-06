const mongoose = require("mongoose");
const Item = require("../../models/item.model");
const { isPlainObject } = require("./validation.utils");

function pushIssue(issues, field, code, message, context = {}) {
  issues.push({
    field,
    code,
    message,
    context,
  });
}

function validateRepresentationIntegrity({ representation, index, vocabulary, allowedLanguageLevels, allowedDurationKeys, issues }) {
  const basePath = `representations[${index}]`;

  if (!isPlainObject(representation)) {
    pushIssue(issues, basePath, "INVALID_REPRESENTATION", "Ogni representation deve essere un oggetto");
    return;
  }

  if (!representation.languageLevel || typeof representation.languageLevel !== "string") {
    pushIssue(issues, `${basePath}.languageLevel`, "MISSING_LANGUAGE_LEVEL", "languageLevel è obbligatorio per pubblicare", {
      allowedValues: vocabulary.languageLevels || [],
    });
  } else if (!allowedLanguageLevels.has(representation.languageLevel)) {
    pushIssue(
      issues,
      `${basePath}.languageLevel`,
      "INVALID_LANGUAGE_LEVEL",
      `languageLevel non più valido: ${representation.languageLevel}`,
      { value: representation.languageLevel },
    );
  }

  if (!representation.durationKey || typeof representation.durationKey !== "string") {
    pushIssue(issues, `${basePath}.durationKey`, "MISSING_DURATION_KEY", "durationKey è obbligatoria per pubblicare", {
      allowedValues: (vocabulary.durationTypes || []).map((durationType) => durationType.key),
    });
  } else if (!allowedDurationKeys.has(representation.durationKey)) {
    pushIssue(
      issues,
      `${basePath}.durationKey`,
      "INVALID_DURATION_KEY",
      `durationKey non più valida: ${representation.durationKey}`,
      { value: representation.durationKey },
    );
  }

  if (!representation.text || typeof representation.text !== "string") {
    pushIssue(issues, `${basePath}.text`, "MISSING_TEXT", "Il testo della representation è obbligatorio per pubblicare");
  }
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

  if (!item.label || typeof item.label !== "string") {
    pushIssue(issues, "label", "MISSING_LABEL", "label è obbligatoria per pubblicare");
  }

  if (!item.itemType || typeof item.itemType !== "string") {
    pushIssue(issues, "itemType", "MISSING_ITEM_TYPE", "itemType è obbligatorio per pubblicare");
  } else if (!allowedItemTypes.has(item.itemType)) {
    pushIssue(
      issues,
      "itemType",
      "INVALID_ITEM_TYPE",
      `itemType non più presente nel config: ${item.itemType}`,
      { value: item.itemType },
    );
  }

  if (!Array.isArray(item.representations) || item.representations.length === 0) {
    pushIssue(issues, "representations", "MISSING_REPRESENTATIONS", "Almeno una representation completa è obbligatoria per pubblicare");
  } else {
    const seenPairs = new Set();
    let defaultCount = 0;

    item.representations.forEach((rep, index) => {
      validateRepresentationIntegrity({
        representation: rep,
        index,
        vocabulary,
        allowedLanguageLevels,
        allowedDurationKeys,
        issues,
      });

      if (!isPlainObject(rep)) {
        return;
      }

      if (rep.isDefault === true) {
        defaultCount += 1;
      }

      if (rep.languageLevel && rep.durationKey) {
        const pairKey = `${rep.languageLevel}::${rep.durationKey}`;
        if (seenPairs.has(pairKey)) {
          pushIssue(issues, `representations[${index}]`, "DUPLICATE_REPRESENTATION", `Coppia languageLevel/durationKey duplicata: ${pairKey}`);
        } else {
          seenPairs.add(pairKey);
        }
      }
    });

    if (defaultCount > 1) {
      pushIssue(issues, "representations", "MULTIPLE_DEFAULTS", "È consentita una sola representation di default");
    }
  }

  const relations = Array.isArray(item.relations) ? item.relations : [];
  const targetIds = [
    ...new Set(
      relations
        .map((rel) => (isPlainObject(rel) ? rel.target : null))
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

  const seenRelations = new Set();
  const seenRelationTypeOccurrences = new Map();

  for (let index = 0; index < relations.length; index += 1) {
    const rel = relations[index];
    const basePath = `relations[${index}]`;

    if (!isPlainObject(rel)) {
      pushIssue(issues, basePath, "INVALID_RELATION", "Ogni relation deve essere un oggetto");
      continue;
    }

    if (!rel.relationTypeKey || typeof rel.relationTypeKey !== "string") {
      pushIssue(issues, `${basePath}.relationTypeKey`, "MISSING_RELATION_TYPE", "relationTypeKey è obbligatorio se la relation è presente");
      continue;
    }

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

    const alreadySeenForType = seenRelationTypeOccurrences.get(rel.relationTypeKey) || 0;
    if (relationType.validationRules?.allowMultiple === false && alreadySeenForType >= 1) {
      pushIssue(issues, basePath, "MULTIPLE_RELATIONS_NOT_ALLOWED", `La relazione ${rel.relationTypeKey} ammette un solo target`);
    }
    seenRelationTypeOccurrences.set(rel.relationTypeKey, alreadySeenForType + 1);

    if (!rel.target) {
      pushIssue(issues, `${basePath}.target`, "MISSING_TARGET", "target è obbligatorio se la relation è presente");
      continue;
    }

    if (!mongoose.isValidObjectId(rel.target)) {
      pushIssue(issues, `${basePath}.target`, "INVALID_OBJECT_ID", "target non è un ObjectId valido", { target: rel.target });
      continue;
    }

    if (String(rel.target) === String(item._id)) {
      pushIssue(issues, `${basePath}.target`, "SELF_RELATION", "Un item non può essere in relazione con sé stesso", { target: rel.target });
      continue;
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

    if (rel.weight !== undefined) {
      const weight = Number(rel.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
        pushIssue(issues, `${basePath}.weight`, "INVALID_WEIGHT", "weight deve essere un numero compreso tra 0 e 10", { value: rel.weight });
      }
    }

    const duplicateKey = `${rel.relationTypeKey}::${String(rel.target)}`;
    if (seenRelations.has(duplicateKey)) {
      pushIssue(issues, basePath, "DUPLICATE_RELATION", "Relazione duplicata verso lo stesso target con lo stesso tipo");
    } else {
      seenRelations.add(duplicateKey);
    }
  }

  return issues;
}

module.exports = {
  computeItemIntegrityIssues,
};
