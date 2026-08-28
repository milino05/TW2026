const mongoose = require("mongoose");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertCanUsePhysicalVocabularyForFork } = require("./physicalVocabularyUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const {
  normalizePhysicalVocabularyMetadataPayload,
  validatePhysicalVocabularyMetadataPayload,
} = require("./validation/physicalVocabulary.validation");
const {
  createInitialRevisionForPhysicalVocabulary,
  snapshot,
} = require("./physicalVocabularyRevision.service");
const { regenerateDefinitionIdsForFork } = require("./physicalVocabularyDefinitionIdentity.service");

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizePhysicalVocabularyMetadataPayload(rawPayload || {});
  const issues = validatePhysicalVocabularyMetadataPayload({ ...(rawPayload || {}), ...normalized }, { creating });
  if (issues.length) throw new AppError("Payload Physical Vocabulary non valido", 400, issues);
  return normalized;
}

async function findPhysicalVocabularyOrFail({ physicalVocabularyId, includeTrashed = false }) {
  const query = { _id: physicalVocabularyId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const physicalVocabulary = await PhysicalVocabulary.findOne(query);
  if (!physicalVocabulary) throw new AppError("Physical Vocabulary non trovato", 404);
  return physicalVocabulary;
}

async function createPhysicalVocabulary({ payload, actorUserId }) {
  const rawPayload = payload || {};
  const normalized = validateMetadata(rawPayload, { creating: true });
  await assertCanActForOwner({
    actorUserId,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    permissionCode: "physical_vocabulary.create",
  });
  const physicalVocabulary = await PhysicalVocabulary.create({
    name: normalized.name,
    description: normalized.description ?? null,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    createdBy: actorUserId,
  });
  try {
    const revision = await createInitialRevisionForPhysicalVocabulary({
      physicalVocabularyId: physicalVocabulary._id,
      actorUserId,
      payload: rawPayload.revision || {},
      applyStarter: normalized.applyStarter === true,
    });
    physicalVocabulary.workingRevisionId = revision._id;
    await physicalVocabulary.save();
    return { physicalVocabulary, revision };
  } catch (error) {
    await PhysicalVocabularyRevision.deleteMany({ physicalVocabularyId: physicalVocabulary._id }).catch(() => {});
    await physicalVocabulary.deleteOne().catch(() => {});
    throw error;
  }
}

async function updatePhysicalVocabulary({ physicalVocabularyId, payload, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail({ physicalVocabularyId });
  await assertCanActForOwner({ actorUserId, ownerType: physicalVocabulary.ownerType, ownerId: physicalVocabulary.ownerId, permissionCode: "physical_vocabulary.edit" });
  const normalized = validateMetadata(payload || {}, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "name")) physicalVocabulary.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) physicalVocabulary.description = normalized.description ?? null;
  await physicalVocabulary.save();
  return physicalVocabulary;
}

async function listPhysicalVocabularies({ ownerType = null, ownerId = null, lifecycleStatus = "active", actorUserId }) {
  if (ownerType && !["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400);
  if (ownerId && !mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400);
  if (!["active", "trashed"].includes(lifecycleStatus)) throw new AppError("lifecycleStatus non valido", 400);
  if (ownerType || ownerId) {
    if (!ownerType || !ownerId) throw new AppError("ownerType e ownerId devono essere specificati insieme", 400);
    await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "physical_vocabulary.view" });
  }
  const query = { lifecycleStatus };
  if (ownerType) query.ownerType = ownerType;
  if (ownerId) query.ownerId = ownerId;
  if (!ownerType) {
    query.ownerType = "user";
    query.ownerId = actorUserId;
  }
  return PhysicalVocabulary.find(query).sort({ name: 1, createdAt: 1 });
}

async function getPhysicalVocabularyById({ physicalVocabularyId }) {
  return findPhysicalVocabularyOrFail({ physicalVocabularyId });
}

async function forkPhysicalVocabulary({ physicalVocabularyId, payload, actorUserId }) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, "revision") || Object.prototype.hasOwnProperty.call(payload || {}, "applyStarter")) {
    throw new AppError("La revisione del fork deriva dal Physical Vocabulary sorgente", 400, [{ field: "revision", code: "FORBIDDEN_FIELD" }]);
  }
  const source = await findPhysicalVocabularyOrFail({ physicalVocabularyId });
  const rawPayload = { ...(payload || {}), name: payload?.name || `${source.name} (fork)` };
  const normalized = validateMetadata(rawPayload, { creating: true });
  await assertCanActForOwner({ actorUserId, ownerType: normalized.ownerType, ownerId: normalized.ownerId, permissionCode: "physical_vocabulary.create" });
  const access = await assertCanUsePhysicalVocabularyForFork({
    physicalVocabulary: source,
    actorUserId,
    principalType: normalized.ownerType,
    principalId: normalized.ownerId,
  });
  const sourceRef = access.resolvedSnapshotRef;
  if (sourceRef?.resourceType !== "physical_vocabulary_revision") throw new AppError("Fork senza revisione autorizzata", 409, [{ code: "AUTHORIZED_PHYSICAL_VOCABULARY_REVISION_REQUIRED" }]);
  const sourceRevision = await PhysicalVocabularyRevision.findOne({
    _id: sourceRef.resourceId,
    physicalVocabularyId: source._id,
    status: { $in: ["published", "superseded"] },
  });
  if (!sourceRevision) throw new AppError("Revisione Physical Vocabulary autorizzata non disponibile", 409, [{ code: "AUTHORIZED_PHYSICAL_VOCABULARY_REVISION_UNAVAILABLE" }]);

  const { snapshot: definitions } = regenerateDefinitionIdsForFork(snapshot(sourceRevision));
  const physicalVocabulary = await PhysicalVocabulary.create({
    name: normalized.name,
    description: normalized.description ?? source.description ?? null,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    forkedFromPhysicalVocabularyId: source._id,
    forkedFromPhysicalVocabularyRevisionId: sourceRevision._id,
    createdBy: actorUserId,
  });
  try {
    const revision = await createInitialRevisionForPhysicalVocabulary({ physicalVocabularyId: physicalVocabulary._id, actorUserId, payload: definitions });
    physicalVocabulary.workingRevisionId = revision._id;
    await physicalVocabulary.save();
    await recordAdoptionFromAccess({
      access,
      actorUserId,
      action: "physical_vocabulary_fork",
      sourceResourceRef: { resourceType: "physical_vocabulary", resourceId: source._id },
      sourceSnapshotRef: { resourceType: "physical_vocabulary_revision", resourceId: sourceRevision._id },
      resultResourceRef: { resourceType: "physical_vocabulary", resourceId: physicalVocabulary._id },
    });
    return { physicalVocabulary, revision };
  } catch (error) {
    await PhysicalVocabularyRevision.deleteMany({ physicalVocabularyId: physicalVocabulary._id }).catch(() => {});
    await physicalVocabulary.deleteOne().catch(() => {});
    throw error;
  }
}

async function trashPhysicalVocabulary({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail({ physicalVocabularyId });
  await assertCanActForOwner({ actorUserId, ownerType: physicalVocabulary.ownerType, ownerId: physicalVocabulary.ownerId, permissionCode: "physical_vocabulary.lifecycle.manage" });
  physicalVocabulary.lifecycleStatus = "trashed";
  physicalVocabulary.trashedAt = new Date();
  physicalVocabulary.trashedBy = actorUserId;
  await physicalVocabulary.save();
  return physicalVocabulary;
}

async function restorePhysicalVocabulary({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await findPhysicalVocabularyOrFail({ physicalVocabularyId, includeTrashed: true });
  await assertCanActForOwner({ actorUserId, ownerType: physicalVocabulary.ownerType, ownerId: physicalVocabulary.ownerId, permissionCode: "physical_vocabulary.lifecycle.manage" });
  if (physicalVocabulary.lifecycleStatus !== "trashed") throw new AppError("Il Physical Vocabulary non e nel cestino", 409);
  physicalVocabulary.lifecycleStatus = "active";
  physicalVocabulary.trashedAt = null;
  physicalVocabulary.trashedBy = null;
  await physicalVocabulary.save();
  return physicalVocabulary;
}

module.exports = {
  findPhysicalVocabularyOrFail,
  createPhysicalVocabulary,
  updatePhysicalVocabulary,
  listPhysicalVocabularies,
  getPhysicalVocabularyById,
  forkPhysicalVocabulary,
  trashPhysicalVocabulary,
  restorePhysicalVocabulary,
};
