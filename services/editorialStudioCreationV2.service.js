const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemV2 = require("../models/itemV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { assertCanReferenceItemInEditorialSpace } = require("./itemUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");
const { loadSemanticGraphRevision, validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");

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
  excludeSemanticGraphId = null,
  query = "",
  page = 1,
  limit = 30,
}) {
  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  assertObjectId(ownerId, "ownerId");
  assertObjectId(namespaceId, "namespaceId");
  if (excludeSemanticGraphId) assertObjectId(excludeSemanticGraphId, "excludeSemanticGraphId");

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
    ...(excludeSemanticGraphId ? { _id: { $ne: excludeSemanticGraphId } } : {}),
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

function normalizeImportItemIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError("importItemIds deve essere un array", 400, [{ field: "importItemIds", code: "INVALID_TYPE" }]);
  const values = [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
  values.forEach((entry, index) => assertObjectId(entry, `importItemIds[${index}]`));
  return values;
}

async function resolveImportItems({ contentSpace, sourceSnapshot, importItemIds, actorUserId }) {
  if (!importItemIds.length) return [];
  const objectIds = importItemIds.map((value) => new mongoose.Types.ObjectId(value));
  const [memberships, items] = await Promise.all([
    ContentSpaceItemMembership.find({ contentSpaceId: contentSpace._id, itemId: { $in: objectIds } }).select("itemId").lean(),
    ItemV2.find({ _id: { $in: objectIds }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean(),
  ]);
  const membershipIds = new Set(memberships.map((entry) => id(entry.itemId)));
  const itemById = new Map(items.map((entry) => [id(entry), entry]));
  const sourceSubjectIds = new Set([...sourceSnapshot.nodes.values()]
    .filter((node) => node.binding)
    .map((node) => id(node.subject)));
  const resolved = [];
  for (const itemId of importItemIds) {
    if (!membershipIds.has(itemId)) {
      throw new AppError("Il contenuto selezionato deve appartenere allo spazio editoriale", 409, [{
        field: "importItemIds",
        code: "ITEM_NOT_IN_CONTENT_SPACE",
        context: { itemId },
      }]);
    }
    const item = itemById.get(itemId);
    if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE", context: { itemId } }]);
    if (!sourceSubjectIds.has(id(item.primarySubjectId))) {
      throw new AppError("Il contenuto selezionato non rappresenta un Subject del grafo sorgente", 409, [{
        field: "importItemIds",
        code: "IMPORT_ITEM_SUBJECT_NOT_IN_SOURCE_GRAPH",
        context: { itemId, subjectId: item.primarySubjectId },
      }]);
    }
    await assertCanReferenceItemInEditorialSpace({
      itemId: item._id,
      actorUserId,
      principalType: contentSpace.ownerType,
      principalId: contentSpace.ownerId,
    });
    resolved.push(item);
  }
  return resolved;
}

function projectSourceSnapshot(sourceSnapshot, importedSubjectIds) {
  const active = new Set(importedSubjectIds.map(id));
  const subjectBindings = [...sourceSnapshot.nodes.values()]
    .filter((node) => node.binding && active.has(id(node.subject)))
    .map((node) => ({
      subjectId: node.subject._id,
      subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
    }));
  const edges = sourceSnapshot.authoritativeEdges
    .filter((edge) => active.has(id(edge.sourceSubjectId)) && active.has(id(edge.targetSubjectId)))
    .map((edge) => ({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: {
        origin: "imported",
        sourceGraphRevisionId: sourceSnapshot.revision._id,
        metadata: edge.provenance ? { sourceProvenance: edge.provenance } : null,
      },
    }));
  return { subjectBindings, edges };
}

async function createEditorialStudioCollection({ payload, actorUserId }) {
  const ownerType = payload?.ownerType;
  const ownerId = payload?.ownerId;
  const contentSpaceId = payload?.contentSpaceId;
  const namespaceId = payload?.namespaceId;
  const graphMode = clean(payload?.graphMode || "new").toLowerCase();
  const requestedSemanticGraphId = payload?.semanticGraphId || null;
  const graphDisplayName = clean(payload?.graphDisplayName);
  const graphDescription = clean(payload?.graphDescription) || null;
  const importItemIds = normalizeImportItemIds(payload?.importItemIds);
  const displayName = clean(payload?.displayName);
  const shortDescription = clean(payload?.shortDescription) || null;
  const description = clean(payload?.description) || null;

  if (!["user", "organization"].includes(ownerType)) throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  assertObjectId(ownerId, "ownerId");
  assertObjectId(contentSpaceId, "contentSpaceId");
  assertObjectId(namespaceId, "namespaceId");
  if (!["new", "import"].includes(graphMode)) throw new AppError("graphMode non valido", 400, [{ field: "graphMode", code: "INVALID_ENUM", allowedValues: ["new", "import"] }]);
  if (!displayName) throw new AppError("Nome della raccolta obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);
  if (graphMode === "new" && requestedSemanticGraphId) throw new AppError("Un nuovo grafo non deve indicare semanticGraphId", 400, [{ field: "semanticGraphId", code: "UNEXPECTED" }]);
  if (graphMode === "import" && !requestedSemanticGraphId) throw new AppError("Scegli il grafo semantico sorgente", 400, [{ field: "semanticGraphId", code: "REQUIRED" }]);
  if (graphMode === "new" && !graphDisplayName) throw new AppError("Nome del nuovo grafo obbligatorio", 400, [{ field: "graphDisplayName", code: "REQUIRED" }]);
  if (graphMode === "new" && importItemIds.length) throw new AppError("Un nuovo grafo non può importare contenuti da una sorgente", 400, [{ field: "importItemIds", code: "UNEXPECTED" }]);

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

  let sourceGraph = null;
  let sourceSnapshot = null;
  let importItems = [];
  let projected = { subjectBindings: [], edges: [] };
  if (graphMode === "import") {
    sourceGraph = await loadCompatibleGraph({
      semanticGraphId: requestedSemanticGraphId,
      ownerType,
      ownerId,
      namespaceId: namespace._id,
    });
    sourceSnapshot = await loadSemanticGraphRevision(sourceGraph.workingRevisionId);
    importItems = await resolveImportItems({ contentSpace, sourceSnapshot, importItemIds, actorUserId });
    projected = projectSourceSnapshot(sourceSnapshot, [...new Set(importItems.map((item) => id(item.primarySubjectId)))]);
    const issues = validateGraphSnapshotAgainstNamespace(projected, namespaceRevision);
    if (issues.length) throw new AppError("La porzione selezionata del grafo sorgente non è compatibile con le Regole editoriali della Raccolta", 409, issues);
  }

  const localGraphName = graphDisplayName || `${displayName} · grafo`;
  let semanticGraph = null;
  let editorialContext = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      if (sourceGraph && sourceSnapshot) {
        const sourceStillExists = await SemanticGraphRevision.exists({
          _id: sourceSnapshot.revision._id,
          semanticGraphId: sourceGraph._id,
        }).session(session);
        if (!sourceStillExists) throw new AppError("La revisione del grafo sorgente non è più disponibile", 409, [{ code: "SEMANTIC_GRAPH_IMPORT_SOURCE_REVISION_MISSING" }]);
      }

      [semanticGraph] = await SemanticGraph.create([{
        namespaceId: namespace._id,
        displayName: localGraphName,
        description: graphDescription || (sourceGraph ? `Importato da ${sourceGraph.displayName}` : null),
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

      if (projected.subjectBindings.length) {
        await GraphSubjectBinding.insertMany(projected.subjectBindings.map((binding) => ({
          graphRevisionId: initialRevision._id,
          subjectId: binding.subjectId,
          subjectClassDefinitionIds: binding.subjectClassDefinitionIds || [],
        })), { session, ordered: true });
      }
      if (projected.edges.length) {
        await SemanticEdgeV2.insertMany(projected.edges.map((edge) => ({
          graphRevisionId: initialRevision._id,
          sourceSubjectId: edge.sourceSubjectId,
          targetSubjectId: edge.targetSubjectId,
          relationTypeDefinitionId: edge.relationTypeDefinitionId,
          weight: edge.weight,
          metadata: edge.metadata ?? null,
          provenance: edge.provenance,
        })), { session, ordered: true });
      }

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

      if (sourceGraph && sourceSnapshot) {
        await EditorialGraphImportSource.create([{
          editorialContextId: editorialContext._id,
          targetSemanticGraphId: semanticGraph._id,
          sourceSemanticGraphId: sourceGraph._id,
          sourceGraphRevisionId: sourceSnapshot.revision._id,
          createdBy: actorUserId,
        }], { session });
      }

      if (importItems.length) {
        await CollectionItemMembership.insertMany(importItems.map((item) => ({
          editorialContextId: editorialContext._id,
          itemId: item._id,
          curationSignals: [],
          addedBy: actorUserId,
          updatedBy: actorUserId,
        })), { session, ordered: true });
        for (const subjectId of [...new Set(importItems.map((item) => id(item.primarySubjectId)))]) {
          await ContentSpaceSubjectMembership.findOneAndUpdate(
            { contentSpaceId: contentSpace._id, subjectId },
            { $setOnInsert: { contentSpaceId: contentSpace._id, subjectId, addedBy: actorUserId } },
            { upsert: true, new: true, session },
          );
        }
        editorialContext.workingVersion = 1;
        await editorialContext.save({ session });
      }
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
        mode: graphMode,
        created: true,
        sourceSemanticGraphId: sourceGraph?._id || null,
        sourceGraphRevisionId: sourceSnapshot?.revision?._id || null,
        importedSubjectCount: projected.subjectBindings.length,
        importedRelationCount: projected.edges.length,
      },
      editorialContext: await projectEditorialContext({ editorialContext, contentSpace, namespace }),
      adoptionId: adoption?._id || null,
    };
  } catch (error) {
    if (editorialContext?._id) {
      await Promise.allSettled([
        EditorialGraphImportSource.deleteMany({ editorialContextId: editorialContext._id }),
        CollectionItemMembership.deleteMany({ editorialContextId: editorialContext._id }),
        EditorialContext.deleteOne({ _id: editorialContext._id }),
      ]);
    }
    if (semanticGraph?._id) {
      const revisions = await SemanticGraphRevision.find({ semanticGraphId: semanticGraph._id }).select("_id").lean().catch(() => []);
      const revisionIds = revisions.map((revision) => revision._id);
      await Promise.allSettled([
        GraphSubjectBinding.deleteMany({ graphRevisionId: { $in: revisionIds } }),
        SemanticEdgeV2.deleteMany({ graphRevisionId: { $in: revisionIds } }),
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
  projectSourceSnapshot,
};