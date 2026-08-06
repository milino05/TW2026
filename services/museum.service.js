const Museum = require("../models/museum.model");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const User = require("../models/user");
const AppError = require("../utils/AppError");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { auditItemsAfterMuseumConfigChange } = require("./itemIntegrity.service");
const { invalidateVisitsUsingMuseumVocabulary } = require("./visitDependency.service");
const { assertMuseumRole, getActiveUserOrFail } = require("./museumAuthorization.service");
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
    config: hasOwn(rawPayload, "config")
      ? isPlainObject(rawPayload.config)
        ? buildMergedConfig(existingMuseum.config || {}, rawPayload.config || {}, normalizedPayload.config || {})
        : normalizedPayload.config
      : existingMuseum.config,
  };
}

function removedKeys(previous = [], next = []) {
  const nextKeys = new Set((next || []).map((entry) => entry.key));
  return (previous || []).map((entry) => entry.key).filter((key) => !nextKeys.has(key));
}

async function assertVocabularyKeysNotRemovedWhileInUse({ museumId, previousConfig, nextConfig }) {
  const removed = {
    languageLevels: removedKeys(previousConfig.languageLevels, nextConfig.languageLevels),
    durationTypes: removedKeys(previousConfig.durationTypes, nextConfig.durationTypes),
    itemTypes: (previousConfig.itemTypes || []).filter((key) => !(nextConfig.itemTypes || []).includes(key)),
    relationTypes: removedKeys(previousConfig.relationTypes, nextConfig.relationTypes),
  };

  if (Object.values(removed).every((values) => values.length === 0)) return;

  const activeRevisionStatuses = ["draft", "in_review", "changes_requested", "published"];
  const [itemIds, visitIds] = await Promise.all([
    Item.find({ museumId }).distinct("_id"),
    Visit.find({ ownerMuseumId: museumId }).distinct("_id"),
  ]);

  const [
    usedLanguageKeys,
    usedDurationKeys,
    usedRelationKeys,
    usedVisitLanguageKeys,
    usedVisitDurationKeys,
    usedItemTypes,
  ] = await Promise.all([
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: activeRevisionStatuses } })
      .distinct("representations.languageLevelKey"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: activeRevisionStatuses } })
      .distinct("representations.durationKey"),
    ItemRevision.find({ itemId: { $in: itemIds }, status: { $in: activeRevisionStatuses } })
      .distinct("relations.relationTypeKey"),
    VisitRevision.find({ visitId: { $in: visitIds }, status: { $in: activeRevisionStatuses } })
      .distinct("defaultPresentationPolicy.languageLevelKey"),
    VisitRevision.find({ visitId: { $in: visitIds }, status: { $in: activeRevisionStatuses } })
      .distinct("defaultPresentationPolicy.durationKey"),
    Item.find({ museumId }).distinct("itemType"),
  ]);

  const usedSets = {
    languageLevels: new Set([...usedLanguageKeys, ...usedVisitLanguageKeys]),
    durationTypes: new Set([...usedDurationKeys, ...usedVisitDurationKeys]),
    relationTypes: new Set(usedRelationKeys),
    itemTypes: new Set(usedItemTypes),
  };
  const fieldNames = {
    languageLevels: "languageLevel",
    durationTypes: "durationType",
    relationTypes: "relationType",
    itemTypes: "itemType",
  };
  const errors = [];
  for (const [group, keys] of Object.entries(removed)) {
    for (const key of keys) {
      if (usedSets[group].has(key)) {
        errors.push({
          field: `config.${group}`,
          code: "VOCABULARY_KEY_IN_USE",
          message: `${fieldNames[group]} ${key} e ancora usato`,
        });
      }
    }
  }

  if (errors.length) {
    throw new AppError("Impossibile rimuovere chiavi del vocabolario ancora utilizzate", 409, errors);
  }
}

async function findMuseumByIdOrFail({ museumId }) {
  const museum = await Museum.findById(museumId);
  if (!museum) throw new AppError("Museo non trovato", 404);
  return museum;
}

async function createMuseum({ payload, actorUserId }) {
  const creator = await getActiveUserOrFail(actorUserId);
  const normalized = normalizeMuseumPayload(payload);
  const errors = validateMuseumPayload({ payload: normalized });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);

  const museum = new Museum({
    ...normalized,
    createdBy: creator._id,
    vocabularyRevision: 1,
  });
  await museum.save();
  try {
    creator.memberships.push({
      museumId: museum._id,
      role: "manager",
      assignedBy: creator._id,
      assignedAt: new Date(),
    });
    await creator.save();
  } catch (error) {
    await museum.deleteOne().catch(() => {});
    throw error;
  }
  return museum;
}

async function updateMuseum({ museumId, payload, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  const normalized = normalizeMuseumPayload(payload);
  const merged = buildMergedPayload(museum.toObject(), payload, normalized);
  const errors = validateMuseumPayload({ payload: merged });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);

  const configChanged = hasOwn(payload, "config") && isPlainObject(payload.config) && Object.keys(payload.config).length > 0;
  if (configChanged) {
    await assertVocabularyKeysNotRemovedWhileInUse({
      museumId,
      previousConfig: museum.config?.toObject ? museum.config.toObject() : museum.config || {},
      nextConfig: merged.config || {},
    });
  }
  museum.name = merged.name;
  museum.config = merged.config;
  if (configChanged) museum.vocabularyRevision += 1;
  await museum.save();

  let audit = null;
  if (configChanged) {
    const vocabulary = await getMuseumVocabulary(museumId);
    const itemAudit = await auditItemsAfterMuseumConfigChange({ museumId, vocabulary });
    const visitAudit = await invalidateVisitsUsingMuseumVocabulary({
      museumId,
      vocabularyRevision: museum.vocabularyRevision,
    });
    audit = { itemAudit, visitAudit };
  }
  return { museum, audit };
}

async function assignMuseumRole({ museumId, targetUserId, role, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  if (!["operator", "manager"].includes(role)) {
    throw new AppError("Ruolo non valido", 400, [{
      field: "role",
      code: "INVALID_ENUM",
      message: "role deve essere operator oppure manager",
      allowedValues: ["operator", "manager"],
    }]);
  }

  const target = await User.findOne({ _id: targetUserId, status: "active" });
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  const membership = (target.memberships || []).find((entry) => String(entry.museumId) === String(museumId));

  if (String(target._id) === String(museum.createdBy) && role !== "manager") {
    throw new AppError("Il creatore del museo deve rimanere manager", 409);
  }
  if (membership?.role === "manager" && role === "operator") {
    if (String(actorUserId) !== String(museum.createdBy)) {
      throw new AppError("Solo il creatore del museo puo retrocedere un manager", 403);
    }
  }

  if (!membership && role === "manager") {
    throw new AppError("Un utente deve prima essere assegnato come operator prima di essere promosso a manager", 409);
  }

  if (membership) {
    membership.role = role;
    membership.assignedBy = actorUserId;
    membership.assignedAt = new Date();
  } else {
    target.memberships.push({ museumId, role, assignedBy: actorUserId, assignedAt: new Date() });
  }
  await target.save();
  return { userId: target._id, username: target.username, museumId, role };
}

async function assignMuseumRoleByUsername({ museumId, username, role, actorUserId }) {
  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (!normalizedUsername) {
    throw new AppError("username e obbligatorio", 400, [{
      field: "username",
      code: "REQUIRED",
      message: "Inserire lo username esatto dell'utente",
    }]);
  }
  const target = await User.findOne({ username: normalizedUsername, status: "active" }).select("_id");
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  return assignMuseumRole({
    museumId,
    targetUserId: target._id,
    role,
    actorUserId,
  });
}

async function removeMuseumMember({ museumId, targetUserId, actorUserId }) {
  await assertMuseumRole({ userId: actorUserId, museumId, minimumRole: "manager" });
  const museum = await findMuseumByIdOrFail({ museumId });
  const target = await User.findOne({ _id: targetUserId, status: "active" });
  if (!target) throw new AppError("Utente destinatario non trovato o non attivo", 404);
  const membership = (target.memberships || []).find((entry) => String(entry.museumId) === String(museumId));
  if (!membership) throw new AppError("L'utente non appartiene al museo", 404);
  if (String(target._id) === String(museum.createdBy)) {
    throw new AppError("Il creatore del museo non puo essere rimosso", 409);
  }
  if (membership.role === "manager") {
    throw new AppError("Un manager deve prima essere retrocesso dal creatore del museo", 409);
  }
  target.memberships = target.memberships.filter((entry) => String(entry.museumId) !== String(museumId));
  await target.save();
  return { userId: target._id, museumId, removedRole: "operator" };
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
    Visit.exists({ ownerMuseumId: museumId }),
  ]);
  if (hasItems || hasVisits) throw new AppError("Impossibile eliminare il museo: esistono item o visite ufficiali associati", 409);
  await museum.deleteOne();
  await User.updateMany({ "memberships.museumId": museumId }, { $pull: { memberships: { museumId } } });
  return museum;
}

module.exports = {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  assignMuseumRoleByUsername,
  removeMuseumMember,
  listMuseums,
  getMuseumById,
  deleteMuseum,
};
