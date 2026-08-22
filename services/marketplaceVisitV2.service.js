const MarketplaceListing = require("../models/marketplaceListing.model");
const VenueTarget = require("../models/venueTarget.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const marketplace = require("./marketplaceV2.service");
const { resolveMarketableResource } = require("./marketplaceResourceV2.service");
const { projectVisitPhysicalScope } = require("./visitReadProjectionV2.service");

const VISIT_EXECUTE_LABEL = "Esegui questa visita";
function clampLimit(value) { return Math.min(50, Math.max(1, Number(value) || 20)); }

async function createVisitListing({ visitId, sellerType, sellerId, actorUserId }) {
  return marketplace.createListing({
    resourceType: "visit",
    resourceId: visitId,
    sellerType,
    sellerId,
    actorUserId,
  });
}

async function createVisitExecuteOffer({ listingId, payload = {}, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, resourceType: "visit", status: "published" }).lean();
  if (!listing) throw new AppError("Listing Visit non disponibile", 404);
  return marketplace.createOffer({
    listingId,
    actorUserId,
    payload: {
      label: String(payload.label || VISIT_EXECUTE_LABEL).trim(),
      pricing: payload.pricing || { type: "free" },
      grants: [{
        resourceType: "visit",
        resourceId: listing.resourceId,
        capability: "visit.execute",
        versionPolicy: payload.versionPolicy || "follow_current",
      }],
    },
  });
}

async function enrichVisitProjection(projection) {
  const marketable = await resolveMarketableResource({ resourceType: "visit", resourceId: projection.asset.id });
  const physicalScope = await projectVisitPhysicalScope(marketable.snapshot);
  return {
    ...projection,
    asset: {
      ...projection.asset,
      physicalScope: physicalScope.venues,
      stopCount: physicalScope.stopCount,
    },
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
  const query = { resourceType: "visit", status: "published" };
  if (venueVisitIds) query.resourceId = { $in: venueVisitIds };
  const [listings, total] = await Promise.all([
    MarketplaceListing.find(query).sort({ updatedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    MarketplaceListing.countDocuments(query),
  ]);
  const results = [];
  for (const listing of listings) {
    const projection = await marketplace.projectCatalogListing({ listing, actorUserId });
    if (projection) results.push(await enrichVisitProjection(projection));
  }
  return { results, page: safePage, pageSize: safeLimit, total };
}

async function getVisitListingDetail({ listingId, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, resourceType: "visit", status: "published" }).lean();
  if (!listing) throw new AppError("Listing Visit non disponibile", 404);
  const projection = await marketplace.projectCatalogListing({ listing, actorUserId });
  if (!projection) throw new AppError("La risorsa del Listing non e disponibile", 409);
  return enrichVisitProjection(projection);
}

module.exports = {
  createVisitListing,
  createVisitExecuteOffer,
  acquireOffer: marketplace.acquireOffer,
  listVisitCatalog,
  getVisitListingDetail,
};
