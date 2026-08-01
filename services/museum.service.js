const Museum = require("../models/museum.model");
const Item = require("../models/item.model");
const Visit = require("../models/visit");
const User = require("../models/user");
const AppError = require("../utils/AppError");

const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { auditItemsAfterMuseumConfigChange } = require("./itemIntegrity.service");
const { assertMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");
const { normalizeMuseumPayload, validateMuseumPayload } = require("./validation/museum.validation");
const { hasOwn, isPlainObject } = require("./validation/validation.utils");

function buildMergedConfig(existingConfig = {}, rawConfig = {}, normalizedConfig = {}) {
  return {
    languageLevels: hasOwn(rawConfig, "languageLevels")
      ? normalizedConfig.languageLevels
      : existingConfig.languageLevels,
    durationTypes: hasOwn(rawConfig, "durationTypes")
      ? normalizedConfig.durationTypes
      : existingConfig.durationTypes,
    itemTypes: hasOwn(rawConfig, "itemTypes")
      ? normalizedConfig.itemTypes
      : existingConfig.itemTypes,
    relationTypes: hasOwn(rawConfig, "relationTypes")
      ? normalizedConfig.relationTypes
      : existingConfig.relationTypes,
  };
}

function buildMergedPayload(existingMuseum, rawPayload, normalizedPayload) {
  return {
    name: hasOwn(rawPayload, "name") ? normalizedPayload.name : existingMuseum.name,
    config: hasOwn(rawPayload, "config")
      ? isPlainObject(rawPayload.config)
        ? buildMergedConfig(
            existingMuseum.config || {},
            rawPayload.config || {},
            normalizedPayload.config || {},
          )
        : normalizedPayload.config
      : existingMuseum.config,
  };
}

async function findMuseumByIdOrFail({ museumId }) {
  const museum = await Museum.findById(museumId);
  if (!museum) throw new AppError("Museo non trovato", 404);
  return museum;
}

async function createMuseum({ payload, actorUserId }) {
  const creator = await getActiveUserOrFail(actorUserId);
  const normalizedPayload = normalizeMuseumPayload(payload);
  const errors = validateMuseumPayload({ payload: normalizedPayload });

  if (errors.length > 0) {
    throw new AppError("Payload non valido", 400, errors);
  }

  const museum = new Museum({
    ...normalizedPayload,
    createdBy: creator._id,
  });

  await museum.save();

  try {
    creator.memberships.push({ museumId: museum._id, role: "manager" });
    await creator.save();
  } catch (error) {
    await museum.deleteOne().catch(() => {});
    throw error;
  }

  return museum;
}

async function updateMuseum({ museumId, payload, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const existingMuseum = await findMuseumByIdOrFail({ museumId });
  const normalizedPayload = normalizeMuseumPayload(payload);
  const mergedPayload = buildMergedPayload(
    existingMuseum.toObject(),
    payload,
    normalizedPayload,
  );
  const errors = validateMuseumPayload({ payload: mergedPayload });

  if (errors.length > 0) {
    throw new AppError("Payload non valido", 400, errors);
  }

  const configChanged = hasOwn(payload, "config");
  Object.assign(existingMuseum, mergedPayload);
  await existingMuseum.save();

  let audit = null;
  if (configChanged) {
    const vocabulary = await getMuseumVocabulary(museumId);
    audit = await auditItemsAfterMuseumConfigChange({ museumId, vocabulary });
  }

  return { museum: existingMuseum, audit };
}

async function assignMuseumRole({ museumId, targetUserId, role, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  await findMuseumByIdOrFail({ museumId });

  if (!["operator", "manager"].includes(role)) {
    throw new AppError("Ruolo non valido", 400, [
      {
        field: "role",
        code: "INVALID_ENUM",
        message: "role deve essere operator oppure manager",
        allowedValues: ["operator", "manager"],
      },
    ]);
  }

  const targetUser = await User.findOne({ _id: targetUserId, status: "active" });
  if (!targetUser) throw new AppError("Utente destinatario non trovato o non attivo", 404);

  const membership = (targetUser.memberships || []).find(
    (entry) => String(entry.museumId) === String(museumId),
  );

  if (membership?.role === "manager" && role === "operator") {
    throw new AppError(
      "La retrocessione da manager a operator non e stata ancora definita",
      409,
      [
        {
          field: "role",
          code: "MANAGER_DEMOTION_NOT_DEFINED",
          message: "Definire prima regole di retrocessione, revoca e tutela dell'ultimo manager",
        },
      ],
    );
  }

  if (membership) {
    membership.role = role;
  } else {
    targetUser.memberships.push({ museumId, role });
  }

  await targetUser.save();

  return {
    userId: targetUser._id,
    username: targetUser.username,
    museumId,
    role,
  };
}

async function listMuseums() {
  return Museum.find().sort({ name: 1 });
}

async function getMuseumById({ museumId }) {
  return findMuseumByIdOrFail({ museumId });
}

async function deleteMuseum({ museumId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });

  const [hasItems, hasVisits] = await Promise.all([
    Item.exists({ museumId }),
    Visit.exists({ $or: [{ ownerMuseumId: museumId }, { museumIds: museumId }] }),
  ]);

  if (hasItems || hasVisits) {
    throw new AppError(
      "Impossibile eliminare il museo: esistono item o visite associati",
      409,
    );
  }

  await museum.deleteOne();
  await User.updateMany(
    { "memberships.museumId": museumId },
    { $pull: { memberships: { museumId } } },
  );

  return museum;
}

module.exports = {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  listMuseums,
  getMuseumById,
  deleteMuseum,
};
