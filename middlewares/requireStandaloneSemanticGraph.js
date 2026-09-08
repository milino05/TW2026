const EditorialContext = require("../models/editorialContext.model");
const AppError = require("../utils/AppError");

async function requireStandaloneSemanticGraph(req, _res, next) {
  try {
    const context = await EditorialContext.findOne({ semanticGraphId: req.params.semanticGraphId })
      .select("_id lifecycleStatus")
      .lean();
    if (context) {
      throw new AppError("Il grafo appartiene a una Raccolta e deve essere modificato dal suo contesto editoriale", 409, [{
        code: "SEMANTIC_GRAPH_COLLECTION_BOUND_USE_CONTEXT_API",
        context: {
          editorialContextId: context._id,
          editorialContextLifecycleStatus: context.lifecycleStatus,
        },
      }]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireStandaloneSemanticGraph };
