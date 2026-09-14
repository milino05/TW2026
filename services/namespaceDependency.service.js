const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { effectiveRevisionId, assertDependencyReady } = require("./versionedSchemaDependency.service");

function id(value) { return String(value?._id || value || ""); }

async function loadEffectiveNamespaceRevision({
  namespace,
  binding,
  requireStable = true,
  requireValidatedConsumer = false,
  consumerSnapshotId = null,
}) {
  if (!namespace) throw new AppError("Namespace non disponibile", 409, [{ code: "NAMESPACE_NOT_AVAILABLE" }]);
  const revisionId = effectiveRevisionId({
    binding,
    publishedRevisionId: namespace.publishedRevisionId,
  });
  const query = { _id: revisionId, namespaceId: namespace._id };
  if (requireStable) {
    query.status = { $in: ["published", "superseded"] };
    query["integrity.status"] = "valid";
  }
  const revision = await NamespaceRevision.findOne(query);
  if (!revision) {
    throw new AppError("NamespaceRevision effettiva non disponibile", 409, [{
      code: "EFFECTIVE_NAMESPACE_REVISION_UNAVAILABLE",
      context: { namespaceId: namespace._id, revisionId },
    }]);
  }
  if (id(revision.namespaceId) !== id(namespace._id)) {
    throw new AppError("NamespaceRevision effettiva fuori lineage", 409, [{ code: "NAMESPACE_REVISION_LINEAGE_MISMATCH" }]);
  }
  if (requireValidatedConsumer) {
    assertDependencyReady({
      binding,
      consumerSnapshotId,
      dependencyRevisionId: revision._id,
      codePrefix: "NAMESPACE_DEPENDENCY",
      field: "namespaceDependency",
    });
  }
  return revision;
}

module.exports = { loadEffectiveNamespaceRevision };
