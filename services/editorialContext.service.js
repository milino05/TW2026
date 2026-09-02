const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace, listContentSpaces } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");
const { normalizeEditorialContextPayload, validateEditorialContextPayload } = require("./validation/editorialContext.validation");

function validateMetadata(rawPayload, { creating }) {
  const normalized = normalizeEditorialContextPayload(rawPayload || {});
  const issues = validateEditorialContextPayload({ payload: normalized, rawPayload: rawPayload || {}, creating });
  if (issues.length) throw new AppError("Payload EditorialContext non valido", 400, issues);
  return normalized;
}
function workingConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
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

function assertContextWorkingStateEditable(editorialContext) {
  if (editorialContext.activeReviewRevisionId) {
    throw new AppError("La raccolta è bloccata mentre una revisione è attiva", 409, [{
      code: "EDITORIAL_CONTEXT_REVIEW_LOCKED",
      context: { activeReviewRevisionId: editorialContext.activeReviewRevisionId },
    }]);
  }
}

async function createEditorialContext({ payload, actorUserId }) {
  const normalized = validateMetadata(payload || {}, { creating: true });
  const [contentSpace, namespace] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId: normalized.contentSpaceId }),
    Namespace.findOne({ _id: normalized.namespaceId, lifecycleStatus: "active" }),
  ]);
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.create");
  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
  const namespaceRevisionId = namespaceAccess.resolvedSnapshotRef?.resourceType === "namespace_revision"
    ? namespaceAccess.resolvedSnapshotRef.resourceId
    : namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!namespaceRevisionId) throw new AppError("Il Namespace non ha una revisione utilizzabile", 409, [{ code: "NAMESPACE_REVISION_REQUIRED" }]);
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: namespace._id }).select("_id").lean();
  if (!namespaceRevision) throw new AppError("NamespaceRevision non disponibile", 409);

  let editorialContext = null;
  let adoption = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const [semanticGraph] = await SemanticGraph.create([{
        namespaceId: namespace._id,
        displayName: `${normalized.displayName} · Relazioni`,
        ownerType: contentSpace.ownerType,
        ownerId: contentSpace.ownerId,
        createdBy: actorUserId,
      }], { session });
      const [initialRevision] = await SemanticGraphRevision.create([{
        semanticGraphId: semanticGraph._id,
        version: 1,
        basedOnRevisionId: null,
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        createdBy: actorUserId,
      }], { session });
      semanticGraph.workingRevisionId = initialRevision._id;
      semanticGraph.workingVersion = 1;
      await semanticGraph.save({ session });
      [editorialContext] = await EditorialContext.create([{
        contentSpaceId: contentSpace._id,
        namespaceId: namespace._id,
        semanticGraphId: semanticGraph._id,
        displayName: normalized.displayName,
        shortDescription: normalized.shortDescription ?? null,
        description: normalized.description ?? null,
        createdBy: actorUserId,
      }], { session });
    });
    adoption = await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: namespaceAccess.resolvedSnapshotRef,
      resultResourceRef: { resourceType: "editorial_context", resourceId: editorialContext._id },
    });
  } catch (error) {
    if (adoption) await adoption.deleteOne().catch(() => {});
    throw error;
  }
  return projectEditorialContext({ editorialContext, contentSpace, namespace });
}

async function updateEditorialContext({ editorialContextId, payload, actorUserId }) {
  const editorialContext = await findEditorialContextOrFail({ editorialContextId });
  const { contentSpace, namespace } = await loadContextDependencies(editorialContext);
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.edit");
  assertContextWorkingStateEditable(editorialContext);
  const normalized = validateMetadata(payload || {}, { creating: false });
  const set = {};
  if (Object.prototype.hasOwnProperty.call(normalized, "displayName")) set.displayName = normalized.displayName;
  if (Object.prototype.hasOwnProperty.call(normalized, "shortDescription")) set.shortDescription = normalized.shortDescription ?? null;
  if (Object.prototype.hasOwnProperty.call(normalized, "description")) set.description = normalized.description ?? null;
  if (!Object.keys(set).length) return projectEditorialContext({ editorialContext, contentSpace, namespace });

  const updated = await EditorialContext.findOneAndUpdate({
    _id: editorialContext._id,
    lifecycleStatus: "active",
    activeReviewRevisionId: null,
    workingVersion: Number(editorialContext.workingVersion || 0),
  }, {
    $set: set,
    $inc: { workingVersion: 1 },
  }, { new: true });
  if (!updated) throw workingConflict();
  return projectEditorialContext({ editorialContext: updated, contentSpace, namespace });
}

async function getEditorialContext({ editorialContextId, actorUserId }) {
  const editorialContext = await findEditorialContextOrFail({ editorialContextId });
  const { contentSpace, namespace } = await loadContextDependencies(editorialContext);
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  return projectEditorialContext({ editorialContext, contentSpace, namespace });
}

async function listEditorialContexts({ actorUserId, contentSpaceId = null, namespaceId = null } = {}) {
  if (contentSpaceId && !mongoose.isValidObjectId(contentSpaceId)) throw new AppError("contentSpaceId non valido", 400);
  if (namespaceId && !mongoose.isValidObjectId(namespaceId)) throw new AppError("namespaceId non valido", 400);
  const query = { lifecycleStatus: "active" };
  if (contentSpaceId) {
    const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
    await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
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
    try {
      await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
    } catch (error) {
      if (error?.status === 403) continue;
      throw error;
    }
    results.push(await projectEditorialContext({ editorialContext, contentSpace, namespace }));
  }
  return results;
}

module.exports = {
  findEditorialContextOrFail,
  loadContextDependencies,
  assertContextWorkingStateEditable,
  createEditorialContext,
  updateEditorialContext,
  getEditorialContext,
  listEditorialContexts,
};
