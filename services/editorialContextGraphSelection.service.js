const EditorialContext = require("../models/editorialContext.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const AppError = require("../utils/AppError");
const { findEditorialContextOrFail, loadContextDependencies, assertContextWorkingStateEditable } = require("./editorialContext.service");
const { assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { findSemanticGraphResourceOrFail } = require("./semanticGraphResource.service");
const { projectEditorialContext } = require("./editorialContextProjection.service");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function workingConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}

async function changeEditorialContextSemanticGraph({ editorialContextId, semanticGraphId, actorUserId }) {
  const context = await findEditorialContextOrFail({ editorialContextId });
  const { contentSpace, namespace } = await loadContextDependencies(context);
  await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.edit");
  assertContextWorkingStateEditable(context);

  const graph = await findSemanticGraphResourceOrFail({ semanticGraphId, actorUserId });
  if (graph.ownerType !== contentSpace.ownerType || !sameId(graph.ownerId, contentSpace.ownerId)) {
    throw new AppError("Il grafo semantico non appartiene all'area di lavoro della raccolta", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
  }
  if (!sameId(graph.namespaceId, context.namespaceId)) {
    throw new AppError("Il grafo semantico usa regole editoriali diverse dalla raccolta", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
  }
  if (!graph.workingRevisionId) {
    throw new AppError("Il grafo semantico non ha una revisione di lavoro", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_REQUIRED" }]);
  }
  const workingRevision = await SemanticGraphRevision.findOne({
    _id: graph.workingRevisionId,
    semanticGraphId: graph._id,
  }).select("authoredAgainstNamespaceRevisionId").lean();
  if (!workingRevision) {
    throw new AppError("La revisione di lavoro del grafo non è disponibile", 409, [{ code: "SEMANTIC_GRAPH_WORKING_REVISION_NOT_FOUND" }]);
  }
  await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: contentSpace.ownerType,
    principalId: contentSpace.ownerId,
  });

  if (sameId(context.semanticGraphId, graph._id)) {
    return {
      editorialContext: await projectEditorialContext({ editorialContext: context, contentSpace, namespace }),
      semanticGraph: {
        id: graph._id,
        name: graph.displayName,
        description: graph.description || "",
        workingRevisionId: graph.workingRevisionId,
        workingVersion: Number(graph.workingVersion || 0),
      },
      changed: false,
    };
  }

  const updated = await EditorialContext.findOneAndUpdate({
    _id: context._id,
    lifecycleStatus: "active",
    activeReviewRevisionId: null,
    workingVersion: Number(context.workingVersion || 0),
    semanticGraphId: context.semanticGraphId,
  }, {
    $set: { semanticGraphId: graph._id },
    $inc: { workingVersion: 1 },
  }, { new: true });
  if (!updated) throw workingConflict();

  return {
    editorialContext: await projectEditorialContext({ editorialContext: updated, contentSpace, namespace }),
    semanticGraph: {
      id: graph._id,
      name: graph.displayName,
      description: graph.description || "",
      workingRevisionId: graph.workingRevisionId,
      workingVersion: Number(graph.workingVersion || 0),
    },
    previousSemanticGraphId: context.semanticGraphId,
    changed: true,
  };
}

module.exports = { changeEditorialContextSemanticGraph };
