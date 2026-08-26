const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const AppError = require("../utils/AppError");
const { RESOURCE_TYPES } = require("../config/marketplaceCapabilities");
const marketplace = require("./marketplaceV2.service");
const { projectListingConsumerDetail } = require("./marketplaceConsumerProjectionV2.service");
const { resolveMarketableResource } = require("./marketplaceResourceV2.service");
const {
  resolveVenueCatalogFilter,
  projectVenueRelevance,
  resolveVenueSelectorProjection,
} = require("./venueCatalogRelevanceV2.service");

function clampLimit(value) { return Math.min(50, Math.max(1, Number(value) || 20)); }

function normalizeResourceTypes(values) {
  if (!values) return null;
  const list = Array.isArray(values) ? values : String(values).split(",");
  const normalized = [...new Set(list.map((value) => String(value).trim()).filter(Boolean))];
  const invalid = normalized.filter((value) => !RESOURCE_TYPES.includes(value));
  if (invalid.length) {
    throw new AppError("resourceTypes contiene valori non supportati", 400, [{
      field: "resourceTypes",
      code: "INVALID_ENUM",
      context: { invalid },
    }]);
  }
  return normalized.length ? normalized : null;
}

function normalizeVenueIds(values) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : String(values).split(",");
  return [...new Set(list.map((value) => String(value).trim()).filter(Boolean))];
}

async function augmentVenueProjection({ projected, listing, venueFilter }) {
  if (!projected || !venueFilter?.selectedVenueIds?.length) return projected;
  const marketable = await resolveMarketableResource({ resourceType: listing.resourceType, resourceId: listing.resourceId });
  const venueRelevance = await projectVenueRelevance({ marketable, filter: venueFilter });
  projected.asset.venueRelevance = venueRelevance;
  if (venueRelevance?.physicalScope) projected.asset.physicalScope = venueRelevance.physicalScope.venues;
  return projected;
}

async function listCatalog({
  actorUserId,
  page = 1,
  limit = 20,
  queryText = "",
  resourceTypes = null,
  sellerType = null,
  sellerId = null,
  selectedVenueIds = [],
}) {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);
  const types = normalizeResourceTypes(resourceTypes);
  const venueFilter = await resolveVenueCatalogFilter({ selectedVenueIds: normalizeVenueIds(selectedVenueIds) });
  const activeListingIds = await MarketplaceOffer.distinct("listingId", { status: "active" });

  const filters = [{ status: "published", _id: { $in: activeListingIds } }];
  if (types) filters.push({ resourceType: { $in: types } });
  if (sellerType) filters.push({ sellerType });
  if (sellerId) filters.push({ sellerId });
  if (venueFilter.listingQuery) filters.push(venueFilter.listingQuery);
  const text = String(queryText || "").trim();
  if (text) filters.push({ $text: { $search: text } });
  const query = filters.length === 1 ? filters[0] : { $and: filters };
  const sort = text ? { score: { $meta: "textScore" }, updatedAt: -1 } : { updatedAt: -1 };
  const projection = text ? { score: { $meta: "textScore" } } : null;

  const [listings, total] = await Promise.all([
    MarketplaceListing.find(query, projection)
      .sort(sort)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    MarketplaceListing.countDocuments(query),
  ]);

  const results = [];
  for (const listing of listings) {
    const projected = await marketplace.projectCatalogListing({ listing, actorUserId });
    if (!projected) continue;
    results.push(await augmentVenueProjection({ projected, listing, venueFilter }));
  }

  return {
    results,
    page: safePage,
    pageSize: safeLimit,
    total,
    selectedVenueIds: venueFilter.selectedVenueIds,
  };
}

async function getListingDetail({
  listingId,
  actorUserId,
  selectedVenueIds = [],
  beneficiaryType = null,
  beneficiaryId = null,
}) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, status: "published" }).lean();
  if (!listing) throw new AppError("MarketplaceListing non disponibile", 404);
  if (!await MarketplaceOffer.exists({ listingId: listing._id, status: "active" })) {
    throw new AppError("Questa scheda non è disponibile perché non ha un'offerta attiva", 404, [{ code: "ACTIVE_OFFER_REQUIRED" }]);
  }
  const projected = await marketplace.projectCatalogListing({ listing, actorUserId });
  if (!projected) throw new AppError("La risorsa del Listing non e disponibile", 409);
  const venueFilter = await resolveVenueCatalogFilter({ selectedVenueIds: normalizeVenueIds(selectedVenueIds) });
  if (venueFilter.listingQuery) {
    const matches = await MarketplaceListing.exists({ _id: listing._id, status: "published", ...venueFilter.listingQuery });
    if (!matches) throw new AppError("La risorsa non è pertinente alle Venue selezionate", 404, [{ code: "NOT_RELEVANT_TO_SELECTED_VENUES" }]);
  }
  const withVenue = await augmentVenueProjection({ projected, listing, venueFilter });
  return projectListingConsumerDetail({
    actorUserId,
    projected: withVenue,
    beneficiaryType,
    beneficiaryId,
  });
}

module.exports = {
  normalizeVenueIds,
  listCatalog,
  getListingDetail,
  resolveVenueSelectorProjection,
};
