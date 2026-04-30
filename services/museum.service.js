const Museum = require("../models/museum.model");
const Item = require("../models/item.model");
const AppError = require("../utils/AppError");

const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { auditItemsAfterMuseumConfigChange } = require("./itemIntegrity.service");

const { normalizeMuseumPayload, validateMuseumPayload } = require("./validation/museum.validation");

const { hasOwn, isPlainObject } = require("./validation/validation.utils");

function buildMergedConfig(existingConfig = {}, rawConfig = {}, normalizedConfig = {}) {
  return {
    languageLevels: hasOwn(rawConfig, "languageLevels") ? normalizedConfig.languageLevels : existingConfig.languageLevels,

    durationTypes: hasOwn(rawConfig, "durationTypes") ? normalizedConfig.durationTypes : existingConfig.durationTypes,

    itemTypes: hasOwn(rawConfig, "itemTypes") ? normalizedConfig.itemTypes : existingConfig.itemTypes,

    relationTypes: hasOwn(rawConfig, "relationTypes") ? normalizedConfig.relationTypes : existingConfig.relationTypes,
  };
}

function buildMergedPayload(existingMuseum, rawPayload, normalizedPayload) {
  return {
    name: hasOwn(rawPayload, "name") ? normalizedPayload.name : existingMuseum.name,

    config: hasOwn(rawPayload, "config") ? (isPlainObject(rawPayload.config) ? buildMergedConfig(existingMuseum.config || {}, rawPayload.config || {}, normalizedPayload.config || {}) : normalizedPayload.config) : existingMuseum.config,
  };
}

async function findMuseumByIdOrFail({ museumId }) {
  const museum = await Museum.findById(museumId);

  if (!museum) {
    throw new AppError("Museo non trovato", 404);
  }

  return museum;
}

async function createMuseum({ payload }) {
  const normalizedPayload = normalizeMuseumPayload(payload);

  const validationErrors = validateMuseumPayload({
    payload: normalizedPayload,
  });

  const errors = validationErrors;

  if (errors.length > 0) {
    throw new AppError("Payload non valido", 400, errors);
  }

  const museum = new Museum(normalizedPayload);

  await museum.save();

  return museum;
}

async function updateMuseum({ museumId, payload }) {
  const existingMuseum = await findMuseumByIdOrFail({ museumId });

  const normalizedPayload = normalizeMuseumPayload(payload);

  const mergedPayload = buildMergedPayload(existingMuseum.toObject(), payload, normalizedPayload);

  const validationErrors = validateMuseumPayload({
    payload: mergedPayload,
  });

  const errors = validationErrors;

  if (errors.length > 0) {
    throw new AppError("Payload non valido", 400, errors);
  }

  const configChanged = hasOwn(payload, "config");

  Object.assign(existingMuseum, mergedPayload);

  await existingMuseum.save();

  let audit = null;

  if (configChanged) {
    const vocabulary = await getMuseumVocabulary(museumId);

    audit = await auditItemsAfterMuseumConfigChange({
      museumId,
      vocabulary,
    });
  }

  return {
    museum: existingMuseum,
    audit,
  };
}

async function listMuseums() {
  return Museum.find().sort({ name: 1 });
}

async function getMuseumById({ museumId }) {
  return findMuseumByIdOrFail({ museumId });
}

async function deleteMuseum({ museumId }) {
  const museum = await findMuseumByIdOrFail({ museumId });

  const hasItems = await Item.exists({ museumId });

  if (hasItems) {
    throw new AppError("Impossibile eliminare il museo: esistono item associati", 409);
  }

  await museum.deleteOne();

  return museum;
}

module.exports = {
  createMuseum,
  updateMuseum,
  listMuseums,
  getMuseumById,
  deleteMuseum,
};
