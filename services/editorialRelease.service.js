const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");
const { validateEditorialReleaseCoherence } = require("./editorialReleaseIntegrity.service");
const { normalizeEditorialReleasePayload, validateEditorialReleasePayload } = require("./validation/editorialRelease.validation");

function sameId(a, b) { return String(a || "") === String(b || ""); }

async function findContextOrFail(editorialContextId) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" });
  if (!context) throw new AppError("EditorialContext non trovato", 404);
  return context;
}

async function assertCanManageContext(context, actorUserId, permissionCode = "editorial_context.edit") {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, permissionCode);
  return contentSpace;
}

async function assertReleaseDependenciesAuthorized({ context, namespaceRevisionId, itemBindings, actorUserId, principalType, principalId }) {
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace del Context non disponibile", 409);
  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType,
    principalId,
  });
  if (namespaceAccess?.basis === "entitlement") {
    const ref = namespaceAccess.resolvedSnapshotRef;
    if (ref?.resourceType !== "namespace_revision" || !sameId(ref.resourceId, namespaceRevisionId)) {
      throw new AppError("La NamespaceRevision della Release non e autorizzata", 403, [{
        code: "NAMESPACE_REVISION_NOT_AUTHORIZED",
        context: { namespaceRevisionId, authorizedRevisionId: ref?.resourceId || null },
      }]);
    }
  }

  const itemAccesses = [];
  for (const binding of itemBindings || []) {
    const usage = await assertCanUseItemEditionForEditorialRelease({
      itemEditionId: binding.itemEditionId,
      actorUserId,
      principalType,
      principalId,
    });
    const access = usage.access;
    if (access?.basis === "entitlement") {
      const ref = access.resolvedSnapshotRef;
      if (ref?.resourceType !== "item_revision" || !sameId(ref.resourceId, binding.itemRevisionId)) {
        throw new AppError("La ItemRevision della Release non e autorizzata", 403, [{
          code: "ITEM_REVISION_NOT_AUTHORIZED",
          context: { itemEditionId: binding.itemEditionId, itemRevisionId: binding.itemRevisionId, authorizedRevisionId: ref?.resourceId || null },
        }]);
      }
    }
    itemAccesses.push({ binding, access });
  }
  return { namespace, namespaceAccess, itemAccesses };
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
  const contentSpace = await assertCanManageContext(context, actorUserId, "editorial_release.publish");
  const dependencyAccess = await assertReleaseDependenciesAuthorized({
    context,
    namespaceRevisionId: normalized.namespaceRevisionId,
    itemBindings: normalized.itemBindings,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
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

  const adoptionIds = [];
  try {
    const namespaceAdoption = await recordAdoptionFromAccess({
      access: dependencyAccess.namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: dependencyAccess.namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: normalized.namespaceRevisionId },
      resultResourceRef: { resourceType: "editorial_context", resourceId: context._id },
    });
    if (namespaceAdoption) adoptionIds.push(namespaceAdoption._id);

    for (const { binding, access } of dependencyAccess.itemAccesses) {
      const adoption = await recordAdoptionFromAccess({
        access,
        actorUserId,
        action: "content_link",
        sourceResourceRef: { resourceType: "item_edition", resourceId: binding.itemEditionId },
        sourceSnapshotRef: { resourceType: "item_revision", resourceId: binding.itemRevisionId },
        targetResourceRef: { resourceType: "editorial_context", resourceId: context._id },
        resultResourceRef: { resourceType: "editorial_context", resourceId: context._id },
      });
      if (adoption) adoptionIds.push(adoption._id);
    }

    context.publishedReleaseId = release._id;
    await context.save();
    return release;
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    await EditorialRelease.deleteOne({ _id: release._id }).catch(() => {});
    throw error;
  }
}

async function getCurrentEditorialRelease({ editorialContextId, actorUserId = null, requireManagement = true }) {
  const context = await findContextOrFail(editorialContextId);
  if (requireManagement) {
    if (!actorUserId) throw new AppError("Autenticazione richiesta", 401);
    await assertCanManageContext(context, actorUserId, "editorial_context.view");
  }
  if (!context.publishedReleaseId) return null;
  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id });
  if (!release) throw new AppError("Published EditorialRelease non trovata", 409);
  return release;
}

async function listEditorialReleases({ editorialContextId, actorUserId }) {
  const context = await findContextOrFail(editorialContextId);
  await assertCanManageContext(context, actorUserId, "editorial_context.view");
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
