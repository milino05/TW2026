const MuseumConfig = require("../models/museumConfig.model");
const RelationType = require("../models/relationType.model");
const AppError = require("../utils/AppError");

async function getEditorVocabulary(museumId) {
  const museumConfig = await MuseumConfig.findById(museumId).lean();

  if (!museumConfig) {
    throw new AppError("Museo non trovato", 404);
  }

  const relationTypeIds = Array.isArray(museumConfig.relationTypes)
    ? museumConfig.relationTypes
    : [];

  const relationTypes = await RelationType.find({
    _id: { $in: relationTypeIds },
  })
    .select("_id key label domain range category allowMultiple")
    .lean();

  return {
    museumId: museumConfig._id,
    itemTypes: Array.isArray(museumConfig.itemTypes) ? museumConfig.itemTypes : [],
    languageLevels: Array.isArray(museumConfig.languageLevels)
      ? museumConfig.languageLevels
      : [],
    durationTypes: Array.isArray(museumConfig.durationTypes)
      ? museumConfig.durationTypes
      : [],
    relationTypes,
  };
}

module.exports = {
  getEditorVocabulary,
};
