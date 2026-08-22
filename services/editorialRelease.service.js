const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { validateEditorialReleaseCoherence } = require("./editorialReleaseIntegrity.service");
const { normalizeEditorialReleasePayload, validateEditorialReleasePayload } = require("./validation/editorialRelease.validation");

async function findContextOrFail(editorialContextId) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("EditorialContext non trovato", 404);
  return context;
}

async function assertCanManageContext(context, actorUserId, minimumOrganizationRole = "operator") {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, minimumOrganizationRole);
  return contentSpace;
}

async function assertReleaseDependenciesAuthorized({ context, itemBindings, actorUserId }) {
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace del Context non disponibile", 409);
  await assertCanUseNamespaceForEditorialContext({ namespace, actorUserId });
  const editionIds = [...new Set((itemBindings || []).map((binding) => String(binding.itemEditionId || "")).filter(Boolean))];
  for (const itemEditionId of editionIds) {
    await assertCanUseItemEditionForEditorialRelease({ itemEditionId, actorUserId });
  }
}

async function nextVersion(editorialContextId) {
  const latest = await EditorialRelease.findOne({ editorialContextId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function createEditorialRelease({ editorialContextId, payload, actorUserId }) {
  const rawPayload = payload || {};
  const shapeIssues = validateEditorialReleasePayload(rawPayload);
  if (shapeIssues.length) throw new AppError("Payload EditorialRelease non valido", 400, shapeIssues);
  const normalized = normalizeEditorialReleasePayload(rawPayload);
  const context = await findContextOrFail(editorialContextId);
  await assertCanManageContext(context, actorUserId, "manager");
  await assertReleaseDependenciesAuthorized({ context, itemBindings: normalized.itemBindings, actorUserId });
  const graphRevisionId = normalized.graphRevisionId || context.workingGraphRevisionId;
  if (!graphRevisionId) throw new AppError("EditorialContext privo di GraphRevision", 409);

  const issues = await validateEditorialReleaseCoherence({
    editorialContextId: context._id,
    namespaceRevisionId: normalized.namespaceRevisionId,
    graphRevisionId,
    itemBindings: normalized.itemBindings,
  });
  if (issues.length) throw new AppError("EditorialRelease non coerente", 409, issues);

  const release = await EditorialRelease.create({
    editorialContextId: context._id,
    version: await nextVersion(context._id),
    basedOnReleaseId: context.publishedReleaseId || null,
    namespaceRevisionId: normalized.namespaceRevisionId,
    graphRevisionId,
    itemBindings: normalized.itemBindings,
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: actorUserId },
    releasedAt: new Date(),
    releasedBy: actorUserId,
  });

  try {
    context.publishedReleaseId = release._id;
    await context.save();
    return release;
  } catch (error) {
    await EditorialRelease.deleteOne({ _id: release._id }).catch(() => {});
    throw error;
  }
}

async function getCurrentEditorialRelease({ editorialContextId, actorUserId = null, requireManagement = true }) {
  const context = await findContextOrFail(editorialContextId);
  if (requireManagement) {
    if (!actorUserId) throw new AppError("Autenticazione richiesta", 401);
    await assertCanManageContext(context, actorUserId);
  }
  if (!context.publishedReleaseId) return null;
  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id });
  if (!release) throw new AppError("Published EditorialRelease non trovata", 409);
  return release;
}

async function listEditorialReleases({ editorialContextId, actorUserId }) {
  const context = await findContextOrFail(editorialContextId);
  await assertCanManageContext(context, actorUserId);
  return EditorialRelease.find({ editorialContextId: context._id }).sort({ version: -1 });
}

module.exports = {
  findContextOrFail,
  assertCanManageContext,
  assertReleaseDependenciesAuthorized,
  createEditorialRelease,
  getCurrentEditorialRelease,
  listEditorialReleases,
};
