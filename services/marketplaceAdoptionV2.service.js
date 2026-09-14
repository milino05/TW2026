const { Adoption, ADOPTION_ACTIONS } = require("../models/adoption.model");
const EditorialContext = require("../models/editorialContext.model");
const ItemEdition = require("../models/itemEdition.model");
const SemanticGraph = require("../models/semanticGraph.model");
const AppError = require("../utils/AppError");
const { bindingFromAccess } = require("./versionedSchemaDependency.service");

function sameRef(a, b) {
  return Boolean(a && b)
    && a.resourceType === b.resourceType
    && String(a.resourceId || "") === String(b.resourceId || "");
}

async function syncNamespaceDependencyBinding({ access, sourceResourceRef, sourceSnapshotRef, resultResourceRef, session = null }) {
  if (sourceResourceRef?.resourceType !== "namespace" || sourceSnapshotRef?.resourceType !== "namespace_revision") return;
  const target = resultResourceRef;
  if (!target?.resourceId) return;
  const binding = bindingFromAccess({ access, effectiveRevisionId: sourceSnapshotRef.resourceId });
  const options = session ? { session } : undefined;
  if (target.resourceType === "item_edition") {
    await ItemEdition.updateOne({ _id: target.resourceId }, { $set: { namespaceDependency: binding } }, options);
    return;
  }
  if (target.resourceType === "semantic_graph") {
    await SemanticGraph.updateOne({ _id: target.resourceId }, { $set: { namespaceDependency: binding } }, options);
    return;
  }
  if (target.resourceType === "editorial_context") {
    const context = await EditorialContext.findById(target.resourceId).select("semanticGraphId").session(session || null).lean();
    if (!context) return;
    await EditorialContext.updateOne({ _id: target.resourceId }, { $set: { namespaceDependency: binding } }, options);
    if (context.semanticGraphId) {
      await SemanticGraph.updateOne({ _id: context.semanticGraphId }, { $set: { namespaceDependency: binding } }, options);
    }
  }
}

async function recordAdoptionFromAccess({
  access,
  actorUserId,
  action,
  sourceResourceRef = null,
  sourceSnapshotRef = null,
  targetResourceRef = null,
  resultResourceRef = null,
  session = null,
}) {
  if (access?.basis !== "entitlement" || !access.entitlement) return null;
  if (!ADOPTION_ACTIONS.includes(action)) {
    throw new AppError("Azione Adoption non supportata", 500, [{ code: "INVALID_ADOPTION_ACTION", action }]);
  }
  const resolvedSource = sourceResourceRef || access.requestedResourceRef;
  const resolvedSnapshot = sourceSnapshotRef || access.resolvedSnapshotRef || access.entitlement.baselineSnapshotRef;
  if (!resolvedSource || !resolvedSnapshot) {
    throw new AppError("Adoption senza sorgente risolvibile", 500, [{ code: "ADOPTION_SOURCE_REQUIRED" }]);
  }
  if (access.resolvedSnapshotRef && !sameRef(resolvedSnapshot, access.resolvedSnapshotRef)) {
    throw new AppError("Adoption non coerente con la snapshot autorizzata", 500, [{ code: "ADOPTION_SNAPSHOT_MISMATCH" }]);
  }
  const [adoption] = await Adoption.create([{
    beneficiaryType: access.entitlement.beneficiaryType,
    beneficiaryId: access.entitlement.beneficiaryId,
    entitlementId: access.entitlement._id,
    sourceResourceRef: resolvedSource,
    sourceSnapshotRef: resolvedSnapshot,
    action,
    targetResourceRef,
    resultResourceRef,
    adoptedBy: actorUserId,
  }], session ? { session } : undefined);
  try {
    await syncNamespaceDependencyBinding({
      access,
      sourceResourceRef: resolvedSource,
      sourceSnapshotRef: resolvedSnapshot,
      resultResourceRef,
      session,
    });
    return adoption;
  } catch (error) {
    if (!session) await Adoption.deleteOne({ _id: adoption._id }).catch(() => {});
    throw error;
  }
}

async function deleteAdoptions(adoptionIds = []) {
  const ids = (adoptionIds || []).filter(Boolean);
  if (!ids.length) return;
  await Adoption.deleteMany({ _id: { $in: ids } });
}

module.exports = { recordAdoptionFromAccess, deleteAdoptions };
