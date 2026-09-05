const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialContextRevision = require("../models/editorialContextRevision.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");
const { validateEditorialReleaseCoherence } = require("./editorialReleaseIntegrity.service");

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
  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({ namespace, actorUserId, principalType, principalId });
  if (namespaceAccess?.basis === "entitlement") {
    const ref = namespaceAccess.resolvedSnapshotRef;
    if (ref?.resourceType !== "namespace_revision" || !sameId(ref.resourceId, namespaceRevisionId)) {
      throw new AppError("La NamespaceRevision approvata non è più autorizzata", 403, [{
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
        throw new AppError("Una ItemRevision approvata non è più autorizzata", 403, [{
          code: "ITEM_REVISION_NOT_AUTHORIZED",
          context: { itemEditionId: binding.itemEditionId, itemRevisionId: binding.itemRevisionId, authorizedRevisionId: ref?.resourceId || null },
        }]);
      }
    }
    itemAccesses.push({ binding, access });
  }
  return { namespace, namespaceAccess, itemAccesses };
}

async function nextVersion(editorialContextId, session = null) {
  let query = EditorialRelease.findOne({ editorialContextId }).sort({ version: -1 }).select("version");
  if (session) query = query.session(session);
  const latest = await query.lean();
  return (latest?.version || 0) + 1;
}

async function loadApprovedRevision({ context, editorialContextRevisionId = null }) {
  const revisionId = editorialContextRevisionId || context.activeReviewRevisionId;
  if (!revisionId || !sameId(revisionId, context.activeReviewRevisionId)) {
    throw new AppError("La raccolta non ha una revisione approvata attiva", 409, [{ code: "APPROVED_CONTEXT_REVISION_REQUIRED" }]);
  }
  const revision = await EditorialContextRevision.findOne({ _id: revisionId, editorialContextId: context._id });
  if (!revision || revision.status !== "approved") {
    throw new AppError("La revisione della raccolta deve essere approvata prima della pubblicazione", 409, [{ code: "APPROVED_CONTEXT_REVISION_REQUIRED" }]);
  }
  return revision;
}

async function createEditorialRelease({ editorialContextId, editorialContextRevisionId = null, actorUserId }) {
  const context = await findContextOrFail(editorialContextId);
  const contentSpace = await assertCanManageContext(context, actorUserId, "editorial_release.publish");
  const revision = await loadApprovedRevision({ context, editorialContextRevisionId });
  const frozenBindings = (revision.itemBindings || []).map((binding) => ({
    itemId: binding.itemId,
    itemEditionId: binding.itemEditionId,
    itemRevisionId: binding.itemRevisionId,
    curationSignals: (binding.curationSignals || []).map((signal) => ({ definitionId: signal.definitionId, weight: signal.weight })),
  }));

  const dependencyAccess = await assertReleaseDependenciesAuthorized({
    context,
    namespaceRevisionId: revision.namespaceRevisionId,
    itemBindings: frozenBindings,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
  const issues = await validateEditorialReleaseCoherence({
    editorialContextId: context._id,
    namespaceRevisionId: revision.namespaceRevisionId,
    graphRevisionId: revision.graphRevisionId,
    itemBindings: frozenBindings,
  });
  if (issues.length) throw new AppError("La revisione approvata non è più pubblicabile", 409, issues);

  const adoptionIds = [];
  try {
    const namespaceAdoption = await recordAdoptionFromAccess({
      access: dependencyAccess.namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: dependencyAccess.namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: revision.namespaceRevisionId },
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

    let release = null;
    await mongoose.connection.transaction(async (session) => {
      const lockedContext = await EditorialContext.findOne({
        _id: context._id,
        lifecycleStatus: "active",
        activeReviewRevisionId: revision._id,
      }).session(session);
      if (!lockedContext) throw new AppError("La revisione attiva della raccolta è cambiata", 409, [{ code: "EDITORIAL_CONTEXT_REVIEW_CONFLICT" }]);
      const lockedRevision = await EditorialContextRevision.findOne({
        _id: revision._id,
        editorialContextId: context._id,
        status: "approved",
      }).session(session);
      if (!lockedRevision) throw new AppError("La revisione non è più approvata", 409, [{ code: "APPROVED_CONTEXT_REVISION_REQUIRED" }]);
      const now = new Date();
      [release] = await EditorialRelease.create([{
        editorialContextId: lockedContext._id,
        sourceContextRevisionId: lockedRevision._id,
        version: await nextVersion(lockedContext._id, session),
        basedOnReleaseId: lockedContext.publishedReleaseId || null,
        namespaceRevisionId: lockedRevision.namespaceRevisionId,
        graphRevisionId: lockedRevision.graphRevisionId,
        itemBindings: frozenBindings,
        integrity: { status: "valid", issues: [], checkedAt: now, checkedBy: actorUserId },
        releasedAt: now,
        releasedBy: actorUserId,
      }], { session });
      lockedContext.publishedReleaseId = release._id;
      lockedContext.activeReviewRevisionId = null;
      await lockedContext.save({ session });
      lockedRevision.status = "published";
      lockedRevision.publication = { publishedAt: now, publishedBy: actorUserId, editorialReleaseId: release._id };
      lockedRevision.review.events.push({ action: "published", actorUserId, at: now });
      await lockedRevision.save({ session });
    });
    return release;
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
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