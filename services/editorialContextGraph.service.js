const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { findEditorialContextOrFail } = require("./editorialContext.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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
      presentationCoverage: coverageBySubject.get(id(node.subject?._id)) || { collectionItemCount: 0, contentSpaceItemCount: 0, artaroundItemCount: 0 },
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
  const result = new Map(ids.map((subjectId) => [subjectId, { collectionItemCount: 0, contentSpaceItemCount: 0, artaroundItemCount: 0 }]));
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

async function candidateSubjectIds({ context, scope }) {
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
  if (!["collection", "space"].includes(scope)) throw new AppError("scope deve essere collection o space", 400);
  const context = await findEditorialContextOrFail({ editorialContextId });
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const normalizedQuery = String(q || "").trim().slice(0, 160);
  const subjectIds = await candidateSubjectIds({ context, scope });
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
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" }).select("workingRevisionId").lean();
  const graphBindings = semanticGraph?.workingRevisionId && subjects.length
    ? await GraphSubjectBinding.find({ graphRevisionId: semanticGraph.workingRevisionId, subjectId: { $in: subjects.map((entry) => entry._id) } }).select("subjectId").lean()
    : [];
  const graphSubjectIds = new Set(graphBindings.map((entry) => id(entry.subjectId)));
  return {
    results: subjects.map((subject) => ({
      subject,
      inGraph: graphSubjectIds.has(id(subject._id)),
      presentationCoverage: coverageBySubject.get(id(subject._id)) || { collectionItemCount: 0, contentSpaceItemCount: 0, artaroundItemCount: 0 },
    })),
    pagination: { page: normalizedPage, limit: normalizedLimit, total, totalPages: Math.ceil(total / normalizedLimit) },
    query: normalizedQuery,
    scope,
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

module.exports = { projectGraph, getEditorialContextGraph, projectCollectionSubjects, projectPresentationCoverage, searchEditorialGraphSubjectCandidates };
