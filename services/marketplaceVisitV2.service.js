const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const Entitlement = require("../models/entitlement.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const VenueTarget = require("../models/venueTarget.model");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { assertCanActForPrincipal } = require("./principalResolution.service");
const { resolveCapabilityAccess } = require("./capabilityAuthorization.service");
const { projectVisitPhysicalScope } = require("./visitReadProjectionV2.service");

const VISIT_EXECUTE_LABEL = "Esegui questa visita";
function id(value) { return String(value?._id || value || ""); }
function clampLimit(value) { return Math.min(50, Math.max(1, Number(value) || 20)); }

async function sellerSummary(listing) {
  if (listing.sellerType === "organization") {
    const organization = await Organization.findById(listing.sellerId).select("name").lean();
    return { type: "organization", id: listing.sellerId, name: organization?.name || "Organization" };
  }
  const user = await User.findById(listing.sellerId).select("username").lean();
  return { type: "user", id: listing.sellerId, name: user?.username || "Autore" };
}

async function loadPublishedVisit(resourceId) {
  const visit = await VisitV2.findOne({ _id: resourceId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) return null;
  const revision = await VisitRevisionV2.findOne({ _id: visit.publishedRevisionId, visitId: visit._id, status: "published" }).lean();
  return revision ? { visit, revision } : null;
}

async function assertSellerOwnsPublishedVisit({ visitId, sellerType, sellerId, actorUserId }) {
  await assertCanActForPrincipal({
    actorUserId,
    principalType: sellerType,
    principalId: sellerId,
    minimumOrganizationRole: sellerType === "organization" ? "manager" : "operator",
  });
  const source = await loadPublishedVisit(visitId);
  if (!source) throw new AppError("Visit pubblicata non disponibile", 409, [{ code: "PUBLISHED_VISIT_REQUIRED" }]);
  if (source.visit.ownerType !== sellerType || id(source.visit.ownerId) !== id(sellerId)) {
    throw new AppError("Il seller deve coincidere con il principal proprietario della Visit", 403, [{ code: "SELLER_RESOURCE_AUTHORITY_REQUIRED" }]);
  }
  return source;
}

async function createVisitListing({ visitId, sellerType, sellerId, actorUserId }) {
  await assertSellerOwnsPublishedVisit({ visitId, sellerType, sellerId, actorUserId });
  const existing = await MarketplaceListing.findOne({ resourceType: "visit", resourceId: visitId, status: "active" });
  if (existing) return existing;
  return MarketplaceListing.create({
    sellerType,
    sellerId,
    resourceType: "visit",
    resourceId: visitId,
    createdBy: actorUserId,
  });
}

async function createVisitExecuteOffer({ listingId, payload = {}, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, resourceType: "visit", status: "active" });
  if (!listing) throw new AppError("Listing Visit non disponibile", 404);
  await assertCanActForPrincipal({
    actorUserId,
    principalType: listing.sellerType,
    principalId: listing.sellerId,
    minimumOrganizationRole: listing.sellerType === "organization" ? "manager" : "operator",
  });
  const source = await loadPublishedVisit(listing.resourceId);
  if (!source) throw new AppError("La Visit del Listing non e piu pubblicata", 409, [{ code: "LISTING_RESOURCE_NOT_EXECUTABLE" }]);
  const versionPolicy = payload.versionPolicy || "follow_current";
  if (!["follow_current", "pin_at_acquisition"].includes(versionPolicy)) {
    throw new AppError("Version policy non supportata per una Visit live", 400, [{ field: "versionPolicy", code: "INVALID_ENUM" }]);
  }
  const pricingType = payload.pricing?.type || "free";
  const pricing = pricingType === "paid"
    ? { type: "paid", amountMinor: Number(payload.pricing?.amountMinor), currency: payload.pricing?.currency }
    : { type: "free", amountMinor: 0, currency: null };
  return MarketplaceOffer.create({
    listingId: listing._id,
    label: String(payload.label || VISIT_EXECUTE_LABEL).trim(),
    pricing,
    grants: [{ resourceType: "visit", resourceId: listing.resourceId, capability: "visit.execute", versionPolicy }],
    createdBy: actorUserId,
  });
}

async function resolveEntitlementFromGrant(grant) {
  if (grant.resourceType === "visit" && grant.versionPolicy === "pin_at_acquisition") {
    const source = await loadPublishedVisit(grant.resourceId);
    if (!source) throw new AppError("La Visit non possiede una revisione pubblicata pinzabile", 409, [{ code: "PINNED_SNAPSHOT_UNAVAILABLE" }]);
    return {
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "visit_revision", resourceId: source.revision._id },
    };
  }
  if (grant.versionPolicy === "pinned") {
    return {
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: grant.resourceType, resourceId: grant.resourceId },
    };
  }
  return { versionPolicy: "follow_current", baselineSnapshotRef: null };
}

async function acquireOffer({ offerId, actorUserId, beneficiaryType = "user", beneficiaryId = actorUserId }) {
  await assertCanActForPrincipal({ actorUserId, principalType: beneficiaryType, principalId: beneficiaryId });
  const offer = await MarketplaceOffer.findOne({ _id: offerId, status: "active" }).lean();
  if (!offer) throw new AppError("MarketplaceOffer non disponibile", 404);
  const listing = await MarketplaceListing.findOne({ _id: offer.listingId, status: "active" }).lean();
  if (!listing) throw new AppError("MarketplaceListing non disponibile", 409);
  if (offer.pricing?.type !== "free") {
    throw new AppError("Il pagamento simulato verra implementato nel Marketplace completo", 409, [{ code: "PAID_ACQUISITION_NOT_IMPLEMENTED" }]);
  }

  const existing = await MarketplaceAcquisition.findOne({ offerId: offer._id, buyerType: beneficiaryType, buyerId: beneficiaryId }).lean();
  if (existing) {
    const entitlements = await Entitlement.find({ sourceAcquisitionId: existing._id }).lean();
    return { acquisition: existing, entitlements, alreadyAcquired: true };
  }

  const entitlementSnapshots = [];
  for (const grant of offer.grants || []) entitlementSnapshots.push(await resolveEntitlementFromGrant(grant));
  let acquisition;
  try {
    acquisition = await MarketplaceAcquisition.create({
      listingId: listing._id,
      offerId: offer._id,
      buyerType: beneficiaryType,
      buyerId: beneficiaryId,
      sellerType: listing.sellerType,
      sellerId: listing.sellerId,
      pricingSnapshot: offer.pricing,
      grantSnapshots: offer.grants,
      acquiredBy: actorUserId,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await MarketplaceAcquisition.findOne({ offerId: offer._id, buyerType: beneficiaryType, buyerId: beneficiaryId }).lean();
      const entitlements = concurrent ? await Entitlement.find({ sourceAcquisitionId: concurrent._id }).lean() : [];
      if (concurrent) return { acquisition: concurrent, entitlements, alreadyAcquired: true };
    }
    throw error;
  }

  const entitlements = [];
  try {
    for (let index = 0; index < (offer.grants || []).length; index += 1) {
      const grant = offer.grants[index];
      const resolved = entitlementSnapshots[index];
      entitlements.push(await Entitlement.create({
        beneficiaryType,
        beneficiaryId,
        sourceAcquisitionId: acquisition._id,
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
        capability: grant.capability,
        versionPolicy: resolved.versionPolicy,
        baselineSnapshotRef: resolved.baselineSnapshotRef,
      }));
    }
  } catch (error) {
    await Entitlement.deleteMany({ sourceAcquisitionId: acquisition._id }).catch(() => {});
    await MarketplaceAcquisition.deleteOne({ _id: acquisition._id }).catch(() => {});
    throw error;
  }
  return { acquisition: acquisition.toObject(), entitlements: entitlements.map((entry) => entry.toObject()), alreadyAcquired: false };
}

function versionBehaviour(versionPolicy) {
  if (versionPolicy === "follow_current") return { code: "follow_current", label: "Include gli aggiornamenti futuri" };
  return { code: "pinned", label: "Mantiene la versione acquisita" };
}

async function projectCatalogListing({ listing, actorUserId }) {
  const source = await loadPublishedVisit(listing.resourceId);
  if (!source) return null;
  const [offers, physicalScope, seller, access] = await Promise.all([
    MarketplaceOffer.find({ listingId: listing._id, status: "active" }).sort({ createdAt: 1 }).lean(),
    projectVisitPhysicalScope(source.revision),
    sellerSummary(listing),
    resolveCapabilityAccess({ actorUserId, capability: "visit.execute", resourceType: "visit", resourceId: source.visit._id }),
  ]);
  if (!offers.length) return null;
  return {
    listingId: listing._id,
    asset: {
      type: "visit",
      id: source.visit._id,
      title: source.revision.title,
      summary: source.revision.description || "",
      publisher: seller,
      physicalScope: physicalScope.venues,
      stopCount: physicalScope.stopCount,
    },
    offers: offers.map((offer) => ({
      id: offer._id,
      label: offer.label || VISIT_EXECUTE_LABEL,
      pricing: offer.pricing,
      uses: [{ capability: "visit.execute", label: VISIT_EXECUTE_LABEL }],
      versionBehaviour: versionBehaviour(offer.grants?.[0]?.versionPolicy),
    })),
    viewerState: { alreadyUsable: access.allowed },
  };
}

async function catalogVisitIdsForVenue(venueId) {
  if (!venueId) return null;
  const targetIds = await VenueTarget.find({ venueId, lifecycleStatus: "active" }).distinct("_id");
  if (!targetIds.length) return [];
  return VisitRevisionV2.find({ status: "published", "visitAnchors.venueTargetId": { $in: targetIds } }).distinct("visitId");
}

async function listVisitCatalog({ actorUserId, venueId = null, page = 1, limit = 20 }) {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);
  const venueVisitIds = await catalogVisitIdsForVenue(venueId);
  const query = { resourceType: "visit", status: "active" };
  if (venueVisitIds) query.resourceId = { $in: venueVisitIds };
  const [listings, total] = await Promise.all([
    MarketplaceListing.find(query).sort({ updatedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    MarketplaceListing.countDocuments(query),
  ]);
  const results = [];
  for (const listing of listings) {
    const projection = await projectCatalogListing({ listing, actorUserId });
    if (projection) results.push(projection);
  }
  return { results, page: safePage, pageSize: safeLimit, total };
}

async function getVisitListingDetail({ listingId, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, resourceType: "visit", status: "active" }).lean();
  if (!listing) throw new AppError("Listing Visit non disponibile", 404);
  const projection = await projectCatalogListing({ listing, actorUserId });
  if (!projection) throw new AppError("La risorsa del Listing non e disponibile", 409);
  return projection;
}

module.exports = {
  createVisitListing,
  createVisitExecuteOffer,
  acquireOffer,
  listVisitCatalog,
  getVisitListingDetail,
};
