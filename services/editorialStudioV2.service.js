const EditorialContext = require("../models/editorialContext.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const EditorialContextRevision = require("../models/editorialContextRevision.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");
const { checkEditorialContextReadiness } = require("./editorialContextReview.service");

function id(value) { return String(value?._id || value || ""); }
function hasPermission(contentSpace, authority, code) {
  if (contentSpace.ownerType === "user") return true;
  return (authority?.effectivePermissions || []).includes(code);
}

async function resolveAuthority({ contentSpace, actorUserId }) {
  if (contentSpace.ownerType === "user") return null;
  return resolveOrganizationAuthority({ userId: actorUserId, organizationId: contentSpace.ownerId });
}

async function resolveNamespaceProjection({ context, contentSpace, actorUserId }) {
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 409);
  const access = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
  let revisionId = null;
  if (context.workingGraphRevisionId) {
    const graph = await require("../models/semanticGraphRevision.model").findById(context.workingGraphRevisionId).select("authoredAgainstNamespaceRevisionId").lean();
    revisionId = graph?.authoredAgainstNamespaceRevisionId || null;
  }
  if (!revisionId) {
    revisionId = access.resolvedSnapshotRef?.resourceType === "namespace_revision"
      ? access.resolvedSnapshotRef.resourceId
      : namespace.workingRevisionId || namespace.publishedRevisionId;
  }
  const revision = revisionId ? await NamespaceRevision.findOne({ _id: revisionId, namespaceId: namespace._id }).lean() : null;
  return {
    id: namespace._id,
    name: namespace.name,
    description: namespace.description || "",
    revision: revision ? {
      id: revision._id,
      version: revision.version,
      status: revision.status,
      subjectClasses: (revision.subjectClasses || []).map((entry) => ({ definitionId: entry.definitionId, key: entry.key, label: entry.label, description: entry.description || "" })),
      relationTypes: (revision.relationTypes || []).map((entry) => ({
        definitionId: entry.definitionId,
        key: entry.key,
        label: entry.label,
        description: entry.description || "",
        domainDefinitionIds: entry.domainDefinitionIds || [],
        rangeDefinitionIds: entry.rangeDefinitionIds || [],
        directionality: entry.directionality,
      })),
      selectionSignals: (revision.selectionSignals || []).map((entry) => ({ definitionId: entry.definitionId, label: entry.label, description: entry.description || "" })),
    } : null,
  };
}

async function getEditorialStudioProjection({ editorialContextId, actorUserId }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const authority = await resolveAuthority({ contentSpace, actorUserId });
  const [namespace, readiness, entryCount, activeRevision, publishedRelease] = await Promise.all([
    resolveNamespaceProjection({ context, contentSpace, actorUserId }),
    checkEditorialContextReadiness({ editorialContextId: context._id, actorUserId }),
    EditorialContextEntry.countDocuments({ editorialContextId: context._id }),
    context.activeReviewRevisionId ? EditorialContextRevision.findById(context.activeReviewRevisionId).lean() : null,
    context.publishedReleaseId ? EditorialRelease.findById(context.publishedReleaseId).lean() : null,
  ]);

  const [subjectBindings, edges, publishedSourceRevision] = await Promise.all([
    context.workingGraphRevisionId ? GraphSubjectBinding.find({ graphRevisionId: context.workingGraphRevisionId }).select("subjectId").lean() : [],
    context.workingGraphRevisionId ? SemanticEdgeV2.find({ graphRevisionId: context.workingGraphRevisionId }).select("sourceSubjectId targetSubjectId").lean() : [],
    publishedRelease?.sourceContextRevisionId ? EditorialContextRevision.findById(publishedRelease.sourceContextRevisionId).select("sourceWorkingVersion version").lean() : null,
  ]);
  const subjectIds = new Set(subjectBindings.map((entry) => id(entry.subjectId)));
  for (const edge of edges) { subjectIds.add(id(edge.sourceSubjectId)); subjectIds.add(id(edge.targetSubjectId)); }
  const workingVersion = Number(context.workingVersion || 0);
  const publishedWorkingVersion = publishedSourceRevision ? Number(publishedSourceRevision.sourceWorkingVersion || 0) : null;

  const permissions = {
    canEdit: hasPermission(contentSpace, authority, "editorial_context.edit"),
    canEditGraph: hasPermission(contentSpace, authority, "semantic_graph.edit"),
    canReview: hasPermission(contentSpace, authority, "editorial_context.review"),
    canPublish: hasPermission(contentSpace, authority, "editorial_release.publish"),
    canRemove: hasPermission(contentSpace, authority, "editorial_context.lifecycle.manage"),
  };
  const availableOperations = [];
  if (permissions.canEdit && !activeRevision) availableOperations.push({ code: "collection.edit", label: "Modifica raccolta" });
  if (permissions.canEditGraph && !activeRevision) availableOperations.push({ code: "collection.graph.edit", label: "Modifica relazioni" });
  if (permissions.canEdit && readiness.ready && !activeRevision) availableOperations.push({ code: "collection.review.request", label: "Invia in revisione" });
  if (permissions.canEdit && activeRevision?.status === "in_review") availableOperations.push({ code: "collection.review.withdraw", label: "Ritira dalla revisione" });
  if (permissions.canReview && activeRevision?.status === "in_review") {
    availableOperations.push({ code: "collection.review.approve", label: "Approva revisione" });
    availableOperations.push({ code: "collection.review.request_changes", label: "Richiedi modifiche" });
  }
  if (permissions.canPublish && activeRevision?.status === "approved") availableOperations.push({ code: "collection.publish", label: "Pubblica versione" });

  return {
    context: {
      id: context._id,
      name: context.displayName,
      shortDescription: context.shortDescription || null,
      description: context.description || null,
      workingVersion,
      locked: Boolean(activeRevision),
    },
    contentSpace: {
      id: contentSpace._id,
      name: contentSpace.name,
      description: contentSpace.description || "",
      ownerType: contentSpace.ownerType,
      ownerId: contentSpace.ownerId,
    },
    namespace,
    stats: {
      entryCount,
      subjectCount: subjectIds.size,
      edgeCount: edges.length,
      changesSincePublished: publishedWorkingVersion === null ? null : Math.max(0, workingVersion - publishedWorkingVersion),
    },
    readiness: { ready: readiness.ready, issues: readiness.issues },
    review: activeRevision ? {
      id: activeRevision._id,
      version: activeRevision.version,
      sourceWorkingVersion: activeRevision.sourceWorkingVersion,
      status: activeRevision.status,
      requestedAt: activeRevision.review?.requestedAt || null,
      reviewedAt: activeRevision.review?.reviewedAt || null,
      message: activeRevision.review?.message || null,
      itemCount: (activeRevision.itemBindings || []).length,
    } : null,
    published: publishedRelease ? {
      id: publishedRelease._id,
      version: publishedRelease.version,
      releasedAt: publishedRelease.releasedAt,
      sourceContextRevisionId: publishedRelease.sourceContextRevisionId || null,
    } : null,
    permissions,
    availableOperations,
  };
}

module.exports = { getEditorialStudioProjection };
