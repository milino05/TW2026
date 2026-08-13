const Museum = require("../models/museum.model");
const MuseumVocabulary = require("../models/museumVocabulary.model");
const MuseumVocabularyRevision = require("../models/museumVocabularyRevision.model");
const AppError = require("../utils/AppError");
const { buildRelationViews } = require("./relationView.utils");
const { withNormalizedPositions } = require("./vocabularyNormalization.service");
const { legacyConfigToVocabulary } = require("./validation/vocabulary.validation");

function plain(value) {
  return value && typeof value.toObject === "function" ? value.toObject() : { ...value };
}

function normalizeRelationTypes(values) {
  return Array.isArray(values) ? values.map(plain).filter((value) => value?.key) : [];
}

function materializeVocabulary({ museumId, version, revisionId = null, source }) {
  const itemTypeDefinitions = (source.itemTypes || []).map(plain).filter((entry) => entry?.key);
  const relationTypes = normalizeRelationTypes(source.relationTypes);
  return {
    museumId,
    vocabularyRevision: Number(version) || 1,
    vocabularyRevisionId: revisionId,
    itemTypes: itemTypeDefinitions.map((entry) => entry.key),
    itemTypeDefinitions,
    languageLevels: withNormalizedPositions((source.languageLevels || []).map(plain)),
    durationTypes: withNormalizedPositions((source.durationTypes || []).map(plain)),
    relationTypes,
    relationViews: buildRelationViews(relationTypes),
    presentationAspects: (source.presentationAspects || []).map(plain),
  };
}

function buildItemTypeVocabulary(vocabulary, itemType) {
  const allowed = (types = []) => !types.length || types.includes(itemType);
  const definition = vocabulary.itemTypeDefinitions.find((entry) => entry.key === itemType) || null;
  return {
    museumId: vocabulary.museumId,
    vocabularyRevision: vocabulary.vocabularyRevision,
    vocabularyRevisionId: vocabulary.vocabularyRevisionId,
    itemType,
    itemTypeDefinition: definition,
    capabilities: definition?.capabilities || [],
    isKnownItemType: Boolean(definition),
    itemTypes: vocabulary.itemTypes,
    itemTypeDefinitions: vocabulary.itemTypeDefinitions,
    languageLevels: vocabulary.languageLevels,
    durationTypes: vocabulary.durationTypes,
    relationTypes: vocabulary.relationTypes.filter((type) => allowed(type.domain)),
    relationViews: vocabulary.relationViews.filter((view) => allowed(view.domain)),
    presentationAspects: vocabulary.presentationAspects,
  };
}

async function loadPublishedVocabularyRevision(museumId) {
  const stable = await MuseumVocabulary.findOne({ museumId }).lean();
  if (!stable?.publishedRevisionId) return null;
  const revision = await MuseumVocabularyRevision.findById(stable.publishedRevisionId).lean();
  if (!revision || revision.status !== "published") return null;
  return { stable, revision };
}

async function getMuseumVocabulary(museumId) {
  const museum = await Museum.findById(museumId).lean();
  if (!museum) throw new AppError("Museo non trovato", 404);

  const published = await loadPublishedVocabularyRevision(museumId);
  if (published) {
    return materializeVocabulary({
      museumId: museum._id,
      version: published.revision.version,
      revisionId: published.revision._id,
      source: published.revision,
    });
  }

  // Compatibilita per database creati prima del vocabolario revisionato.
  const legacy = legacyConfigToVocabulary(museum.config || {});
  return materializeVocabulary({
    museumId: museum._id,
    version: museum.vocabularyRevision || 1,
    revisionId: null,
    source: legacy,
  });
}

async function getItemTypeVocabulary({ museumId, itemType }) {
  const vocabulary = await getMuseumVocabulary(museumId);
  if (!vocabulary.itemTypes.includes(itemType)) {
    throw new AppError("itemType non valido per il museo", 400, [{
      field: "itemType",
      code: "INVALID_CONTROLLED_VALUE",
      message: `itemType non valido: ${itemType}`,
      allowedValues: vocabulary.itemTypes,
    }]);
  }
  return buildItemTypeVocabulary(vocabulary, itemType);
}

module.exports = {
  getMuseumVocabulary,
  buildItemTypeVocabulary,
  getItemTypeVocabulary,
  loadPublishedVocabularyRevision,
  materializeVocabulary,
};
