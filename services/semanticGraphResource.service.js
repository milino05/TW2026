const mongoose = require("mongoose");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialContext = require("../models/editorialContext.model");
const ContentSpace = require("../models/contentSpace.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess } = require("./marketplaceAdoptionV2.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function clean(value) { return String(value || "").trim(); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
  }
}
function normalizeOwner(ownerType, ownerId) {
  if (!["user", "organization"].includes(ownerType)) {
    throw new AppError("ownerType non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM" }]);
  }
  assertObjectId(ownerId, "ownerId");
  return { ownerType, ownerId };
}

async function assertCanReadSemanticGraph(graph, actorUserId) {
  return assertCanActForOwner({
    actorUserId,
    ownerType: graph.ownerType,
    ownerId: graph.ownerId,
    permissionCode: "editorial_context.view",
  });
}

async function assertCanEditSemanticGraph(graph, actorUserId) {
  return assertCanActForOwner({
    actorUserId,
    ownerType: graph.ownerType,
    ownerId: graph.ownerId,
    permissionCode: "semantic_graph.edit",
  });
}

async function findSemanticGraphResourceOrFail({ semanticGraphId, includeTrashed = false, actorUserId = null, write = false }) {
  assertObjectId(semanticGraphId, "semanticGraphId");
  const query = { _id: semanticGraphId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const graph = await SemanticGraph.findOne(query);
  if (!graph) throw new AppError("Grafo semantico non trovato", 404);
  if (actorUserId) {
    if (write) await assertCanEditSemanticGraph(graph, actorUserId);
    else await assertCanReadSemanticGraph(graph, actorUserId);
  }
  return graph;
}

async function resolveAuthoringNamespace({ namespaceId, actorUserId, ownerType, ownerId }) {
  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404);
  const access = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });
  const authorizedRevisionId = access?.resolvedSnapshotRef?.resourceType === "namespace_revision"
    ? access.resolvedSnapshotRef.resourceId
    : namespace.workingRevisionId || namespace.publishedRevisionId;
  if (!authorizedRevisionId) {
    throw new AppError("Le regole editoriali non hanno una revisione utilizzabile", 409, [{ code: "NAMESPACE_REVISION_REQUIRED" }]);
  }
  const namespaceRevision = await NamespaceRevision.findOne({
    _id: authorizedRevisionId,
    namespaceId: namespace._id,
  });
  if (!namespaceRevision) {
    throw new AppError("La revisione delle regole editoriali non è disponibile", 409, [{ code: "NAMESPACE_REVISION_NOT_AVAILABLE" }]);
  }
  return { namespace, namespaceRevision, access };
}

async function semanticGraphUsage(graphIds) {
  const ids = (graphIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await EditorialContext.aggregate([
    { $match: { semanticGraphId: { $in: ids }, lifecycleStatus: "active" } },
    { $group: {
      _id: "$semanticGraphId",
      collectionIds: { $addToSet: "$_id" },
      contentSpaceIds: { $addToSet: "$contentSpaceId" },
    } },
  ]);
  return new Map(rows.map((row) => [id(row._id), {
    collectionUsageCount: row.collectionIds.length,
    contentSpaceUsageCount: row.contentSpaceIds.length,
  }]));
}

async function semanticGraphWorkingCounts(graphs) {
  const revisionIds = (graphs || []).map((graph) => graph.workingRevisionId).filter(Boolean);
  if (!revisionIds.length) return { subjects: new Map(), edges: new Map() };
  const [subjectRows, edgeRows] = await Promise.all([
    GraphSubjectBinding.aggregate([
      { $match: { graphRevisionId: { $in: revisionIds } } },
      { $group: { _id: "$graphRevisionId", count: { $sum: 1 } } },
    ]),
    SemanticEdgeV2.aggregate([
      { $match: { graphRevisionId: { $in: revisionIds } } },
      { $group: { _id: "$graphRevisionId", count: { $sum: 1 } } },
    ]),
  ]);
  return {
    subjects: new Map(subjectRows.map((row) => [id(row._id), Number(row.count || 0)])),
    edges: new Map(edgeRows.map((row) => [id(row._id), Number(row.count || 0)])),
  };
}

function projectSemanticGraphResource(graph, { usage = null, subjectCount = 0, relationCount = 0 } = {}) {
  return {
    id: graph._id,
    name: graph.displayName,
    description: graph.description || "",
    namespaceId: graph.namespaceId,
    ownerType: graph.ownerType,
    ownerId: graph.ownerId,
    workingRevisionId: graph.workingRevisionId || null,
    workingVersion: Number(graph.workingVersion || 0),
    lifecycleStatus: graph.lifecycleStatus,
    subjectCount: Number(subjectCount || 0),
    relationCount: Number(relationCount || 0),
    collectionUsageCount: Number(usage?.collectionUsageCount || 0),
    contentSpaceUsageCount: Number(usage?.contentSpaceUsageCount || 0),
    updatedAt: graph.updatedAt || null,
    createdAt: graph.createdAt || null,
  };
}

async function listSemanticGraphs({ actorUserId, ownerType, ownerId, namespaceId = null, q = "", page = 1, limit = 30 }) {
  normalizeOwner(ownerType, ownerId);
  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "editorial_context.view" });
  if (namespaceId) assertObjectId(namespaceId, "namespaceId");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 30));
  const normalizedQuery = clean(q).slice(0, 160);
  const match = {
    ownerType,
    ownerId,
    lifecycleStatus: "active",
    ...(namespaceId ? { namespaceId } : {}),
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
      .sort({ updatedAt: -1, displayName: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const [usageByGraph, counts] = await Promise.all([
    semanticGraphUsage(graphs.map((graph) => graph._id)),
    semanticGraphWorkingCounts(graphs),
  ]);
  return {
    results: graphs.map((graph) => projectSemanticGraphResource(graph, {
      usage: usageByGraph.get(id(graph._id)),
      subjectCount: counts.subjects.get(id(graph.workingRevisionId)) || 0,
      relationCount: counts.edges.get(id(graph.workingRevisionId)) || 0,
    })),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
  };
}

async function graphUsageDetails(semanticGraphId) {
  const contexts = await EditorialContext.find({ semanticGraphId, lifecycleStatus: "active" })
    .select("displayName contentSpaceId namespaceId workingVersion updatedAt")
    .sort({ updatedAt: -1, displayName: 1 })
    .lean();
  const spaceIds = [...new Set(contexts.map((context) => id(context.contentSpaceId)).filter(Boolean))];
  const spaces = spaceIds.length
    ? await ContentSpace.find({ _id: { $in: spaceIds } }).select("name lifecycleStatus").lean()
    : [];
  const spaceById = new Map(spaces.map((space) => [id(space._id), space]));
  return contexts.map((context) => ({
    editorialContextId: context._id,
    collectionName: context.displayName,
    contentSpaceId: context.contentSpaceId,
    contentSpaceName: spaceById.get(id(context.contentSpaceId))?.name || null,
    contentSpaceLifecycleStatus: spaceById.get(id(context.contentSpaceId))?.lifecycleStatus || null,
    workingVersion: Number(context.workingVersion || 0),
  }));
}

async function getSemanticGraphResource({ semanticGraphId, actorUserId }) {
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  const [usageByGraph, counts, namespace, usages] = await Promise.all([
    semanticGraphUsage([graph._id]),
    semanticGraphWorkingCounts([graph]),
    Namespace.findById(graph.namespaceId).select("name description lifecycleStatus workingRevisionId publishedRevisionId").lean(),
    graphUsageDetails(graph._id),
  ]);
  return {
    graph: projectSemanticGraphResource(graph, {
      usage: usageByGraph.get(id(graph._id)),
      subjectCount: counts.subjects.get(id(graph.workingRevisionId)) || 0,
      relationCount: counts.edges.get(id(graph.workingRevisionId)) || 0,
    }),
    namespace: namespace ? {
      id: namespace._id,
      name: namespace.name,
      description: namespace.description || "",
      lifecycleStatus: namespace.lifecycleStatus,
      workingRevisionId: namespace.workingRevisionId || null,
      publishedRevisionId: namespace.publishedRevisionId || null,
    } : null,
    usages,
  };
}

async function createSemanticGraphResource({ payload, actorUserId }) {
  const ownerType = payload?.ownerType;
  const ownerId = payload?.ownerId;
  const namespaceId = payload?.namespaceId;
  const displayName = clean(payload?.displayName || payload?.name);
  const description = clean(payload?.description) || null;
  normalizeOwner(ownerType, ownerId);
  assertObjectId(namespaceId, "namespaceId");
  if (!displayName) throw new AppError("Nome del grafo obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);
  await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode: "semantic_graph.edit" });
  const { namespace, namespaceRevision, access } = await resolveAuthoringNamespace({
    namespaceId,
    actorUserId,
    ownerType,
    ownerId,
  });
  let graph = null;
  let revision = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      [graph] = await SemanticGraph.create([{
        namespaceId: namespace._id,
        displayName,
        description,
        ownerType,
        ownerId,
        createdBy: actorUserId,
      }], { session });
      [revision] = await SemanticGraphRevision.create([{
        semanticGraphId: graph._id,
        version: 1,
        basedOnRevisionId: null,
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        createdBy: actorUserId,
      }], { session });
      graph.workingRevisionId = revision._id;
      graph.workingVersion = 1;
      await graph.save({ session });
    });
    const adoption = await recordAdoptionFromAccess({
      access,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: namespaceRevision._id },
      resultResourceRef: { resourceType: "semantic_graph", resourceId: graph._id },
    });
    return {
      graph: projectSemanticGraphResource(graph),
      revisionId: revision._id,
      adoptionId: adoption?._id || null,
    };
  } catch (error) {
    if (graph?._id) {
      await Promise.allSettled([
        SemanticGraphRevision.deleteMany({ semanticGraphId: graph._id }),
        SemanticGraph.deleteOne({ _id: graph._id }),
      ]);
    }
    throw error;
  }
}

async function updateSemanticGraphResource({ semanticGraphId, payload, actorUserId }) {
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId, write: true });
  const hasName = Object.prototype.hasOwnProperty.call(payload || {}, "displayName") || Object.prototype.hasOwnProperty.call(payload || {}, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(payload || {}, "description");
  if (!hasName && !hasDescription) throw new AppError("Nessuna modifica specificata", 400);
  if (hasName) {
    const name = clean(payload.displayName ?? payload.name);
    if (!name) throw new AppError("Nome del grafo obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);
    graph.displayName = name;
  }
  if (hasDescription) graph.description = clean(payload.description) || null;
  await graph.save();
  const usageByGraph = await semanticGraphUsage([graph._id]);
  const counts = await semanticGraphWorkingCounts([graph]);
  return projectSemanticGraphResource(graph, {
    usage: usageByGraph.get(id(graph._id)),
    subjectCount: counts.subjects.get(id(graph.workingRevisionId)) || 0,
    relationCount: counts.edges.get(id(graph.workingRevisionId)) || 0,
  });
}

async function forkSemanticGraphResource({ semanticGraphId, payload, actorUserId }) {
  const source = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  const targetOwnerType = payload?.ownerType || source.ownerType;
  const targetOwnerId = payload?.ownerId || source.ownerId;
  const displayName = clean(payload?.displayName || payload?.name);
  const description = Object.prototype.hasOwnProperty.call(payload || {}, "description")
    ? (clean(payload.description) || null)
    : (source.description || null);
  normalizeOwner(targetOwnerType, targetOwnerId);
  if (!sameId(source.ownerId, targetOwnerId) || source.ownerType !== targetOwnerType) {
    throw new AppError("La copia indipendente del grafo deve restare nello stesso proprietario", 409, [{ code: "SEMANTIC_GRAPH_FORK_OWNER_MISMATCH" }]);
  }
  if (!displayName) throw new AppError("Nome della copia obbligatorio", 400, [{ field: "displayName", code: "REQUIRED" }]);
  await assertCanActForOwner({ actorUserId, ownerType: targetOwnerType, ownerId: targetOwnerId, permissionCode: "semantic_graph.edit" });
  const { namespaceRevision } = await resolveAuthoringNamespace({
    namespaceId: source.namespaceId,
    actorUserId,
    ownerType: targetOwnerType,
    ownerId: targetOwnerId,
  });
  if (!source.workingRevisionId) throw new AppError("Il grafo sorgente non ha una revisione di lavoro", 409);
  const sourceSnapshot = await loadSemanticGraphRevision(source.workingRevisionId);
  if (!sameId(sourceSnapshot.revision.authoredAgainstNamespaceRevisionId, namespaceRevision._id)) {
    throw new AppError("La revisione corrente del grafo non è compatibile con la revisione Namespace autorizzata", 409, [{ code: "SEMANTIC_GRAPH_FORK_NAMESPACE_REVISION_MISMATCH" }]);
  }
  let fork = null;
  let forkRevision = null;
  await mongoose.connection.transaction(async (session) => {
    [fork] = await SemanticGraph.create([{
      namespaceId: source.namespaceId,
      displayName,
      description,
      ownerType: targetOwnerType,
      ownerId: targetOwnerId,
      createdBy: actorUserId,
    }], { session });
    [forkRevision] = await SemanticGraphRevision.create([{
      semanticGraphId: fork._id,
      version: 1,
      basedOnRevisionId: null,
      authoredAgainstNamespaceRevisionId: sourceSnapshot.revision.authoredAgainstNamespaceRevisionId,
      createdBy: actorUserId,
    }], { session });
    const bindings = [...sourceSnapshot.nodes.values()]
      .filter((node) => node.binding)
      .map((node) => ({
        graphRevisionId: forkRevision._id,
        subjectId: node.subject._id,
        subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
      }));
    if (bindings.length) await GraphSubjectBinding.insertMany(bindings, { session, ordered: true });
    if (sourceSnapshot.authoritativeEdges.length) {
      await SemanticEdgeV2.insertMany(sourceSnapshot.authoritativeEdges.map((edge) => ({
        graphRevisionId: forkRevision._id,
        sourceSubjectId: edge.sourceSubjectId,
        targetSubjectId: edge.targetSubjectId,
        relationTypeDefinitionId: edge.relationTypeDefinitionId,
        weight: edge.weight,
        metadata: edge.metadata ?? null,
        provenance: {
          origin: "forked",
          sourceGraphRevisionId: sourceSnapshot.revision._id,
          metadata: edge.provenance ? { sourceProvenance: edge.provenance } : null,
        },
      })), { session, ordered: true });
    }
    fork.workingRevisionId = forkRevision._id;
    fork.workingVersion = 1;
    await fork.save({ session });
  });
  const counts = await semanticGraphWorkingCounts([fork]);
  return {
    graph: projectSemanticGraphResource(fork, {
      subjectCount: counts.subjects.get(id(forkRevision._id)) || 0,
      relationCount: counts.edges.get(id(forkRevision._id)) || 0,
    }),
    sourceSemanticGraphId: source._id,
    sourceGraphRevisionId: sourceSnapshot.revision._id,
  };
}

async function trashSemanticGraphResource({ semanticGraphId, actorUserId }) {
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId, write: true });
  const activeCollectionCount = await EditorialContext.countDocuments({ semanticGraphId: graph._id, lifecycleStatus: "active" });
  if (activeCollectionCount > 0) {
    throw new AppError("Il grafo è ancora usato da raccolte attive", 409, [{
      code: "SEMANTIC_GRAPH_IN_ACTIVE_COLLECTIONS",
      context: { activeCollectionCount },
    }]);
  }
  graph.lifecycleStatus = "trashed";
  graph.trashedAt = new Date();
  graph.trashedBy = actorUserId;
  await graph.save();
  return { semanticGraphId: graph._id, lifecycleStatus: graph.lifecycleStatus };
}

async function restoreSemanticGraphResource({ semanticGraphId, actorUserId }) {
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, includeTrashed: true, actorUserId, write: true });
  if (graph.lifecycleStatus === "active") return { semanticGraphId: graph._id, lifecycleStatus: graph.lifecycleStatus };
  const namespace = await Namespace.findOne({ _id: graph.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Ripristina prima le regole editoriali usate dal grafo", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_NOT_ACTIVE" }]);
  await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType: graph.ownerType,
    principalId: graph.ownerId,
  });
  graph.lifecycleStatus = "active";
  graph.trashedAt = null;
  graph.trashedBy = null;
  await graph.save();
  return { semanticGraphId: graph._id, lifecycleStatus: graph.lifecycleStatus };
}

function projectSemanticGraphSnapshot(graphState, semanticGraph = null) {
  const graph = graphState || null;
  return {
    semanticGraph: semanticGraph ? projectSemanticGraphResource(semanticGraph) : null,
    revision: graph ? {
      id: graph.revision._id,
      version: graph.revision.version,
      basedOnRevisionId: graph.revision.basedOnRevisionId || null,
      authoredAgainstNamespaceRevisionId: graph.revision.authoredAgainstNamespaceRevisionId,
    } : null,
    effectiveNamespaceRevisionId: graph?.namespaceRevision?._id || null,
    subjects: graph ? [...graph.nodes.values()].map((node) => ({
      subject: node.subject,
      subjectClassDefinitionIds: node.binding?.subjectClassDefinitionIds || [],
    })) : [],
    edges: graph ? graph.authoritativeEdges.map((edge) => ({
      id: edge._id,
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance ?? null,
    })) : [],
  };
}

async function getSemanticGraphSnapshot({ semanticGraphId, actorUserId }) {
  const semanticGraph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  const graph = semanticGraph.workingRevisionId ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId) : null;
  return projectSemanticGraphSnapshot(graph, semanticGraph);
}

async function listSemanticGraphSubjects({ semanticGraphId, actorUserId, q = "", page = 1, limit = 30 }) {
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const normalizedQuery = clean(q).slice(0, 160);
  if (!graph.workingRevisionId) {
    return { results: [], pagination: { page: normalizedPage, limit: normalizedLimit, total: 0, totalPages: 0 }, query: normalizedQuery };
  }
  const matchingSubjects = normalizedQuery
    ? await Subject.find({
      $or: [
        { preferredLabel: new RegExp(escapeRegex(normalizedQuery), "i") },
        { description: new RegExp(escapeRegex(normalizedQuery), "i") },
      ],
    }).select("_id").limit(3000).lean()
    : null;
  const bindingQuery = {
    graphRevisionId: graph.workingRevisionId,
    ...(matchingSubjects ? { subjectId: { $in: matchingSubjects.map((subject) => subject._id) } } : {}),
  };
  const [total, bindings] = await Promise.all([
    GraphSubjectBinding.countDocuments(bindingQuery),
    GraphSubjectBinding.find(bindingQuery)
      .sort({ _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const subjects = bindings.length
    ? await Subject.find({ _id: { $in: bindings.map((binding) => binding.subjectId) } })
      .select("preferredLabel description externalIdentities")
      .lean()
    : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  const relationRows = bindings.length
    ? await SemanticEdgeV2.aggregate([
      { $match: {
        graphRevisionId: graph.workingRevisionId,
        $or: [
          { sourceSubjectId: { $in: bindings.map((binding) => binding.subjectId) } },
          { targetSubjectId: { $in: bindings.map((binding) => binding.subjectId) } },
        ],
      } },
      { $project: { participants: { $setUnion: [["$sourceSubjectId"], ["$targetSubjectId"]] } } },
      { $unwind: "$participants" },
      { $match: { participants: { $in: bindings.map((binding) => binding.subjectId) } } },
      { $group: { _id: "$participants", count: { $sum: 1 } } },
    ])
    : [];
  const relationCountBySubject = new Map(relationRows.map((row) => [id(row._id), Number(row.count || 0)]));
  return {
    results: bindings.map((binding) => ({
      subject: subjectById.get(id(binding.subjectId)) || null,
      subjectClassDefinitionIds: binding.subjectClassDefinitionIds || [],
      relationCount: relationCountBySubject.get(id(binding.subjectId)) || 0,
    })).filter((entry) => entry.subject),
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.ceil(total / normalizedLimit),
    },
    query: normalizedQuery,
  };
}

async function getSemanticGraphNeighborhood({ semanticGraphId, actorUserId, focusSubjectId = null, limit = 18 }) {
  const semanticGraph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  if (focusSubjectId) assertObjectId(focusSubjectId, "focusSubjectId");
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 18));
  if (!semanticGraph.workingRevisionId) {
    return {
      semanticGraph: projectSemanticGraphResource(semanticGraph),
      revision: null,
      effectiveNamespaceRevisionId: null,
      subjects: [],
      edges: [],
      neighborhood: { focusSubjectId: null, totalSubjects: 0, totalEdges: 0, totalNeighbors: 0, visibleNeighbors: 0, hiddenNeighbors: 0, limit: normalizedLimit },
    };
  }
  const revision = await SemanticGraphRevision.findOne({ _id: semanticGraph.workingRevisionId, semanticGraphId: semanticGraph._id }).lean();
  if (!revision) throw new AppError("Working SemanticGraphRevision non trovata", 409);
  const [totalSubjects, totalEdges] = await Promise.all([
    GraphSubjectBinding.countDocuments({ graphRevisionId: revision._id }),
    SemanticEdgeV2.countDocuments({ graphRevisionId: revision._id }),
  ]);
  if (!focusSubjectId) {
    return {
      semanticGraph: projectSemanticGraphResource(semanticGraph, { subjectCount: totalSubjects, relationCount: totalEdges }),
      revision: { id: revision._id, version: revision.version, basedOnRevisionId: revision.basedOnRevisionId || null, authoredAgainstNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId },
      effectiveNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId,
      subjects: [],
      edges: [],
      neighborhood: { focusSubjectId: null, totalSubjects, totalEdges, totalNeighbors: 0, visibleNeighbors: 0, hiddenNeighbors: 0, limit: normalizedLimit },
    };
  }
  const focusBinding = await GraphSubjectBinding.findOne({ graphRevisionId: revision._id, subjectId: focusSubjectId }).lean();
  if (!focusBinding) throw new AppError("Il Subject non appartiene al grafo", 404, [{ code: "GRAPH_SUBJECT_NOT_FOUND" }]);
  const incident = await SemanticEdgeV2.find({
    graphRevisionId: revision._id,
    $or: [{ sourceSubjectId: focusSubjectId }, { targetSubjectId: focusSubjectId }],
  }).sort({ _id: 1 }).lean();
  const neighborIds = [...new Set(incident.flatMap((edge) => [id(edge.sourceSubjectId), id(edge.targetSubjectId)]).filter((subjectId) => subjectId !== id(focusSubjectId)))];
  const visibleNeighborIds = neighborIds.slice(0, normalizedLimit);
  const visibleIds = [id(focusSubjectId), ...visibleNeighborIds];
  const [bindings, subjects] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId: revision._id, subjectId: { $in: visibleIds } }).lean(),
    Subject.find({ _id: { $in: visibleIds } }).select("preferredLabel description externalIdentities").lean(),
  ]);
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  const bindingById = new Map(bindings.map((binding) => [id(binding.subjectId), binding]));
  const visibleSet = new Set(visibleIds);
  const edges = incident.filter((edge) => visibleSet.has(id(edge.sourceSubjectId)) && visibleSet.has(id(edge.targetSubjectId)));
  return {
    semanticGraph: projectSemanticGraphResource(semanticGraph, { subjectCount: totalSubjects, relationCount: totalEdges }),
    revision: { id: revision._id, version: revision.version, basedOnRevisionId: revision.basedOnRevisionId || null, authoredAgainstNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId },
    effectiveNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId,
    subjects: visibleIds.map((subjectId) => ({
      subject: subjectById.get(subjectId) || null,
      subjectClassDefinitionIds: bindingById.get(subjectId)?.subjectClassDefinitionIds || [],
    })).filter((entry) => entry.subject),
    edges: edges.map((edge) => ({
      id: edge._id,
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance ?? null,
    })),
    neighborhood: {
      focusSubjectId,
      totalSubjects,
      totalEdges,
      totalNeighbors: neighborIds.length,
      visibleNeighbors: visibleNeighborIds.length,
      hiddenNeighbors: Math.max(0, neighborIds.length - visibleNeighborIds.length),
      limit: normalizedLimit,
    },
  };
}

module.exports = {
  findSemanticGraphResourceOrFail,
  assertCanReadSemanticGraph,
  assertCanEditSemanticGraph,
  resolveAuthoringNamespace,
  projectSemanticGraphResource,
  projectSemanticGraphSnapshot,
  listSemanticGraphs,
  getSemanticGraphResource,
  createSemanticGraphResource,
  updateSemanticGraphResource,
  forkSemanticGraphResource,
  trashSemanticGraphResource,
  restoreSemanticGraphResource,
  getSemanticGraphSnapshot,
  listSemanticGraphSubjects,
  getSemanticGraphNeighborhood,
};
