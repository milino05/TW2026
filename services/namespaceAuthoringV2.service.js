const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const AppError = require("../utils/AppError");
const { assertCanUseNamespaceForAuthoring } = require("./namespaceUsageAuthorization.service");

async function getNamespaceAuthoringControls({ namespaceId, actorUserId, principalType, principalId }) {
  const namespace = await Namespace.findById(namespaceId).lean();
  if (!namespace) throw new AppError("Namespace non disponibile", 404);
  const access = await assertCanUseNamespaceForAuthoring({
    namespace,
    actorUserId,
    principalType,
    principalId,
  });
  if (namespace.lifecycleStatus !== "active" && access.basis !== "entitlement") {
    throw new AppError("Namespace non disponibile", 404);
  }
  let revisionId = null;
  if (access.basis === "entitlement") {
    if (access.resolvedSnapshotRef?.resourceType !== "namespace_revision") {
      throw new AppError("Namespace autorizzato senza snapshot utilizzabile", 409, [{ code: "AUTHORIZED_NAMESPACE_REVISION_REQUIRED" }]);
    }
    revisionId = access.resolvedSnapshotRef.resourceId;
  } else {
    revisionId = namespace.workingRevisionId || namespace.publishedRevisionId;
  }
  if (!revisionId) throw new AppError("Namespace privo di revisione utilizzabile", 409);
  const revision = await NamespaceRevision.findOne({ _id: revisionId, namespaceId: namespace._id }).lean();
  if (!revision) throw new AppError("NamespaceRevision autorizzata non disponibile", 409);
  return {
    namespace: { id: namespace._id, name: namespace.name, description: namespace.description || "" },
    revision: { id: revision._id, version: revision.version },
    controls: {
      durationTypes: (revision.durationTypes || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
        targetSeconds: entry.targetSeconds,
      })),
      languageLevels: (revision.languageLevels || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
      presentationAspects: (revision.presentationAspects || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
      selectionSignals: (revision.selectionSignals || []).map((entry) => ({
        definitionId: entry.definitionId,
        label: entry.label,
        description: entry.description || "",
      })),
    },
  };
}

module.exports = { getNamespaceAuthoringControls };
