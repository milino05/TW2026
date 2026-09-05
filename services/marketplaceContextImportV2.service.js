const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const CollectionSubjectMembership = require("../models/collectionSubjectMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const AppError = require("../utils/AppError");
const { assertCanActForPrincipal } = require("./principalResolution.service");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");
const { assertCanUseNamespaceForEditorialContext } = require("./namespaceUsageAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");

function sameId(a, b) { return String(a || "") === String(b || ""); }
function id(value) { return String(value?._id || value || ""); }

async function importEditorialContextSnapshot({
  sourceEditorialContextId,
  ownerType,
  ownerId,
  actorUserId,
  contentSpaceName = null,
  displayName = null,
}) {
  await assertCanActForPrincipal({ actorUserId, principalType: ownerType, principalId: ownerId });

  const sourceContext = await EditorialContext.findOne({ _id: sourceEditorialContextId, lifecycleStatus: "active" }).lean();
  if (!sourceContext) throw new AppError("EditorialContext sorgente non disponibile", 404);
  const contextAccess = await assertCapabilitySource({
    actorUserId,
    capability: "context.import_snapshot",
    resourceType: "editorial_context",
    resourceId: sourceContext._id,
    principalType: ownerType,
    principalId: ownerId,
  });
  const sourceReleaseRef = contextAccess.resolvedSnapshotRef;
  if (sourceReleaseRef?.resourceType !== "editorial_release") {
    throw new AppError("Import senza EditorialRelease autorizzata", 409, [{ code: "AUTHORIZED_EDITORIAL_RELEASE_REQUIRED" }]);
  }
  const sourceRelease = await EditorialRelease.findOne({
    _id: sourceReleaseRef.resourceId,
    editorialContextId: sourceContext._id,
  }).lean();
  if (!sourceRelease) throw new AppError("EditorialRelease sorgente autorizzata non disponibile", 409);

  const namespace = await Namespace.findOne({ _id: sourceContext.namespaceId, lifecycleStatus: "active" });
  if (!namespace) throw new AppError("Namespace sorgente non disponibile", 409);
  const namespaceAccess = await assertCanUseNamespaceForEditorialContext({
    namespace,
    actorUserId,
    principalType: ownerType,
    principalId: ownerId,
  });
  if (namespaceAccess?.basis === "entitlement") {
    const ref = namespaceAccess.resolvedSnapshotRef;
    if (ref?.resourceType !== "namespace_revision" || !sameId(ref.resourceId, sourceRelease.namespaceRevisionId)) {
      throw new AppError("Il Namespace autorizzato non copre la release importata", 403, [{
        code: "NAMESPACE_REVISION_NOT_AUTHORIZED",
        context: { requiredNamespaceRevisionId: sourceRelease.namespaceRevisionId, authorizedRevisionId: ref?.resourceId || null },
      }]);
    }
  }

  const sourceGraphRevision = await SemanticGraphRevision.findById(sourceRelease.graphRevisionId).lean();
  if (!sourceGraphRevision) throw new AppError("GraphRevision sorgente non disponibile", 409);
  const [sourceBindings, sourceEdges] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId: sourceGraphRevision._id }).lean(),
    SemanticEdgeV2.find({ graphRevisionId: sourceGraphRevision._id }).lean(),
  ]);
  const subjectIds = [...new Set((sourceRelease.subjectIds || []).map(id).filter(Boolean))];
  const itemBindings = (sourceRelease.itemBindings || []).map((binding) => ({
    itemId: binding.itemId,
    curationSignals: (binding.curationSignals || []).map((signal) => ({ definitionId: signal.definitionId, weight: signal.weight })),
  }));
  if (itemBindings.some((binding) => !binding.itemId)) {
    throw new AppError("La release sorgente non espone un corpus Item importabile", 409, [{ code: "EDITORIAL_RELEASE_ITEM_SCOPE_REQUIRED" }]);
  }
  if (itemBindings.length && !subjectIds.length) {
    throw new AppError("La release sorgente non espone un perimetro semantico importabile", 409, [{ code: "EDITORIAL_RELEASE_SUBJECT_SCOPE_REQUIRED" }]);
  }

  let contentSpace = null;
  let context = null;
  let semanticGraph = null;
  let graphRevision = null;
  const adoptionIds = [];
  try {
    contentSpace = await ContentSpace.create({
      name: String(contentSpaceName || `${sourceContext.displayName} — import`).trim(),
      description: `Import detached da EditorialRelease ${sourceRelease.version}`,
      ownerType,
      ownerId,
      createdBy: actorUserId,
    });
    semanticGraph = await SemanticGraph.create({
      namespaceId: namespace._id,
      displayName: `${String(displayName || `${sourceContext.displayName} — import`).trim()} · Relazioni`,
      ownerType,
      ownerId,
      createdBy: actorUserId,
    });
    graphRevision = await SemanticGraphRevision.create({
      semanticGraphId: semanticGraph._id,
      version: 1,
      basedOnRevisionId: null,
      authoredAgainstNamespaceRevisionId: sourceRelease.namespaceRevisionId,
      createdBy: actorUserId,
    });
    semanticGraph.workingRevisionId = graphRevision._id;
    semanticGraph.workingVersion = 1;
    await semanticGraph.save();
    context = await EditorialContext.create({
      contentSpaceId: contentSpace._id,
      namespaceId: namespace._id,
      semanticGraphId: semanticGraph._id,
      displayName: String(displayName || `${sourceContext.displayName} — import`).trim(),
      shortDescription: sourceContext.shortDescription || null,
      description: sourceContext.description || null,
      createdBy: actorUserId,
    });
    if (sourceBindings.length) {
      await GraphSubjectBinding.insertMany(sourceBindings.map((binding) => ({
        graphRevisionId: graphRevision._id,
        subjectId: binding.subjectId,
        subjectClassDefinitionIds: [...(binding.subjectClassDefinitionIds || [])],
      })));
    }
    if (sourceEdges.length) {
      await SemanticEdgeV2.insertMany(sourceEdges.map((edge) => ({
        graphRevisionId: graphRevision._id,
        sourceSubjectId: edge.sourceSubjectId,
        targetSubjectId: edge.targetSubjectId,
        relationTypeDefinitionId: edge.relationTypeDefinitionId,
        weight: edge.weight,
        metadata: edge.metadata ?? null,
        provenance: {
          origin: "imported",
          sourceGraphRevisionId: sourceGraphRevision._id,
          metadata: { sourceEditorialReleaseId: sourceRelease._id },
        },
      })));
    }
    if (subjectIds.length) {
      await ContentSpaceSubjectMembership.insertMany(subjectIds.map((subjectId) => ({
        contentSpaceId: contentSpace._id,
        subjectId,
        addedBy: actorUserId,
      })));
      await CollectionSubjectMembership.insertMany(subjectIds.map((subjectId) => ({
        editorialContextId: context._id,
        subjectId,
        addedBy: actorUserId,
      })));
    }
    if (itemBindings.length) {
      await ContentSpaceItemMembership.insertMany(itemBindings.map((binding) => ({
        contentSpaceId: contentSpace._id,
        itemId: binding.itemId,
        addedBy: actorUserId,
      })));
      await CollectionItemMembership.insertMany(itemBindings.map((binding) => ({
        editorialContextId: context._id,
        itemId: binding.itemId,
        curationSignals: binding.curationSignals,
        addedBy: actorUserId,
        updatedBy: actorUserId,
      })));
    }

    const contextAdoption = await recordAdoptionFromAccess({
      access: contextAccess,
      actorUserId,
      action: "context_import",
      sourceResourceRef: { resourceType: "editorial_context", resourceId: sourceContext._id },
      sourceSnapshotRef: { resourceType: "editorial_release", resourceId: sourceRelease._id },
      resultResourceRef: { resourceType: "editorial_context", resourceId: context._id },
    });
    if (contextAdoption) adoptionIds.push(contextAdoption._id);
    const namespaceAdoption = await recordAdoptionFromAccess({
      access: namespaceAccess,
      actorUserId,
      action: "namespace_use",
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: sourceRelease.namespaceRevisionId },
      resultResourceRef: { resourceType: "editorial_context", resourceId: context._id },
    });
    if (namespaceAdoption) adoptionIds.push(namespaceAdoption._id);

    return {
      contentSpace: { id: contentSpace._id, name: contentSpace.name },
      editorialContext: { id: context._id, displayName: context.displayName, namespaceId: context.namespaceId },
      semanticGraphId: semanticGraph._id,
      workingGraphRevisionId: graphRevision._id,
      importedFrom: { editorialContextId: sourceContext._id, editorialReleaseId: sourceRelease._id },
      subjectMembershipCount: subjectIds.length,
      itemMembershipCount: itemBindings.length,
    };
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    if (graphRevision?._id) {
      await GraphSubjectBinding.deleteMany({ graphRevisionId: graphRevision._id }).catch(() => {});
      await SemanticEdgeV2.deleteMany({ graphRevisionId: graphRevision._id }).catch(() => {});
      await SemanticGraphRevision.deleteOne({ _id: graphRevision._id }).catch(() => {});
    }
    if (semanticGraph?._id) await SemanticGraph.deleteOne({ _id: semanticGraph._id }).catch(() => {});
    if (contentSpace?._id) {
      await Promise.allSettled([
        ContentSpaceItemMembership.deleteMany({ contentSpaceId: contentSpace._id }),
        ContentSpaceSubjectMembership.deleteMany({ contentSpaceId: contentSpace._id }),
      ]);
    }
    if (context?._id) {
      await Promise.allSettled([
        CollectionItemMembership.deleteMany({ editorialContextId: context._id }),
        CollectionSubjectMembership.deleteMany({ editorialContextId: context._id }),
        EditorialContext.deleteOne({ _id: context._id }),
      ]);
    }
    if (contentSpace?._id) await ContentSpace.deleteOne({ _id: contentSpace._id }).catch(() => {});
    throw error;
  }
}

module.exports = { importEditorialContextSnapshot };
