const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const Namespace = require("../models/namespace.model");
const AppError = require("../utils/AppError");
const { loadEffectiveNamespaceRevision } = require("./namespaceDependency.service");
const { projectDependencyState } = require("./versionedSchemaDependency.service");
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

  const namespace = await Namespace.findOne({ _id: graph.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) {
    throw new AppError("Le regole editoriali del grafo non sono disponibili", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_NOT_AVAILABLE" }]);
  }
  const namespaceRevision = await loadEffectiveNamespaceRevision({
    namespace,
    binding: graph.namespaceDependency,
  });

  return {
    ...resource,
    namespaceDependency: projectDependencyState(graph.namespaceDependency),
    workingRevision: {
      id: graphRevision._id,
      version: graphRevision.version,
      basedOnRevisionId: graphRevision.basedOnRevisionId || null,
      authoredAgainstNamespaceRevisionId: graphRevision.authoredAgainstNamespaceRevisionId,
    },
    effectiveNamespaceRevisionId: namespaceRevision._id,
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
