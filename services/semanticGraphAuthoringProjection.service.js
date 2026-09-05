const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const {
  getSemanticGraphResource,
  findSemanticGraphResourceOrFail,
  assertCanEditSemanticGraph,
} = require("./semanticGraphResource.service");

async function canEditGraph(graph, actorUserId) {
  try {
    await assertCanEditSemanticGraph(graph, actorUserId);
    return true;
  } catch (error) {
    if (error?.status === 403) return false;
    throw error;
  }
}

async function getSemanticGraphAuthoringProjection({ semanticGraphId, actorUserId }) {
  const resource = await getSemanticGraphResource({ semanticGraphId, actorUserId });
  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  if (!graph.workingRevisionId) {
    throw new AppError("Il grafo semantico non ha una revisione di lavoro", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_REQUIRED" }]);
  }

  const graphRevision = await SemanticGraphRevision.findOne({
    _id: graph.workingRevisionId,
    semanticGraphId: graph._id,
  }).lean();
  if (!graphRevision) {
    throw new AppError("La revisione di lavoro del grafo non è disponibile", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_NOT_AVAILABLE" }]);
  }

  const namespaceRevision = await NamespaceRevision.findOne({
    _id: graphRevision.authoredAgainstNamespaceRevisionId,
    namespaceId: graph.namespaceId,
  }).lean();
  if (!namespaceRevision) {
    throw new AppError("La revisione delle regole editoriali usata dal grafo non è disponibile", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_REVISION_NOT_AVAILABLE" }]);
  }

  return {
    ...resource,
    workingRevision: {
      id: graphRevision._id,
      version: graphRevision.version,
      basedOnRevisionId: graphRevision.basedOnRevisionId || null,
      authoredAgainstNamespaceRevisionId: graphRevision.authoredAgainstNamespaceRevisionId,
    },
    namespaceRevision: {
      id: namespaceRevision._id,
      version: namespaceRevision.version,
      status: namespaceRevision.status,
      subjectClasses: namespaceRevision.subjectClasses || [],
      relationTypes: namespaceRevision.relationTypes || [],
    },
    permissions: {
      canEdit: await canEditGraph(graph, actorUserId),
    },
  };
}

module.exports = { getSemanticGraphAuthoringProjection };
