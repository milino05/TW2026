const mongoose = require("mongoose");
const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { findEditorialContextOrFail } = require("./editorialContext.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normalizedLimit(value, fallback = 12, max = 50) { return Math.max(1, Math.min(max, Number(value) || fallback)); }
function emptyCoverage() { return { collectionItemCount: 0, contentSpaceItemCount: 0, artaroundItemCount: 0 }; }

function projectGraph(graph, { semanticGraph = null, coverageBySubject = new Map() } = {}) {
  return {
    semanticGraph: semanticGraph ? {
      id: semanticGraph._id,
      name: semanticGraph.displayName,
      workingVersion: Number(semanticGraph.workingVersion || 0),
      workingRevisionId: semanticGraph.workingRevisionId || null,
    } : null,
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
      presentationCoverage: coverageBySubject.get(id(node.subject?._id)) || emptyCoverage(),
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

function projectGraphRoot(semanticGraph, revision = null, effectiveNamespaceRevisionId = null) {
  return {
    semanticGraph: semanticGraph ? {
      id: semanticGraph._id,
      name: semanticGraph.displayName,
      workingVersion: Number(semanticGraph.workingVersion || 0),
      workingRevisionId: semanticGraph.workingRevisionId || null,
    } : null,
    revision: revision ? {
      id: revision._id,
      version: revision.version,
      basedOnRevisionId: revision.basedOnRevisionId || null,
      authoredAgainstNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId,
    } : null,
    effectiveNamespaceRevisionId: effectiveNamespaceRevisionId || null,
  };
}

async function projectCollectionSubjects(editorialContextId) {
  const entries = await EditorialContextEntry.find({ editorialContextId }).select("itemEditionId").lean();
  if (!entries.length) return [];
  const editions = await ItemEdition.find({ _id: { $in: entries.map((entry) => entry.itemEditionId) } }).select("itemId").lean();
  const items = editions.length
    ? await ItemV2.find({ _id: { $in: editions.map((edition) => edition.itemId) }, lifecycleStatus: "active" }).select("primarySubjectId").lean()
    : [];
  const subjectIds = [...new Set(items.map((item) => id(item.primarySubjectId)).filter(Boolean))];
  if (!subjectIds.length) return [];
  const subjects = await Subject.find({ _id: { $in: subjectIds } }).select("preferredLabel description externalIdentities").lean();
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  return subjectIds.map((subjectId) => subjectById.get(subjectId)).filter(Boolean);
}

async function projectPresentationCoverage({ editorialContextId, contentSpaceId, subjectIds }) {
  const ids = [...new Set((subjectIds || []).map(id).filter(Boolean))];
  const result = new Map(ids.map((subjectId) => [subjectId, emptyCoverage()]));
  if (!ids.length) return result;

  const allItems = await ItemV2.find({ primarySubjectId: { $in: ids }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean();
  const itemById = new Map(allItems.map((item) => [id(item._id), item]));
  for (const item of allItems) result.get(id(item.primarySubjectId)).artaroundItemCount += 1;

  const spaceMemberships = allItems.length
    ? await ContentSpaceMembership.find({ contentSpaceId, itemId: { $in: allItems.map((item) => item._id) } }).select("itemId").lean()
    : [];
  for (const membership of spaceMemberships) {
    const item = itemById.get(id(membership.itemId));
    if (item) result.get(id(item.primarySubjectId)).contentSpaceItemCount += 1;
  }

  const entries = await EditorialContextEntry.find({ editorialContextId }).select("itemEditionId").lean();
  const editions = entries.length
    ? await ItemEdition.find({ _id: { $in: entries.map((entry) => entry.itemEditionId) } }).select("itemId").lean()
    : [];
  for (const edition of editions) {
    const item = itemById.get(id(edition.itemId));
    if (item) result.get(id(item.primarySubjectId)).collectionItemCount += 1;
  }
  return result;
}

async function projectRelationCounts({ graphRevisionId, subjectIds }) {
  const ids = [...new Set((subjectIds || []).map(id).filter(Boolean))];
  const result = new Map(ids.map((subjectId) => [subjectId, 0]));
  if (!graphRevisionId || !ids.length) return result;
  const objectIds = ids.map((value) => new mongoose.Types.ObjectId(value));
  const rows = await SemanticEdgeV2.aggregate([
    {
      $match: {
        graphRevisionId: new mongoose.Types.ObjectId(id(graphRevisionId)),
        $or: [
          { sourceSubjectId: { $in: objectIds } },
          { targetSubjectId: { $in: objectIds } },
        ],
      },
    },
    { $project: { participants: { $setUnion: [["$sourceSubjectId"], ["$targetSubjectId"]] } } },
    { $unwind: "$participants" },
    { $match: { participants: { $in: objectIds } } },
    { $group: { _id: "$participants", count: { $sum: 1 } } },
  ]);
  for (const row of rows) result.set(id(row._id), Number(row.count || 0));
  return result;
}

async function candidateSubjectIds({ context, scope, semanticGraph = null }) {
  if (scope === "graph") {
    const graph = semanticGraph || await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).select("workingRevisionId").lean();
    if (!graph?.workingRevisionId) return [];
    const bindings = await GraphSubjectBinding.find({ graphRevisionId: graph.workingRevisionId }).select("subjectId").lean();
    return [...new Set(bindings.map((entry) => id(entry.subjectId)).filter(Boolean))];
  }
  if (scope === "collection") {
    const entries = await EditorialContextEntry.find({ editorialContextId: context._id }).select("itemEditionId").lean();
    if (!entries.length) return [];
    const editions = await ItemEdition.find({ _id: { $in: entries.map((entry) => entry.itemEditionId) } }).select("itemId").lean();
    if (!editions.length) return [];
    const items = await ItemV2.find({ _id: { $in: editions.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("primarySubjectId").lean();
    return [...new Set(items.map((entry) => id(entry.primarySubjectId)).filter(Boolean))];
  }
  const memberships = await ContentSpaceMembership.find({ contentSpaceId: context.contentSpaceId }).select("itemId").lean();
  if (!memberships.length) return [];
  const items = await ItemV2.find({ _id: { $in: memberships.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("primarySubjectId").lean();
  return [...new Set(items.map((entry) => id(entry.primarySubjectId)).filter(Boolean))];
}

async function searchEditorialGraphSubjectCandidates({ editorialContextId, actorUserId, scope = "collection", q = "", page = 1, limit = 12 }) {
  if (!["graph", "collection", "space"].includes(scope)) throw new AppError("scope deve essere graph, collection o space", 400);
  const context = await findEditorialContextOrFail({ editorialContextId });
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = normalizedLimitValue(limit);
  const normalizedQuery = String(q || "").trim().slice(0, 160);
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).select("workingRevisionId").lean();
  const subjectIds = await candidateSubjectIds({ context, scope, semanticGraph });
  if (!subjectIds.length) return { results: [], pagination: { page: normalizedPage, limit: normalizedLimit, total: 0, totalPages: 0 }, query: normalizedQuery, scope };
  const query = { _id: { $in: subjectIds } };
  if (normalizedQuery) {
    const pattern = new RegExp(escapeRegex(normalizedQuery), "i");
    query.$or = [{ preferredLabel: pattern }, { description: pattern }];
  }
  const [total, subjects] = await Promise.all([
    Subject.countDocuments(query),
    Subject.find(query)
      .select("preferredLabel description externalIdentities")
      .sort({ preferredLabel: 1, _id: 1 })
      .skip((normalizedPage - 1) * normalizedLimit)
      .limit(normalizedLimit)
      .lean(),
  ]);
  const coverageBySubject = await projectPresentationCoverage({ editorialContextId: context._id, contentSpaceId: contentSpace._id, subjectIds: subjects.map((entry) => entry._id) });
  const graphBindings = semanticGraph?.workingRevisionId && subjects.length
    ? await GraphSubjectBinding.find({ graphRevisionId: semanticGraph.workingRevisionId, subjectId: { $in: subjects.map((entry) => entry._id) } }).select("subjectId subjectClassDefinitionIds").lean()
    : [];
  const bindingBySubjectId = new Map(graphBindings.map((entry) => [id(entry.subjectId), entry]));
  const relationCounts = await projectRelationCounts({ graphRevisionId: semanticGraph?.workingRevisionId || null, subjectIds: subjects.map((entry) => entry._id) });
  return {
    results: subjects.map((subject) => ({
      subject,
      inGraph: bindingBySubjectId.has(id(subject._id)),
      subjectClassDefinitionIds: bindingBySubjectId.get(id(subject._id))?.subjectClassDefinitionIds || [],
      relationCount: relationCounts.get(id(subject._id)) || 0,
      presentationCoverage: coverageBySubject.get(id(subject._id)) || emptyCoverage(),
    })),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
    scope,
  };
}

function normalizedLimitValue(value) { return normalizedLimit(value, 12, 50); }

async function resolveGraphRevisionForView({ context, semanticGraph, view }) {
  if (view === "working") {
    if (!semanticGraph.workingRevisionId) return { revision: null, effectiveNamespaceRevisionId: null, release: null };
    const revision = await SemanticGraphRevision.findOne({ _id: semanticGraph.workingRevisionId, semanticGraphId: semanticGraph._id }).lean();
    if (!revision) throw new AppError("Working SemanticGraphRevision non trovata", 409);
    return { revision, effectiveNamespaceRevisionId: revision.authoredAgainstNamespaceRevisionId, release: null };
  }
  if (!context.publishedReleaseId) return { revision: null, effectiveNamespaceRevisionId: null, release: null };
  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id }).lean();
  if (!release) throw new AppError("Published EditorialRelease non trovata", 409);
  const revision = await SemanticGraphRevision.findOne({ _id: release.graphRevisionId, semanticGraphId: semanticGraph._id }).lean();
  if (!revision) throw new AppError("SemanticGraphRevision pubblicata non trovata", 409);
  return { revision, effectiveNamespaceRevisionId: release.namespaceRevisionId, release };
}

async function getEditorialContextGraphNeighborhood({ editorialContextId, view = "working", actorUserId, focusSubjectId = null, limit = 18 }) {
  if (!["working", "published"].includes(view)) throw new AppError("view deve essere working o published", 400);
  if (focusSubjectId && !mongoose.isValidObjectId(focusSubjectId)) throw new AppError("focusSubjectId non valido", 400, [{ field: "focusSubjectId", code: "INVALID_OBJECT_ID" }]);
  const context = await findEditorialContextOrFail({ editorialContextId });
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).lean();
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 409);
  const { revision, effectiveNamespaceRevisionId } = await resolveGraphRevisionForView({ context, semanticGraph, view });
  const maxNeighbors = normalizedLimit(limit, 18, 100);
  if (!revision) {
    return {
      ...projectGraphRoot(semanticGraph),
      subjects: [],
      edges: [],
      neighborhood: { focusSubjectId: null, totalSubjects: 0, totalEdges: 0, totalNeighbors: 0, visibleNeighbors: 0, hiddenNeighbors: 0, limit: maxNeighbors },
    };
  }

  const [totalSubjects, totalEdges] = await Promise.all([
    GraphSubjectBinding.countDocuments({ graphRevisionId: revision._id }),
    SemanticEdgeV2.countDocuments({ graphRevisionId: revision._id }),
  ]);
  if (!focusSubjectId) {
    return {
      ...projectGraphRoot(semanticGraph, revision, effectiveNamespaceRevisionId),
      subjects: [],
      edges: [],
      neighborhood: { focusSubjectId: null, totalSubjects, totalEdges, totalNeighbors: 0, visibleNeighbors: 0, hiddenNeighbors: 0, limit: maxNeighbors },
    };
  }

  const focusBinding = await GraphSubjectBinding.findOne({ graphRevisionId: revision._id, subjectId: focusSubjectId }).lean();
  if (!focusBinding) throw new AppError("Il soggetto di contesto non appartiene a questa revisione del grafo", 404, [{ code: "GRAPH_SUBJECT_NOT_FOUND" }]);
  const incidentEdges = await SemanticEdgeV2.find({
    graphRevisionId: revision._id,
    $or: [{ sourceSubjectId: focusSubjectId }, { targetSubjectId: focusSubjectId }],
  }).lean();
  const focusId = id(focusSubjectId);
  const neighborIds = [...new Set(incidentEdges.map((edge) => id(edge.sourceSubjectId) === focusId ? id(edge.targetSubjectId) : id(edge.sourceSubjectId)).filter(Boolean))];
  const allSubjectIds = [focusId, ...neighborIds];
  const allSubjects = await Subject.find({ _id: { $in: allSubjectIds } }).select("preferredLabel description externalIdentities").lean();
  const subjectById = new Map(allSubjects.map((subject) => [id(subject._id), subject]));
  neighborIds.sort((left, right) => String(subjectById.get(left)?.preferredLabel || "").localeCompare(String(subjectById.get(right)?.preferredLabel || ""), "it"));
  const visibleNeighborIds = neighborIds.slice(0, maxNeighbors);
  const visibleSet = new Set(visibleNeighborIds);
  const nodeIds = [focusId, ...visibleNeighborIds];
  const bindings = await GraphSubjectBinding.find({ graphRevisionId: revision._id, subjectId: { $in: nodeIds } }).lean();
  const bindingBySubjectId = new Map(bindings.map((binding) => [id(binding.subjectId), binding]));
  const [coverageBySubject, relationCounts] = await Promise.all([
    projectPresentationCoverage({ editorialContextId: context._id, contentSpaceId: contentSpace._id, subjectIds: nodeIds }),
    projectRelationCounts({ graphRevisionId: revision._id, subjectIds: nodeIds }),
  ]);
  const subjects = nodeIds.map((subjectId) => {
    const subject = subjectById.get(subjectId);
    if (!subject) return null;
    return {
      subject,
      subjectClassDefinitionIds: bindingBySubjectId.get(subjectId)?.subjectClassDefinitionIds || [],
      relationCount: relationCounts.get(subjectId) || 0,
      presentationCoverage: coverageBySubject.get(subjectId) || emptyCoverage(),
    };
  }).filter(Boolean);
  const edges = incidentEdges
    .filter((edge) => visibleSet.has(id(edge.sourceSubjectId) === focusId ? id(edge.targetSubjectId) : id(edge.sourceSubjectId)))
    .map((edge) => ({
      id: edge._id,
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance ?? null,
    }));
  return {
    ...projectGraphRoot(semanticGraph, revision, effectiveNamespaceRevisionId),
    subjects,
    edges,
    neighborhood: {
      focusSubjectId,
      totalSubjects,
      totalEdges,
      totalNeighbors: neighborIds.length,
      visibleNeighbors: visibleNeighborIds.length,
      hiddenNeighbors: Math.max(0, neighborIds.length - visibleNeighborIds.length),
      limit: maxNeighbors,
    },
  };
}

async function getEditorialContextGraph({ editorialContextId, view = "working", actorUserId }) {
  if (!["working", "published"].includes(view)) throw new AppError("view deve essere working o published", 400);
  const context = await findEditorialContextOrFail({ editorialContextId });
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).lean();
  if (!semanticGraph) throw new AppError("Grafo semantico non disponibile", 409);

  if (view === "working") {
    const graph = semanticGraph.workingRevisionId ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId) : null;
    const graphSubjectIds = graph ? [...graph.nodes.keys()] : [];
    const [suggestedSubjects, coverageBySubject] = await Promise.all([
      projectCollectionSubjects(context._id),
      projectPresentationCoverage({ editorialContextId: context._id, contentSpaceId: contentSpace._id, subjectIds: graphSubjectIds }),
    ]);
    return { ...projectGraph(graph, { semanticGraph, coverageBySubject }), suggestedSubjects, availableSubjects: suggestedSubjects };
  }
  if (!context.publishedReleaseId) return { ...projectGraph(null, { semanticGraph }), suggestedSubjects: [], availableSubjects: [] };
  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id }).lean();
  if (!release) throw new AppError("Published EditorialRelease non trovata", 409);
  const graph = await loadSemanticGraphRevision(release.graphRevisionId, { namespaceRevisionId: release.namespaceRevisionId });
  const coverageBySubject = await projectPresentationCoverage({ editorialContextId: context._id, contentSpaceId: contentSpace._id, subjectIds: [...graph.nodes.keys()] });
  return { ...projectGraph(graph, { semanticGraph, coverageBySubject }), suggestedSubjects: [], availableSubjects: [] };
}

module.exports = {
  projectGraph,
  getEditorialContextGraph,
  getEditorialContextGraphNeighborhood,
  projectCollectionSubjects,
  projectPresentationCoverage,
  searchEditorialGraphSubjectCandidates,
};
