const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ItemV2 = require("../models/itemV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");

function clean(value) { return String(value || "").trim(); }
function sameId(left, right) { return String(left || "") === String(right || ""); }
function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}

async function contentSpaceSubjectInventory(contentSpaceId) {
  if (!contentSpaceId) return new Map();
  const memberships = await ContentSpaceItemMembership.find({ contentSpaceId }).select("itemId").lean();
  if (!memberships.length) return new Map();
  const items = await ItemV2.find({
    _id: { $in: memberships.map((membership) => membership.itemId) },
    lifecycleStatus: "active",
  }).select("_id primarySubjectId").lean();
  const inventory = new Map();
  for (const item of items) {
    const subjectId = id(item.primarySubjectId);
    if (!subjectId) continue;
    const itemIds = inventory.get(subjectId) || [];
    itemIds.push(item._id);
    inventory.set(subjectId, itemIds);
  }
  return inventory;
}

async function listReusableSemanticGraphs({
  actorUserId,
  ownerType,
  ownerId,
  namespaceId,
  contentSpaceId = null,
  excludeSemanticGraphIds = [],
  query = "",
  page = 1,
  limit = 30,
}) {
  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  assertObjectId(ownerId, "ownerId");
  assertObjectId(namespaceId, "namespaceId");
  if (!Array.isArray(excludeSemanticGraphIds)) throw new AppError("excludeSemanticGraphIds deve essere un array", 400, [{ field: "excludeSemanticGraphIds", code: "INVALID_TYPE" }]);
  const excludedIds = [...new Set(excludeSemanticGraphIds.map((entry) => String(entry || "").trim()).filter(Boolean))];
  excludedIds.forEach((entry, index) => assertObjectId(entry, `excludeSemanticGraphIds[${index}]`));

  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_context.view" });
  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404);
  await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });

  let contentSpace = null;
  if (contentSpaceId) {
    assertObjectId(contentSpaceId, "contentSpaceId");
    contentSpace = await findContentSpaceOrFail({ contentSpaceId });
    if (contentSpace.ownerType !== ownerType || !sameId(contentSpace.ownerId, ownerId)) {
      throw new AppError("Lo spazio editoriale non appartiene all'area di lavoro selezionata", 409, [{ code: "CONTENT_SPACE_OWNER_MISMATCH" }]);
    }
    await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  }

  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
  const normalizedQuery = clean(query).slice(0, 160);
  const match = {
    ownerType,
    ownerId,
    namespaceId: namespace._id,
    lifecycleStatus: "active",
    ...(excludedIds.length ? { _id: { $nin: excludedIds } } : {}),
    ...(normalizedQuery ? {
      $or: [
        { displayName: new RegExp(escapeRegex(normalizedQuery), "i") },
        { description: new RegExp(escapeRegex(normalizedQuery), "i") },
      ],
    } : {}),
  };

  const [total, graphs] = await Promise.all([
    SemanticGraph.countDocuments(match),
    SemanticGraph.find(match)
      .select("displayName description namespaceId workingRevisionId workingVersion updatedAt")
      .sort({ updatedAt: -1, displayName: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  if (!graphs.length) {
    return {
      results: [],
      pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    };
  }

  const graphIds = graphs.map((graph) => graph._id);
  const workingRevisionIds = graphs.map((graph) => graph.workingRevisionId).filter(Boolean);
  const [contextRows, bindings, edgeCounts, spaceInventory] = await Promise.all([
    EditorialContext.aggregate([
      { $match: { semanticGraphId: { $in: graphIds }, lifecycleStatus: "active" } },
      { $group: {
        _id: "$semanticGraphId",
        collectionIds: { $addToSet: "$_id" },
        contentSpaceIds: { $addToSet: "$contentSpaceId" },
      } },
    ]),
    workingRevisionIds.length
      ? GraphSubjectBinding.find({ graphRevisionId: { $in: workingRevisionIds } }).select("graphRevisionId subjectId").lean()
      : [],
    workingRevisionIds.length ? SemanticEdgeV2.aggregate([
      { $match: { graphRevisionId: { $in: workingRevisionIds } } },
      { $group: { _id: "$graphRevisionId", count: { $sum: 1 } } },
    ]) : [],
    contentSpace ? contentSpaceSubjectInventory(contentSpace._id) : new Map(),
  ]);

  const contextByGraph = new Map(contextRows.map((entry) => [id(entry._id), {
    collectionUsageCount: entry.collectionIds.length,
    contentSpaceUsageCount: entry.contentSpaceIds.length,
    currentSpaceCollectionUsageCount: 0,
  }]));
  if (contentSpace) {
    const currentSpaceRows = await EditorialContext.aggregate([
      { $match: { semanticGraphId: { $in: graphIds }, contentSpaceId: contentSpace._id, lifecycleStatus: "active" } },
      { $group: { _id: "$semanticGraphId", count: { $sum: 1 } } },
    ]);
    for (const row of currentSpaceRows) {
      const value = contextByGraph.get(id(row._id)) || { collectionUsageCount: 0, contentSpaceUsageCount: 0 };
      value.currentSpaceCollectionUsageCount = Number(row.count || 0);
      contextByGraph.set(id(row._id), value);
    }
  }

  const bindingsByRevision = new Map();
  for (const binding of bindings) {
    const revisionId = id(binding.graphRevisionId);
    const rows = bindingsByRevision.get(revisionId) || [];
    rows.push(binding);
    bindingsByRevision.set(revisionId, rows);
  }
  const edgeCountByRevision = new Map(edgeCounts.map((entry) => [id(entry._id), Number(entry.count || 0)]));

  return {
    results: graphs.map((graph) => {
      const usage = contextByGraph.get(id(graph._id)) || {
        collectionUsageCount: 0,
        contentSpaceUsageCount: 0,
        currentSpaceCollectionUsageCount: 0,
      };
      const graphBindings = bindingsByRevision.get(id(graph.workingRevisionId)) || [];
      const subjectCount = graphBindings.length;
      let coveredSubjectCount = 0;
      let ambiguousSubjectCount = 0;
      if (contentSpace) {
        for (const binding of graphBindings) {
          const candidates = spaceInventory.get(id(binding.subjectId)) || [];
          if (candidates.length) coveredSubjectCount += 1;
          if (candidates.length > 1) ambiguousSubjectCount += 1;
        }
      }
      return {
        id: graph._id,
        name: graph.displayName,
        description: graph.description || "",
        namespaceId: graph.namespaceId,
        workingRevisionId: graph.workingRevisionId || null,
        workingVersion: Number(graph.workingVersion || 0),
        collectionUsageCount: usage.collectionUsageCount,
        contentSpaceUsageCount: usage.contentSpaceUsageCount,
        currentSpaceCollectionUsageCount: usage.currentSpaceCollectionUsageCount || 0,
        usedInCurrentSpace: Boolean(usage.currentSpaceCollectionUsageCount),
        subjectCount,
        relationCount: edgeCountByRevision.get(id(graph.workingRevisionId)) || 0,
        currentSpaceCoverage: contentSpace ? {
          coveredSubjectCount,
          ambiguousSubjectCount,
          directlyImportableSubjectCount: Math.max(0, coveredSubjectCount - ambiguousSubjectCount),
          uncoveredSubjectCount: Math.max(0, subjectCount - coveredSubjectCount),
          totalSubjectCount: subjectCount,
        } : null,
        updatedAt: graph.updatedAt || null,
      };
    }),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
  };
}

async function loadCompatibleGraph({ semanticGraphId, ownerType, ownerId, namespaceId }) {
  assertObjectId(semanticGraphId, "semanticGraphId");
  const semanticGraph = await SemanticGraph.findOne({ _id: semanticGraphId, lifecycleStatus: "active" });
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 404);
  if (semanticGraph.ownerType !== ownerType || !sameId(semanticGraph.ownerId, ownerId)) {
    throw new AppError("Il grafo semantico non appartiene all'area di lavoro selezionata", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
  }
  if (!sameId(semanticGraph.namespaceId, namespaceId)) {
    throw new AppError("Il grafo semantico usa regole editoriali diverse", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
  }
  if (!semanticGraph.workingRevisionId) {
    throw new AppError("Il grafo semantico non ha una revisione di lavoro", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_REQUIRED" }]);
  }
  return semanticGraph;
}

function assertCreationPayloadIsLocalOnly(payload) {
  for (const field of ["graphMode", "semanticGraphId", "importItemIds", "graphDisplayName", "graphDescription"]) {
    if (payload?.[field] !== undefined) {
      throw new AppError("La Raccolta crea sempre un nuovo grafo locale; le sorgenti si aggiungono dalla sezione Collegamenti", 400, [{
        field,
        code: "UNEXPECTED",
      }]);
    }
  }
}

async function createEditorialStudioCollection({ payload, actorUserId }) {
  const ownerType = payload?.ownerType;
  const ownerId = payload?.ownerId;
  const contentSpaceId = payload?.contentSpaceId;
  const namespaceId = payload?.namespaceId;
  const displayName = clean(payload?.displayName);
  const shortDescription = clean(payload?.shortDescription) || null;
  const description = clean(payload?.description) || null;

  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  assertObjectId(ownerId, "ownerId");
  assertObjectId(contentSpaceId, "contentSpaceId");
  assertObjectId(namespaceId, "namespaceId");
  assertCreationPayloadIsLocalOnly(payload);
  if (!displayName) throw new AppError("Nome della raccolta obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);

  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_context.create" });
  const [contentSpace, namespace] = await Promise.all([
    findContentSpaceOrFail({ contentSpaceId }),
    Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" }),
  ]);
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404);
  if (contentSpace.ownerType !== ownerType || !sameId(contentSpace.ownerId, ownerId)) {
    throw new AppError("Lo spazio editoriale non appartiene all'area di lavoro selezionata", 409, [{ code: "CONTENT_SPACE_OWNER_MISMATCH" }]);
  }
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.create");

  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });
  const authorizedNamespaceRef = namespaceAccess?.resolvedSnapshotRef;
  const namespaceRevisionId = authorizedNamespaceRef?.resourceType === "namespace_revision"
    ? authorizedNamespaceRef.resourceId
    : namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!namespaceRevisionId) {
    throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409, [{ code: "NAMESPACE_REVISION_REQUIRED" }]);
  }
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: namespace._id }).lean();
  if (!namespaceRevision) {
    throw new AppError("La revisione delle regole editoriali non è disponibile", 409, [{ code: "NAMESPACE_REVISION_NOT_AVAILABLE" }]);
  }

  let semanticGraph = null;
  let editorialContext = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      [semanticGraph] = await SemanticGraph.create([{
        namespaceId: namespace._id,
        displayName: `${displayName} · grafo`,
        description: null,
        ownerType,
        ownerId,
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
        displayName,
        shortDescription,
        description,
        createdBy: actorUserId,
      }], { session });
    });

    const adoption = await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: namespaceRevision._id },
      resultResourceRef: { resourceType: "editorial_context", resourceId: editorialContext._id },
    });
    return {
      contentSpace: { id: contentSpace._id, name: contentSpace.name },
      semanticGraph: {
        id: semanticGraph._id,
        name: semanticGraph.displayName,
        description: semanticGraph.description || "",
        created: true,
        localToCollection: true,
      },
      editorialContext: await projectEditorialContext({ editorialContext, contentSpace, namespace }),
      adoptionId: adoption?._id || null,
    };
  } catch (error) {
    if (editorialContext?._id) await EditorialContext.deleteOne({ _id: editorialContext._id }).catch(() => {});
    if (semanticGraph?._id) {
      await Promise.allSettled([
        SemanticGraphRevision.deleteMany({ semanticGraphId: semanticGraph._id }),
        SemanticGraph.deleteOne({ _id: semanticGraph._id }),
      ]);
    }
    throw error;
  }
}

module.exports = {
  createEditorialStudioCollection,
  listReusableSemanticGraphs,
  loadCompatibleGraph,
};
