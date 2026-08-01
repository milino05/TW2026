const Museum = require("../models/museum.model");
const AppError = require("../utils/AppError");
const { buildRelationViews } = require("./relationView.utils");

function normalizeStringArray(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
}

function normalizeOrderedVocabulary(values) {
  return Array.isArray(values)
    ? values
        .filter(Boolean)
        .map((value) => ({
          key: typeof value.key === "string" ? value.key.trim().toLowerCase() : "",
          label: typeof value.label === "string" ? value.label.trim() : "",
          level: value.level,
          description: typeof value.description === "string" ? value.description.trim() : undefined,
        }))
        .filter((value) => value.key)
        .sort((a, b) => a.level - b.level)
    : [];
}

function normalizeDurationTypes(durationTypes) {
  return normalizeOrderedVocabulary(durationTypes);
}

function normalizeLanguageLevelTypes(languageLevels) {
  return normalizeOrderedVocabulary(languageLevels);
}

function normalizeRelationTypes(relationTypes) {
  return Array.isArray(relationTypes)
    ? relationTypes
        .filter(Boolean)
        .map((relationType) => ({
          key: typeof relationType.key === "string" ? relationType.key.trim().toLowerCase() : "",
          label: typeof relationType.label === "string" ? relationType.label.trim() : "",
          description: typeof relationType.description === "string" ? relationType.description.trim() : undefined,
          domain: normalizeStringArray(relationType.domain),
          range: normalizeStringArray(relationType.range),
          category: relationType.category,
          strength: relationType.strength,
          directionality: relationType.directionality === "symmetric" ? "symmetric" : "directed",
          userIntents: normalizeStringArray(relationType.userIntents),
          reverse: relationType.reverse
            ? {
                label: typeof relationType.reverse.label === "string" ? relationType.reverse.label.trim() : undefined,
                description: typeof relationType.reverse.description === "string" ? relationType.reverse.description.trim() : undefined,
                userIntents: normalizeStringArray(relationType.reverse.userIntents),
              }
            : undefined,
          validationRules: {
            allowMultiple: relationType.validationRules?.allowMultiple !== false,
            targetRequired: relationType.validationRules?.targetRequired !== false,
          },
        }))
        .filter((relationType) => relationType.key)
    : [];
}

function isAllowedForItemType(allowedTypes = [], itemType) {
  return !Array.isArray(allowedTypes) || allowedTypes.length === 0 || allowedTypes.includes(itemType);
}

function buildItemTypeVocabulary(vocabulary, itemType) {
  const relationTypes = (vocabulary.relationTypes || []).filter((relationType) => isAllowedForItemType(relationType.domain, itemType));
  const relationViews = (vocabulary.relationViews || []).filter((relationView) => isAllowedForItemType(relationView.domain, itemType));

  return {
    museumId: vocabulary.museumId,
    itemType,
    isKnownItemType: (vocabulary.itemTypes || []).includes(itemType),
    itemTypes: vocabulary.itemTypes || [],
    languageLevels: vocabulary.languageLevels || [],
    languageLevelTypes: vocabulary.languageLevelTypes || [],
    durationTypes: vocabulary.durationTypes || [],
    relationTypes,
    relationViews,
  };
}

async function getMuseumVocabulary(museumId) {
  const museum = await Museum.findById(museumId).lean();

  if (!museum) {
    throw new AppError("Museo non trovato", 404);
  }

  const config = museum.config || {};
  const languageLevelTypes = normalizeLanguageLevelTypes(config.languageLevels);
  const relationTypes = normalizeRelationTypes(config.relationTypes);
  const relationViews = buildRelationViews(relationTypes);

  return {
    museumId: museum._id,
    itemTypes: normalizeStringArray(config.itemTypes),
    // Compatibilita con i validator degli item: le representations salvano la key.
    languageLevels: languageLevelTypes.map((level) => level.key),
    // Metadati ordinati usati dal Navigator per piu/meno semplice.
    languageLevelTypes,
    durationTypes: normalizeDurationTypes(config.durationTypes),
    relationTypes,
    relationViews,
  };
}

async function getItemTypeVocabulary({ museumId, itemType }) {
  const vocabulary = await getMuseumVocabulary(museumId);

  if (!vocabulary.itemTypes.includes(itemType)) {
    throw new AppError("itemType non valido per il museo", 400, [
      {
        field: "itemType",
        code: "INVALID_CONTROLLED_VALUE",
        message: `itemType non valido: ${itemType}`,
        allowedValues: vocabulary.itemTypes,
      },
    ]);
  }

  return buildItemTypeVocabulary(vocabulary, itemType);
}

module.exports = {
  getMuseumVocabulary,
  buildItemTypeVocabulary,
  getItemTypeVocabulary,
};
