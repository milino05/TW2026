const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const AppError = require("../utils/AppError");
const { assertCanActForPrincipal } = require("./principalResolution.service");

const REMOVABLE_RESOURCE_TYPES = Object.freeze([
  "item_edition",
  "editorial_context",
  "namespace",
  "physical_vocabulary",
  "visit",
]);

function id(value) { return String(value?._id || value || ""); }
function sameId(a, b) { return id(a) === id(b); }
function lifecyclePermission(resourceType) {
  return {
    item_edition: "item.lifecycle.manage",
    editorial_context: "editorial_context.lifecycle.manage",
    namespace: "namespace.lifecycle.manage",
    physical_vocabulary: "physical_vocabulary.lifecycle.manage",
    visit: "visit.lifecycle.manage",
  }[resourceType];
}
function reference(resourceType, resourceIds) {
  const ids = (resourceIds || []).filter(Boolean);
  return ids.length ? { resourceType, resourceId: { $in: ids } } : null;
}
function listingReferenceFilter(references) {
  return references.map((entry) => ({ resourceType: entry.resourceType, resourceId: entry.resourceId }));
}
function offerReferenceFilter(references, directListingIds) {
  const clauses = references.map((entry) => ({ grants: { $elemMatch: entry } }));
  if (directListingIds.length) clauses.unshift({ listingId: { $in: directListingIds } });
  return clauses;
}
function assertOwnership(resource, principal) {
  if (!resource || resource.ownerType !== principal.type || !sameId(resource.ownerId, principal.id)) {
    throw new AppError("Questa risorsa non appartiene all'area di lavoro selezionata", 403, [{ code: "RESOURCE_OWNER_REQUIRED" }]);
  }
}

async function itemRemovalTarget({ resourceId, principal }) {
  const edition = await ItemEdition.findById(resourceId).lean();
  if (!edition) throw new AppError("Contenuto non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" }).lean();
  if (!item) throw new AppError("Contenuto non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(item, principal);

  const editions = await ItemEdition.find({ itemId: item._id }).select("_id").lean();
  const editionIds = editions.map((entry) => entry._id);
  const revisionIds = editionIds.length
    ? await ItemRevisionV2.find({ itemEditionId: { $in: editionIds } }).distinct("_id")
    : [];
  return {
    lifecycleModel: ItemV2,
    lifecycleId: item._id,
    unavailableMessage: "Contenuto non disponibile",
    aggregateType: "item",
    aggregateId: item._id,
    references: [reference("item_edition", editionIds), reference("item_revision", revisionIds)].filter(Boolean),
  };
}

async function namespaceRemovalTarget({ resourceId, principal }) {
  const namespace = await Namespace.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(namespace, principal);
  const revisionIds = await NamespaceRevision.find({ namespaceId: namespace._id }).distinct("_id");
  return {
    lifecycleModel: Namespace,
    lifecycleId: namespace._id,
    unavailableMessage: "Regole editoriali non disponibili",
    aggregateType: "namespace",
    aggregateId: namespace._id,
    references: [reference("namespace", [namespace._id]), reference("namespace_revision", revisionIds)].filter(Boolean),
  };
}

async function physicalVocabularyRemovalTarget({ resourceId, principal }) {
  const physicalVocabulary = await PhysicalVocabulary.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
  if (!physicalVocabulary) throw new AppError("Vocabolario fisico non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(physicalVocabulary, principal);
  const revisionIds = await PhysicalVocabularyRevision.find({ physicalVocabularyId: physicalVocabulary._id }).distinct("_id");
  return {
    lifecycleModel: PhysicalVocabulary,
    lifecycleId: physicalVocabulary._id,
    unavailableMessage: "Vocabolario fisico non disponibile",
    aggregateType: "physical_vocabulary",
    aggregateId: physicalVocabulary._id,
    references: [
      reference("physical_vocabulary", [physicalVocabulary._id]),
      reference("physical_vocabulary_revision", revisionIds),
    ].filter(Boolean),
  };
}

async function semanticGraphRemovalImpact(context) {
  if (!context?.semanticGraphId) return { semanticGraphRelationCount: 0, semanticGraphCollectionCount: 0 };
  const semanticGraph = await SemanticGraph.findOne({
    _id: context.semanticGraphId,
    lifecycleStatus: "active",
  }).select("workingRevisionId").lean();
  if (!semanticGraph) return { semanticGraphRelationCount: 0, semanticGraphCollectionCount: 0 };
  const [semanticGraphRelationCount, semanticGraphCollectionCount] = await Promise.all([
    semanticGraph.workingRevisionId
      ? SemanticEdgeV2.countDocuments({ graphRevisionId: semanticGraph.workingRevisionId })
      : 0,
    EditorialContext.countDocuments({ semanticGraphId: semanticGraph._id, lifecycleStatus: "active" }),
  ]);
  return {
    semanticGraphRelationCount: Number(semanticGraphRelationCount || 0),
    semanticGraphCollectionCount: Number(semanticGraphCollectionCount || 0),
  };
}

async function editorialContextRemovalTarget({ resourceId, principal }) {
  const context = await EditorialContext.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
  if (!context) throw new AppError("Raccolta editoriale non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  const contentSpace = await ContentSpace.findOne({ _id: context.contentSpaceId, lifecycleStatus: "active" }).lean();
  if (!contentSpace) throw new AppError("Spazio editoriale della raccolta non disponibile", 409, [{ code: "CONTENT_SPACE_NOT_FOUND" }]);
  assertOwnership(contentSpace, principal);
  const [releaseIds, graphImpact] = await Promise.all([
    EditorialRelease.find({ editorialContextId: context._id }).distinct("_id"),
    semanticGraphRemovalImpact(context),
  ]);
  return {
    lifecycleModel: EditorialContext,
    lifecycleId: context._id,
    unavailableMessage: "Raccolta editoriale non disponibile",
    aggregateType: "editorial_context",
    aggregateId: context._id,
    ...graphImpact,
    references: [reference("editorial_context", [context._id]), reference("editorial_release", releaseIds)].filter(Boolean),
  };
}

async function visitRemovalTarget({ resourceId, principal }) {
  const visit = await VisitV2.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
  if (!visit) throw new AppError("Visita non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(visit, principal);
  const revisionIds = await VisitRevisionV2.find({ visitId: visit._id }).distinct("_id");
  return {
    lifecycleModel: VisitV2,
    lifecycleId: visit._id,
    unavailableMessage: "Visita non disponibile",
    aggregateType: "visit",
    aggregateId: visit._id,
    references: [reference("visit", [visit._id]), reference("visit_revision", revisionIds)].filter(Boolean),
  };
}

async function getOwnedWorkspaceRemovalImpact({ resourceType, resourceId }) {
  if (resourceType !== "editorial_context") return {};
  const context = await EditorialContext.findOne({ _id: resourceId, lifecycleStatus: "active" }).lean();
  if (!context) return {};
  return semanticGraphRemovalImpact(context);
}

async function removalTarget(args) {
  if (args.resourceType === "item_edition") return itemRemovalTarget(args);
  if (args.resourceType === "editorial_context") return editorialContextRemovalTarget(args);
  if (args.resourceType === "namespace") return namespaceRemovalTarget(args);
  if (args.resourceType === "physical_vocabulary") return physicalVocabularyRemovalTarget(args);
  return visitRemovalTarget(args);
}

async function cleanupMarketplaceDistribution({ references, actorUserId, now }) {
  if (!references.length) return { withdrawnListingCount: 0, inactiveOfferCount: 0 };
  const directListings = await MarketplaceListing.find({
    $or: listingReferenceFilter(references),
  }).select("_id").lean();
  const directListingIds = directListings.map((entry) => entry._id);
  const offerClauses = offerReferenceFilter(references, directListingIds);
  const offerListingIds = offerClauses.length
    ? await MarketplaceOffer.find({ $or: offerClauses }).distinct("listingId")
    : [];
  const affectedListingIds = [...new Map(
    [...directListingIds, ...offerListingIds].map((listingId) => [id(listingId), listingId]),
  ).values()];
  if (!affectedListingIds.length) return { withdrawnListingCount: 0, inactiveOfferCount: 0 };

  const listingResult = await MarketplaceListing.updateMany(
    { _id: { $in: affectedListingIds }, status: { $ne: "withdrawn" } },
    { $set: { status: "withdrawn", withdrawnAt: now, withdrawnBy: actorUserId } },
  );
  const offerResult = await MarketplaceOffer.updateMany(
    { listingId: { $in: affectedListingIds }, status: { $ne: "inactive" } },
    { $set: { status: "inactive", inactivatedAt: now, inactivatedBy: actorUserId } },
  );
  return {
    withdrawnListingCount: Number(listingResult.modifiedCount || 0),
    inactiveOfferCount: Number(offerResult.modifiedCount || 0),
  };
}

async function applyLifecycleRemoval({ target, actorUserId, now }) {
  const removed = await target.lifecycleModel.findOneAndUpdate(
    { _id: target.lifecycleId, lifecycleStatus: "active" },
    { $set: { lifecycleStatus: "trashed", trashedAt: now, trashedBy: actorUserId } },
    { new: true },
  );
  if (!removed) {
    throw new AppError(target.unavailableMessage, 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  }
  return removed;
}

async function removeOwnedWorkspaceResource({
  actorUserId,
  principalType = "user",
  principalId = actorUserId,
  resourceType,
  resourceId,
}) {
  if (!REMOVABLE_RESOURCE_TYPES.includes(resourceType)) {
    throw new AppError("Questo tipo di risorsa non può essere eliminato dall’account", 400, [{
      field: "resourceType",
      code: "INVALID_ENUM",
      allowedValues: REMOVABLE_RESOURCE_TYPES,
    }]);
  }
  await assertCanActForPrincipal({
    actorUserId,
    principalType,
    principalId,
    permissionCode: principalType === "organization" ? lifecyclePermission(resourceType) : null,
  });
  const principal = { type: principalType, id: principalId };
  const target = await removalTarget({ resourceType, resourceId, principal });
  const now = new Date();

  // Withdraw distribution first: a partial failure stays conservative (unpublished),
  // while the resource is still active and the operation can be retried safely.
  const before = await cleanupMarketplaceDistribution({ references: target.references, actorUserId, now });
  await applyLifecycleRemoval({ target, actorUserId, now });

  // The live lifecycle is authoritative for catalog visibility. This idempotent
  // second pass also catches listings/offers created concurrently with the removal.
  const after = await cleanupMarketplaceDistribution({ references: target.references, actorUserId, now });

  return {
    resourceType,
    resourceId,
    aggregateType: target.aggregateType,
    aggregateId: target.aggregateId,
    lifecycleStatus: "trashed",
    semanticGraphRelationCount: Number(target.semanticGraphRelationCount || 0),
    semanticGraphCollectionCount: Number(target.semanticGraphCollectionCount || 0),
    withdrawnListingCount: before.withdrawnListingCount + after.withdrawnListingCount,
    inactiveOfferCount: before.inactiveOfferCount + after.inactiveOfferCount,
    removedAt: now,
  };
}

module.exports = {
  REMOVABLE_RESOURCE_TYPES,
  getOwnedWorkspaceRemovalImpact,
  removeOwnedWorkspaceResource,
};
