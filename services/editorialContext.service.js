const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace, listContentSpaces } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");
const { normalizeEditorialContextPayload, validateEditorialContextPayload } = require("./validation/editorialContext.validation");

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizeEditorialContextPayload(rawPayload || {});
  const issues = validateEditorialContextPayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload EditorialContext non valido", 400, issues);
  return normalized;
}

async function findEditorialContextOrFail({ editorialContextId, includeTrashed = false }) {
  const query = { _id: editorialContextId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const editorialContext = await EditorialContext.findOne(query);
  if (!editorialContext) throw new AppError("EditorialContext non trovato", 404);
  return editorialContext;
}

async function loadContextDependencies(editorialContext) {
  const [contentSpace, namespace] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId: editorialContext.contentSpaceId }),
    Namespace.findOne({ _id: editorialContext.namespaceId, lifecycleStatus: "active" }),
  ]);
  if (!namespace) throw new AppError("Namespace del Context non disponibile", 409);
  return { contentSpace, namespace };
}

async function createEditorialContext({ payload, actorUserId }) {
  const normalized = validateMetadata(payload || {}, { creating: true });
  const [contentSpace, namespace] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId: normalized.contentSpaceId }),
    Namespace.findOne({ _id: normalized.namespaceId, lifecycleStatus: "active" }),
  ]);
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  await assertCanManageContentSpace(contentSpace, actorUserId);
  await assertCanUseNamespaceForEditorialContext({ namespace, actorUserId });
  let editorialContext;
  try {
    editorialContext = await EditorialContext.create({
      contentSpaceId: contentSpace._id,
      namespaceId: namespace._id,
      displayName: normalized.displayName,
      shortDescription: normalized.shortDescription ?? null,
      description: normalized.description ?? null,
      createdBy: actorUserId,
    });
  } catch (error) {
    if (error?.code === 11000) throw new AppError("Esiste gia un EditorialContext per questo ContentSpace e Namespace", 409);
    throw error;
  }
  return projectEditorialContext({ editorialContext, contentSpace, namespace });
}

async function updateEditorialContext({ editorialContextId, payload, actorUserId }) {
  const editorialContext = await findEditorialContextOrFail({ editorialContextId });
  const { contentSpace, namespace } = await loadContextDependencies(editorialContext);
  await assertCanManageContentSpace(contentSpace, actorUserId);
  const normalized = validateMetadata(payload || {}, { creating: false });
  if (Object.prototype.hasOwnProperty.call(normalized, "displayName")) editorialContext.displayName = normalized.displayName;
  if (Object.prototype.hasOwnProperty.call(normalized, "shortDescription")) editorialContext.shortDescription = normalized.shortDescription ?? null;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) editorialContext.description = normalized.description ?? null;
  await editorialContext.save();
  return projectEditorialContext({ editorialContext, contentSpace, namespace });
}

async function getEditorialContext({ editorialContextId, actorUserId }) {
  const editorialContext = await findEditorialContextOrFail({ editorialContextId });
  const { contentSpace, namespace } = await loadContextDependencies(editorialContext);
  await assertCanManageContentSpace(contentSpace, actorUserId);
  return projectEditorialContext({ editorialContext, contentSpace, namespace });
}

async function listEditorialContexts({ actorUserId, contentSpaceId = null, namespaceId = null } = {}) {
  if (contentSpaceId && !mongoose.isValidObjectId(contentSpaceId)) throw new AppError("contentSpaceId non valido", 400);
  if (namespaceId && !mongoose.isValidObjectId(namespaceId)) throw new AppError("namespaceId non valido", 400);
  const query = { lifecycleStatus: "active" };
  if (contentSpaceId) {
    const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
    await assertCanManageContentSpace(contentSpace, actorUserId);
    query.contentSpaceId = contentSpace._id;
  } else {
    const accessibleSpaces = await listContentSpaces({ actorUserId });
    query.contentSpaceId = { $in: accessibleSpaces.map((space) => space._id) };
  }
  if (namespaceId) query.namespaceId = namespaceId;
  const contexts = await EditorialContext.find(query).sort({ displayName: 1, createdAt: 1 });
  const results = [];
  for (const editorialContext of contexts) {
    const { contentSpace, namespace } = await loadContextDependencies(editorialContext);
    results.push(await projectEditorialContext({ editorialContext, contentSpace, namespace }));
  }
  return results;
}

module.exports = {
  findEditorialContextOrFail,
  createEditorialContext,
  updateEditorialContext,
  getEditorialContext,
  listEditorialContexts,
};
