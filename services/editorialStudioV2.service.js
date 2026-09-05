const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const EditorialContextRevision = require("../models/editorialContextRevision.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace, listContentSpaces } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanUseItemEditionForEditorialRelease } = require("./itemUsageAuthorization.service");
const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");
const { checkEditorialContextReadiness } = require("./editorialContextReview.service");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function hasPermission(contentSpace, authority, code) {
  if (contentSpace.ownerType === "user") return true;
  return (authority?.effectivePermissions || []).includes(code);
}

async function resolveAuthority({ contentSpace, actorUserId }) {
  if (contentSpace.ownerType === "user") return null;
  return resolveOrganizationAuthority({ userId: actorUserId, organizationId: contentSpace.ownerId });
}

async function loadContextAndSpace({ editorialContextId, actorUserId, permissionCode = "editorial_context.view" }) {
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("Raccolta editoriale non trovata", 404);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, permissionCode);
  return { context, contentSpace };
}

async function resolveNamespaceProjection({ context, contentSpace, actorUserId, semanticGraph = null }) {
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 409);
  const access = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });
  let revisionId = null;
  if (semanticGraph?.workingRevisionId) {
    const graphRevision = await SemanticGraphRevision.findById(semanticGraph.workingRevisionId).select("authoredAgainstNamespaceRevisionId").lean();
    revisionId = graphRevision?.authoredAgainstNamespaceRevisionId || null;
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

async function listEditorialSpaceSummaries({ actorUserId, ownerType = null, ownerId = null }) {
  const spaces = await listContentSpaces({ actorUserId, ownerType, ownerId });
  if (!spaces.length) return [];
  const spaceIds = spaces.map((space) => space._id);
  const [itemCounts, subjectCounts, contextCounts, publishedCounts] = await Promise.all([
    ContentSpaceItemMembership.aggregate([
      { $match: { contentSpaceId: { $in: spaceIds } } },
      { $group: { _id: "$contentSpaceId", count: { $sum: 1 } } },
    ]),
    ContentSpaceSubjectMembership.aggregate([
      { $match: { contentSpaceId: { $in: spaceIds } } },
      { $group: { _id: "$contentSpaceId", count: { $sum: 1 } } },
    ]),
    EditorialContext.aggregate([
      { $match: { contentSpaceId: { $in: spaceIds }, lifecycleStatus: "active" } },
      { $group: { _id: "$contentSpaceId", count: { $sum: 1 } } },
    ]),
    EditorialContext.aggregate([
      { $match: { contentSpaceId: { $in: spaceIds }, lifecycleStatus: "active", publishedReleaseId: { $ne: null } } },
      { $group: { _id: "$contentSpaceId", count: { $sum: 1 } } },
    ]),
  ]);
  const itemCountById = new Map(itemCounts.map((entry) => [id(entry._id), entry.count]));
  const subjectCountById = new Map(subjectCounts.map((entry) => [id(entry._id), entry.count]));
  const contextById = new Map(contextCounts.map((entry) => [id(entry._id), entry.count]));
  const publishedById = new Map(publishedCounts.map((entry) => [id(entry._id), entry.count]));
  return spaces.map((space) => ({
    id: space._id,
    name: space.name,
    description: space.description || "",
    ownerType: space.ownerType,
    ownerId: space.ownerId,
    stats: {
      itemCount: itemCountById.get(id(space._id)) || 0,
      subjectCount: subjectCountById.get(id(space._id)) || 0,
      collectionCount: contextById.get(id(space._id)) || 0,
      publishedCollectionCount: publishedById.get(id(space._id)) || 0,
    },
  }));
}

async function getEditorialSpaceProjection({ contentSpaceId, actorUserId }) {
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_space.view");
  const authority = await resolveAuthority({ contentSpace, actorUserId });
  const [itemCount, subjectCount, contexts] = await Promise.all([
    ContentSpaceItemMembership.countDocuments({ contentSpaceId: contentSpace._id }),
    ContentSpaceSubjectMembership.countDocuments({ contentSpaceId: contentSpace._id }),
    EditorialContext.find({ contentSpaceId: contentSpace._id, lifecycleStatus: "active" }).sort({ displayName: 1, createdAt: 1 }).lean(),
  ]);
  const namespaces = contexts.length
    ? await Namespace.find({ _id: { $in: contexts.map((context) => context.namespaceId) } }).select("name").lean()
    : [];
  const namespaceById = new Map(namespaces.map((namespace) => [id(namespace._id), namespace]));
  const itemCounts = contexts.length
    ? await CollectionItemMembership.aggregate([
      { $match: { editorialContextId: { $in: contexts.map((context) => context._id) } } },
      { $group: { _id: "$editorialContextId", count: { $sum: 1 } } },
    ])
    : [];
  const graphIds = [...new Set(contexts.map((context) => id(context.semanticGraphId)).filter(Boolean))];
  const graphs = graphIds.length
    ? await SemanticGraph.find({ _id: { $in: graphIds }, lifecycleStatus: "active" }).select("workingRevisionId").lean()
    : [];
  const graphById = new Map(graphs.map((graph) => [id(graph._id), graph]));
  const revisionIds = graphs.map((graph) => graph.workingRevisionId).filter(Boolean);
  const graphSubjectCounts = revisionIds.length
    ? await GraphSubjectBinding.aggregate([
      { $match: { graphRevisionId: { $in: revisionIds } } },
      { $group: { _id: "$graphRevisionId", count: { $sum: 1 } } },
    ])
    : [];
  const graphSubjectCountByRevision = new Map(graphSubjectCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));
  const itemCountByContext = new Map(itemCounts.map((entry) => [id(entry._id), entry.count]));
  const permissions = {
    canManageSpace: hasPermission(contentSpace, authority, "editorial_space.manage"),
    canCreateCollection: hasPermission(contentSpace, authority, "editorial_context.create"),
  };
  return {
    space: {
      id: contentSpace._id,
      name: contentSpace.name,
      description: contentSpace.description || "",
      ownerType: contentSpace.ownerType,
      ownerId: contentSpace.ownerId,
    },
    stats: { itemCount, subjectCount, collectionCount: contexts.length },
    collections: contexts.map((context) => {
      const graph = graphById.get(id(context.semanticGraphId));
      return {
        id: context._id,
        name: context.displayName,
        shortDescription: context.shortDescription || null,
        semanticGraphId: context.semanticGraphId,
        namespace: { id: context.namespaceId, name: namespaceById.get(id(context.namespaceId))?.name || "Regole editoriali" },
        itemCount: itemCountByContext.get(id(context._id)) || 0,
        subjectCount: graph ? graphSubjectCountByRevision.get(id(graph.workingRevisionId)) || 0 : 0,
        published: Boolean(context.publishedReleaseId),
        reviewActive: Boolean(context.activeReviewRevisionId),
      };
    }),
    permissions,
  };
}

async function getEditorialStudioProjection({ editorialContextId, actorUserId }) {
  const { context, contentSpace } = await loadContextAndSpace({ editorialContextId, actorUserId });
  const authority = await resolveAuthority({ contentSpace, actorUserId });
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).lean();
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 409);
  const [namespace, readiness, collectionEntries, activeRevision, publishedRelease] = await Promise.all([
    resolveNamespaceProjection({ context, contentSpace, actorUserId, semanticGraph }),
    checkEditorialContextReadiness({ editorialContextId: context._id, actorUserId }),
    CollectionItemMembership.find({ editorialContextId: context._id }).select("itemId").lean(),
    context.activeReviewRevisionId ? EditorialContextRevision.findById(context.activeReviewRevisionId).lean() : null,
    context.publishedReleaseId ? EditorialRelease.findById(context.publishedReleaseId).lean() : null,
  ]);

  const collectionItems = collectionEntries.length
    ? await ItemV2.find({ _id: { $in: collectionEntries.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("primarySubjectId").lean()
    : [];
  const collectionSubjectIds = new Set(collectionItems.map((item) => id(item.primarySubjectId)).filter(Boolean));
  const workingGraphRevisionId = semanticGraph.workingRevisionId || null;
  const [subjectBindings, edges, publishedSourceRevision, publishedGraphRevision, reviewSubjectCount, publishedSubjectCount] = await Promise.all([
    workingGraphRevisionId ? GraphSubjectBinding.find({ graphRevisionId: workingGraphRevisionId }).select("subjectId").lean() : [],
    workingGraphRevisionId ? SemanticEdgeV2.find({ graphRevisionId: workingGraphRevisionId }).select("sourceSubjectId targetSubjectId").lean() : [],
    publishedRelease?.sourceContextRevisionId ? EditorialContextRevision.findById(publishedRelease.sourceContextRevisionId).select("sourceWorkingVersion version").lean() : null,
    publishedRelease?.graphRevisionId ? SemanticGraphRevision.findById(publishedRelease.graphRevisionId).select("version semanticGraphId").lean() : null,
    activeRevision?.graphRevisionId ? GraphSubjectBinding.countDocuments({ graphRevisionId: activeRevision.graphRevisionId }) : 0,
    publishedRelease?.graphRevisionId ? GraphSubjectBinding.countDocuments({ graphRevisionId: publishedRelease.graphRevisionId }) : 0,
  ]);
  const graphSubjectIds = new Set(subjectBindings.map((entry) => id(entry.subjectId)));
  const contentSubjectsOutsideGraph = [...collectionSubjectIds].filter((subjectId) => !graphSubjectIds.has(subjectId)).length;
  const graphSubjectsWithoutCollectionContent = [...graphSubjectIds].filter((subjectId) => !collectionSubjectIds.has(subjectId)).length;
  const workingVersion = Number(context.workingVersion || 0);
  const publishedWorkingVersion = publishedSourceRevision ? Number(publishedSourceRevision.sourceWorkingVersion || 0) : null;
  const graphWorkingVersion = Number(semanticGraph.workingVersion || 0);
  const publishedGraphVersion = publishedGraphRevision && id(publishedGraphRevision.semanticGraphId) === id(semanticGraph._id)
    ? Number(publishedGraphRevision.version || 0)
    : null;
  const collectionChanges = publishedWorkingVersion === null ? null : Math.max(0, workingVersion - publishedWorkingVersion);
  const graphChanges = publishedGraphVersion === null ? null : Math.max(0, graphWorkingVersion - publishedGraphVersion);

  const permissions = {
    canEdit: hasPermission(contentSpace, authority, "editorial_context.edit"),
    canEditGraph: hasPermission(contentSpace, authority, "semantic_graph.edit"),
    canReview: hasPermission(contentSpace, authority, "editorial_context.review"),
    canPublish: hasPermission(contentSpace, authority, "editorial_release.publish"),
    canRemove: hasPermission(contentSpace, authority, "editorial_context.lifecycle.manage"),
  };
  const availableOperations = [];
  if (permissions.canEdit && !activeRevision) availableOperations.push({ code: "collection.edit", label: "Modifica raccolta" });
  if (permissions.canEditGraph) availableOperations.push({ code: "collection.graph.edit", label: "Modifica relazioni" });
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
    semanticGraph: {
      id: semanticGraph._id,
      name: semanticGraph.displayName,
      workingRevisionId: semanticGraph.workingRevisionId || null,
      workingVersion: graphWorkingVersion,
      sharedByCollections: await EditorialContext.countDocuments({ semanticGraphId: semanticGraph._id, lifecycleStatus: "active" }),
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
      entryCount: collectionEntries.length,
      contentSubjectCount: collectionSubjectIds.size,
      subjectCount: graphSubjectIds.size,
      graphSubjectCount: graphSubjectIds.size,
      subjectsOutsideGraph: contentSubjectsOutsideGraph,
      graphSubjectsWithoutCollectionContent,
      edgeCount: edges.length,
      collectionChangesSincePublished: collectionChanges,
      graphChangesSincePublished: graphChanges,
      changesSincePublished: collectionChanges === null && graphChanges === null
        ? null
        : Math.max(0, Number(collectionChanges || 0) + Number(graphChanges || 0)),
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
      graphRevisionId: activeRevision.graphRevisionId,
      subjectCount: reviewSubjectCount,
      itemCount: (activeRevision.itemBindings || []).length,
    } : null,
    published: publishedRelease ? {
      id: publishedRelease._id,
      version: publishedRelease.version,
      releasedAt: publishedRelease.releasedAt,
      graphRevisionId: publishedRelease.graphRevisionId,
      subjectCount: publishedSubjectCount,
      sourceContextRevisionId: publishedRelease.sourceContextRevisionId || null,
    } : null,
    permissions,
    availableOperations,
  };
}

async function listEditorialStudioCandidates({ editorialContextId, actorUserId, query = "", page = 1, limit = 30 }) {
  const { context, contentSpace } = await loadContextAndSpace({ editorialContextId, actorUserId });
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
  const normalizedQuery = String(query || "").trim();

  let candidateItemIds = await ContentSpaceItemMembership.distinct("itemId", { contentSpaceId: contentSpace._id });
  if (normalizedQuery && candidateItemIds.length) {
    const regex = new RegExp(escapeRegex(normalizedQuery), "i");
    const [subjects, matchingRevisions] = await Promise.all([
      Subject.find({ $or: [{ preferredLabel: regex }, { description: regex }] }).select("_id").limit(500).lean(),
      ItemRevisionV2.find({ label: regex }).select("itemEditionId").limit(500).lean(),
    ]);
    const revisionEditions = matchingRevisions.length
      ? await ItemEdition.find({ _id: { $in: matchingRevisions.map((entry) => entry.itemEditionId) } }).select("itemId").lean()
      : [];
    const subjectItems = subjects.length
      ? await ItemV2.find({ _id: { $in: candidateItemIds }, primarySubjectId: { $in: subjects.map((entry) => entry._id) }, lifecycleStatus: "active" }).select("_id").lean()
      : [];
    const matchingIds = new Set([...revisionEditions.map((entry) => id(entry.itemId)), ...subjectItems.map((entry) => id(entry._id))]);
    candidateItemIds = candidateItemIds.filter((itemId) => matchingIds.has(id(itemId)));
  }

  const membershipQuery = { contentSpaceId: contentSpace._id, itemId: { $in: candidateItemIds } };
  const [total, memberships] = await Promise.all([
    ContentSpaceItemMembership.countDocuments(membershipQuery),
    ContentSpaceItemMembership.find(membershipQuery)
      .sort({ createdAt: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const itemIds = memberships.map((entry) => entry.itemId);
  const [items, editions, existingEntries] = await Promise.all([
    ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).lean(),
    ItemEdition.find({ itemId: { $in: itemIds }, namespaceId: context.namespaceId }).lean(),
    CollectionItemMembership.find({ editorialContextId: context._id, itemId: { $in: itemIds } }).select("itemId").lean(),
  ]);
  const itemById = new Map(items.map((item) => [id(item), item]));
  const editionByItemId = new Map(editions.map((edition) => [id(edition.itemId), edition]));
  const existingItemIds = new Set(existingEntries.map((entry) => id(entry.itemId)));
  const usableEditionIds = new Set();
  await Promise.all(editions.map(async (edition) => {
    try {
      await assertCanUseItemEditionForEditorialRelease({
        itemEditionId: edition._id,
        actorUserId,
        principalType: contentSpace.ownerType,
        principalId: contentSpace.ownerId,
      });
      usableEditionIds.add(id(edition._id));
    } catch (error) {
      if (![403, 404, 409].includes(error?.status)) throw error;
    }
  }));
  const revisionIds = editions.map((edition) => edition.workingRevisionId || edition.publishedRevisionId).filter(Boolean);
  const subjectIds = items.map((item) => item.primarySubjectId).filter(Boolean);
  const [revisions, subjects] = await Promise.all([
    revisionIds.length ? ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label status version").lean() : [],
    subjectIds.length ? Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description").lean() : [],
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision), revision]));
  const subjectById = new Map(subjects.map((subject) => [id(subject), subject]));

  return {
    results: memberships.map((membership) => {
      const item = itemById.get(id(membership.itemId));
      if (!item) return null;
      const edition = editionByItemId.get(id(membership.itemId)) || null;
      const revision = edition ? revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null : null;
      const subject = subjectById.get(id(item.primarySubjectId)) || null;
      return {
        itemId: item._id,
        itemEditionId: edition?._id || null,
        compatibleEdition: Boolean(edition),
        releaseUsable: Boolean(edition && usableEditionIds.has(id(edition._id))),
        inCollection: existingItemIds.has(id(item._id)),
        subject: subject ? { id: subject._id, label: subject.preferredLabel, description: subject.description || "" } : null,
        revision: revision ? { id: revision._id, label: revision.label, status: revision.status, version: revision.version } : null,
      };
    }).filter(Boolean),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
  };
}

module.exports = {
  listEditorialSpaceSummaries,
  getEditorialSpaceProjection,
  getEditorialStudioProjection,
  listEditorialStudioCandidates,
};