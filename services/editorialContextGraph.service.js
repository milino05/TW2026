const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { findEditorialContextOrFail } = require("./editorialContext.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

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

module.exports = { projectGraph, getEditorialContextGraph, projectCollectionSubjects, projectPresentationCoverage };
