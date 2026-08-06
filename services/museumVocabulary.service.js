const Museum = require("../models/museum.model");
const AppError = require("../utils/AppError");
const { buildRelationViews } = require("./relationView.utils");
const { withNormalizedPositions } = require("./vocabularyNormalization.service");

function plain(value) {
  return value && typeof value.toObject === "function" ? value.toObject() : { ...value };
}

function normalizeStringArray(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
}

function normalizeRelationTypes(values) {
  return Array.isArray(values)
    ? values.map(plain).filter((value) => value?.key)
    : [];
}

function buildItemTypeVocabulary(vocabulary, itemType) {
  const allowed = (types = []) => !types.length || types.includes(itemType);
  return {
    museumId: vocabulary.museumId,
    vocabularyRevision: vocabulary.vocabularyRevision,
    itemType,
    isKnownItemType: vocabulary.itemTypes.includes(itemType),
    itemTypes: vocabulary.itemTypes,
    languageLevels: vocabulary.languageLevels,
    durationTypes: vocabulary.durationTypes,
    relationTypes: vocabulary.relationTypes.filter((type) => allowed(type.domain)),
    relationViews: vocabulary.relationViews.filter((view) => allowed(view.domain)),
  };
}

async function getMuseumVocabulary(museumId) {
  const museum = await Museum.findById(museumId).lean();
  if (!museum) throw new AppError("Museo non trovato", 404);

  const config = museum.config || {};
  const relationTypes = normalizeRelationTypes(config.relationTypes);
  return {
    museumId: museum._id,
    vocabularyRevision: museum.vocabularyRevision || 1,
    itemTypes: normalizeStringArray(config.itemTypes),
    languageLevels: withNormalizedPositions((config.languageLevels || []).map(plain)),
    durationTypes: withNormalizedPositions((config.durationTypes || []).map(plain)),
    relationTypes,
    relationViews: buildRelationViews(relationTypes),
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
