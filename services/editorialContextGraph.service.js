const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContextEntry = require("../models/editorialContextEntry.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const { findEditorialContextOrFail } = require("./editorialContext.service");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function projectGraph(graph) {
  return {
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

async function getEditorialContextGraph({ editorialContextId, view = "working", actorUserId }) {
  if (!["working", "published"].includes(view)) throw new AppError("view deve essere working o published", 400);
  const context = await findEditorialContextOrFail({ editorialContextId });
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");

  if (view === "working") {
    const [graph, availableSubjects] = await Promise.all([
      context.workingGraphRevisionId ? loadSemanticGraphRevision(context.workingGraphRevisionId) : null,
      projectCollectionSubjects(context._id),
    ]);
    return { ...projectGraph(graph), availableSubjects };
  }
  if (!context.publishedReleaseId) return { ...projectGraph(null), availableSubjects: [] };
  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id }).lean();
  if (!release) throw new AppError("Published EditorialRelease non trovata", 409);
  const graph = await loadSemanticGraphRevision(release.graphRevisionId, { namespaceRevisionId: release.namespaceRevisionId });
  return { ...projectGraph(graph), availableSubjects: [] };
}

module.exports = { projectGraph, getEditorialContextGraph, projectCollectionSubjects };
