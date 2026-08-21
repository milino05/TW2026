const User = require("../models/user");
const Organization = require("../models/organization.model");
const EditorialRelease = require("../models/editorialRelease.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");

function buildEditorialContextSummary({ editorialContext, contentSpace, namespace, curator, stats = { availableItemCount: 0, subjectCount: 0 } }) {
  return {
    id: editorialContext._id,
    name: editorialContext.displayName,
    shortDescription: editorialContext.shortDescription ?? null,
    contentSpace: { id: contentSpace._id, name: contentSpace.name },
    namespace: { id: namespace._id, name: namespace.name },
    curator,
    stats,
  };
}

async function resolveCurator(contentSpace) {
  if (contentSpace.ownerType === "organization") {
    const organization = await Organization.findById(contentSpace.ownerId).select("name").lean();
    return { id: contentSpace.ownerId, displayName: organization?.name || "Organizzazione" };
  }
  const user = await User.findById(contentSpace.ownerId).select("username").lean();
  return { id: contentSpace.ownerId, displayName: user?.username || "Utente" };
}

async function resolvePublishedStats(editorialContext) {
  if (!editorialContext.publishedReleaseId) return { availableItemCount: 0, subjectCount: 0 };
  const release = await EditorialRelease.findById(editorialContext.publishedReleaseId).select("graphRevisionId itemBindings").lean();
  if (!release) return { availableItemCount: 0, subjectCount: 0 };
  const [bindings, edges] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId: release.graphRevisionId }).select("subjectId").lean(),
    SemanticEdgeV2.find({ graphRevisionId: release.graphRevisionId }).select("sourceSubjectId targetSubjectId").lean(),
  ]);
  const subjectIds = new Set(bindings.map((binding) => String(binding.subjectId)));
  edges.forEach((edge) => { subjectIds.add(String(edge.sourceSubjectId)); subjectIds.add(String(edge.targetSubjectId)); });
  return { availableItemCount: release.itemBindings.length, subjectCount: subjectIds.size };
}

async function projectEditorialContext({ editorialContext, contentSpace, namespace }) {
  const [curator, stats] = await Promise.all([resolveCurator(contentSpace), resolvePublishedStats(editorialContext)]);
  return buildEditorialContextSummary({ editorialContext, contentSpace, namespace, curator, stats });
}

module.exports = { buildEditorialContextSummary, resolvePublishedStats, projectEditorialContext };
