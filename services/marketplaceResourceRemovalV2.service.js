const mongoose = require("mongoose");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const AppError = require("../utils/AppError");
const { assertCanActForPrincipal } = require("./principalResolution.service");
const { trashPhysicalVocabulary } = require("./physicalVocabulary.service");

const REMOVABLE_RESOURCE_TYPES = Object.freeze(["item_edition", "namespace", "physical_vocabulary"]);

function id(value) { return String(value?._id || value || ""); }
function sameId(a, b) { return id(a) === id(b); }
function lifecyclePermission(resourceType) {
  if (resourceType === "item_edition") return "item.lifecycle.manage";
  if (resourceType === "namespace") return "namespace.lifecycle.manage";
  return "physical_vocabulary.lifecycle.manage";
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

async function itemRemovalTarget({ resourceId, principal, actorUserId, now, session }) {
  const edition = await ItemEdition.findById(resourceId).session(session).lean();
  if (!edition) throw new AppError("Contenuto non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  const item = await ItemV2.findOne({ _id: edition.itemId, lifecycleStatus: "active" }).session(session);
  if (!item) throw new AppError("Contenuto non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(item, principal);

  const editions = await ItemEdition.find({ itemId: item._id }).select("_id").session(session).lean();
  const editionIds = editions.map((entry) => entry._id);
  const revisionIds = editionIds.length
    ? await ItemRevisionV2.find({ itemEditionId: { $in: editionIds } }).distinct("_id").session(session)
    : [];
  item.lifecycleStatus = "trashed";
  item.trashedAt = now;
  item.trashedBy = actorUserId;
  await item.save({ session });
  return {
    aggregateType: "item",
    aggregateId: item._id,
    references: [reference("item_edition", editionIds), reference("item_revision", revisionIds)].filter(Boolean),
  };
}

async function namespaceRemovalTarget({ resourceId, principal, actorUserId, now, session }) {
  const namespace = await Namespace.findOne({ _id: resourceId, lifecycleStatus: "active" }).session(session);
  if (!namespace) throw new AppError("Regole editoriali non disponibili", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(namespace, principal);
  const revisionIds = await NamespaceRevision.find({ namespaceId: namespace._id }).distinct("_id").session(session);
  namespace.lifecycleStatus = "trashed";
  namespace.trashedAt = now;
  namespace.trashedBy = actorUserId;
  await namespace.save({ session });
  return {
    aggregateType: "namespace",
    aggregateId: namespace._id,
    references: [reference("namespace", [namespace._id]), reference("namespace_revision", revisionIds)].filter(Boolean),
  };
}

async function physicalVocabularyRemovalTarget({ resourceId, principal, actorUserId, now, session }) {
  const physicalVocabulary = await PhysicalVocabulary.findOne({ _id: resourceId, lifecycleStatus: "active" }).session(session).lean();
  if (!physicalVocabulary) throw new AppError("Vocabolario fisico non disponibile", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  assertOwnership(physicalVocabulary, principal);
  const revisionIds = await PhysicalVocabularyRevision.find({ physicalVocabularyId: physicalVocabulary._id }).distinct("_id").session(session);
  await trashPhysicalVocabulary({ physicalVocabularyId: physicalVocabulary._id, actorUserId, session, now });
  return {
    aggregateType: "physical_vocabulary",
    aggregateId: physicalVocabulary._id,
    references: [
      reference("physical_vocabulary", [physicalVocabulary._id]),
      reference("physical_vocabulary_revision", revisionIds),
    ].filter(Boolean),
  };
}

async function removalTarget(args) {
  if (args.resourceType === "item_edition") return itemRemovalTarget(args);
  if (args.resourceType === "namespace") return namespaceRemovalTarget(args);
  return physicalVocabularyRemovalTarget(args);
}

async function removeOwnedWorkspaceResource({
  actorUserId,
  principalType = "user",
  principalId = actorUserId,
  resourceType,
  resourceId,
}) {
  if (!REMOVABLE_RESOURCE_TYPES.includes(resourceType)) {
    throw new AppError("Puoi rimuovere soltanto contenuti, regole editoriali o vocabolari fisici", 400, [{
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
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const target = await removalTarget({ resourceType, resourceId, principal, actorUserId, now, session });

      const directListings = await MarketplaceListing.find({
        $or: listingReferenceFilter(target.references),
      }).select("_id").session(session).lean();
      const directListingIds = directListings.map((entry) => entry._id);
      const offerClauses = offerReferenceFilter(target.references, directListingIds);
      const offerListingIds = offerClauses.length
        ? await MarketplaceOffer.find({ $or: offerClauses }).distinct("listingId").session(session)
        : [];
      const affectedListingIds = [...new Map(
        [...directListingIds, ...offerListingIds].map((listingId) => [id(listingId), listingId]),
      ).values()];

      const listingResult = affectedListingIds.length
        ? await MarketplaceListing.updateMany(
          { _id: { $in: affectedListingIds } },
          { $set: { status: "withdrawn", withdrawnAt: now, withdrawnBy: actorUserId } },
          { session },
        )
        : { modifiedCount: 0 };
      const offerResult = affectedListingIds.length
        ? await MarketplaceOffer.updateMany(
          { listingId: { $in: affectedListingIds } },
          { $set: { status: "inactive", inactivatedAt: now, inactivatedBy: actorUserId } },
          { session },
        )
        : { modifiedCount: 0 };

      result = {
        resourceType,
        resourceId,
        aggregateType: target.aggregateType,
        aggregateId: target.aggregateId,
        lifecycleStatus: "trashed",
        withdrawnListingCount: Number(listingResult.modifiedCount || 0),
        inactiveOfferCount: Number(offerResult.modifiedCount || 0),
        removedAt: now,
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { REMOVABLE_RESOURCE_TYPES, removeOwnedWorkspaceResource };
