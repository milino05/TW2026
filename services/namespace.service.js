const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const {
  normalizeNamespaceMetadataPayload,
  validateNamespaceMetadataPayload,
} = require("./validation/namespace.validation");
const {
  createInitialRevisionForNamespace,
  snapshot,
} = require("./namespaceRevision.service");
const { regenerateDefinitionIdsForFork } = require("./namespaceDefinitionIdentity.service");

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizeNamespaceMetadataPayload(rawPayload || {});
  const validationPayload = { ...(rawPayload || {}), ...normalized };
  const issues = validateNamespaceMetadataPayload(validationPayload, { creating });
  if (issues.length) throw new AppError("Payload Namespace non valido", 400, issues);
  return normalized;
}

async function findNamespaceOrFail({ namespaceId, includeTrashed = false }) {
  const query = { _id: namespaceId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const namespace = await Namespace.findOne(query);
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  return namespace;
}

async function createNamespace({ payload, actorUserId }) {
  const rawPayload = payload || {};
  const normalized = validateMetadata(rawPayload, { creating: true });
  await assertCanActForOwner({
    actorUserId,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    minimumOrganizationRole: "operator",
  });

  const namespace = await Namespace.create({
    name: normalized.name,
    description: normalized.description ?? null,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    createdBy: actorUserId,
  });

  try {
    const revision = await createInitialRevisionForNamespace({
      namespaceId: namespace._id,
      actorUserId,
      payload: rawPayload.revision || {},
    });
    namespace.workingRevisionId = revision._id;
    await namespace.save();
    return { namespace, revision };
  } catch (error) {
    await NamespaceRevision.deleteMany({ namespaceId: namespace._id }).catch(() => {});
    await namespace.deleteOne().catch(() => {});
    throw error;
  }
}

async function updateNamespace({ namespaceId, payload, actorUserId }) {
  const namespace = await findNamespaceOrFail({ namespaceId });
  await assertCanActForOwner({
    actorUserId,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    minimumOrganizationRole: "operator",
  });
  const normalized = validateMetadata(payload || {}, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "name")) namespace.name = normalized.name;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) namespace.description = normalized.description ?? null;
  await namespace.save();
  return namespace;
}

async function listNamespaces({ ownerType = null, ownerId = null } = {}) {
  if (ownerType && !["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400);
  if (ownerId && !mongoose.isValidObjectId(ownerId)) throw new AppError("ownerId non valido", 400);
  const query = { lifecycleStatus: "active" };
  if (ownerType) query.ownerType = ownerType;
  if (ownerId) query.ownerId = ownerId;
  return Namespace.find(query).sort({ name: 1, createdAt: 1 });
}

async function getNamespaceById({ namespaceId }) {
  return findNamespaceOrFail({ namespaceId });
}

async function forkNamespace({ namespaceId, payload, actorUserId }) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, "revision")) throw new AppError("La revisione del fork deriva dal Namespace sorgente", 400, [{ field: "revision", code: "FORBIDDEN_FIELD" }]);
  const source = await findNamespaceOrFail({ namespaceId });
  if (!source.publishedRevisionId) throw new AppError("Il Namespace sorgente deve avere una revisione pubblicata", 409);
  const sourceRevision = await NamespaceRevision.findById(source.publishedRevisionId);
  if (!sourceRevision || sourceRevision.status !== "published") throw new AppError("Revisione pubblicata sorgente non disponibile", 409);

  const rawPayload = {
    ...(payload || {}),
    name: payload?.name || `${source.name} (fork)`,
  };
  const normalized = validateMetadata(rawPayload, { creating: true });
  await assertCanActForOwner({
    actorUserId,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    minimumOrganizationRole: "operator",
  });

  const { snapshot: forkedDefinitions } = regenerateDefinitionIdsForFork(snapshot(sourceRevision));
  const namespace = await Namespace.create({
    name: normalized.name,
    description: normalized.description ?? source.description ?? null,
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    forkedFromNamespaceId: source._id,
    forkedFromNamespaceRevisionId: sourceRevision._id,
    createdBy: actorUserId,
  });

  try {
    const revision = await createInitialRevisionForNamespace({
      namespaceId: namespace._id,
      actorUserId,
      payload: forkedDefinitions,
    });
    namespace.workingRevisionId = revision._id;
    await namespace.save();
    return { namespace, revision };
  } catch (error) {
    await NamespaceRevision.deleteMany({ namespaceId: namespace._id }).catch(() => {});
    await namespace.deleteOne().catch(() => {});
    throw error;
  }
}

module.exports = {
  findNamespaceOrFail,
  createNamespace,
  updateNamespace,
  listNamespaces,
  getNamespaceById,
  forkNamespace,
};
