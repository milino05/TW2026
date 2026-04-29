const Museum = require("../models/museum.model");
const AppError = require("../utils/AppError");
const { buildRelationViews } = require("./relationView.utils");

function normalizeStringArray(values) {
  return Array.isArray(values)
    ? values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

function normalizeDurationTypes(durationTypes) {
  return Array.isArray(durationTypes)
    ? durationTypes
        .filter(Boolean)
        .map((durationType) => ({
          key: typeof durationType.key === "string" ? durationType.key.trim().toLowerCase() : "",
          label: typeof durationType.label === "string" ? durationType.label.trim() : "",
          level: durationType.level,
          description: typeof durationType.description === "string" ? durationType.description.trim() : undefined,
        }))
        .filter((durationType) => durationType.key)
    : [];
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

async function getMuseumVocabulary(museumId) {
  const museum = await Museum.findById(museumId).lean();

  if (!museum) {
    throw new AppError("Museo non trovato", 404);
  }

  const config = museum.config || {};

  const relationTypes = normalizeRelationTypes(config.relationTypes);
  const relationViews = buildRelationViews(relationTypes);

  return {
    museumId: museum._id,
    itemTypes: normalizeStringArray(config.itemTypes),
    languageLevels: normalizeStringArray(config.languageLevels),
    durationTypes: normalizeDurationTypes(config.durationTypes),
    relationTypes,
    relationViews,
  };
}

module.exports = {
  getMuseumVocabulary,
};
