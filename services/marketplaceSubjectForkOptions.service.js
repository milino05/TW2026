const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");

function id(value) { return String(value?._id || value?.id || value || ""); }

async function listMarketplaceForkOptionsForSubject({ subjectId, ownerType, ownerId }) {
  const foreignItems = await ItemV2.find({
    primarySubjectId: subjectId,
    lifecycleStatus: "active",
    $or: [
      { ownerType: { $ne: ownerType } },
      { ownerType, ownerId: { $ne: ownerId } },
    ],
  }).select("_id").lean();
  if (!foreignItems.length) return [];

  const editions = await ItemEdition.find({ itemId: { $in: foreignItems.map((item) => item._id) } })
    .select("_id itemId")
    .lean();
  if (!editions.length) return [];

  const editionIds = editions.map((edition) => edition._id);
  const offers = await MarketplaceOffer.find({
    status: "active",
    grants: {
      $elemMatch: {
        resourceType: "item_edition",
        resourceId: { $in: editionIds },
        capability: "content.fork",
      },
    },
  }).select("listingId label pricing grants updatedAt").sort({ updatedAt: -1, _id: -1 }).lean();
  if (!offers.length) return [];

  const listingIds = [...new Set(offers.map((offer) => id(offer.listingId)).filter(Boolean))];
  const listings = await MarketplaceListing.find({ _id: { $in: listingIds }, status: "published" })
    .select("title summary sellerType sellerId")
    .lean();
  const listingById = new Map(listings.map((listing) => [id(listing), listing]));
  if (!listingById.size) return [];

  const editionById = new Map(editions.map((edition) => [id(edition), edition]));
  const options = [];
  const seen = new Set();

  for (const offer of offers) {
    const listing = listingById.get(id(offer.listingId));
    if (!listing) continue;
    for (const grant of offer.grants || []) {
      if (grant.resourceType !== "item_edition" || grant.capability !== "content.fork") continue;
      const edition = editionById.get(id(grant.resourceId));
      if (!edition) continue;
      const key = `${id(offer)}:${id(edition)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        itemId: edition.itemId,
        editionId: edition._id,
        listingId: listing._id,
        listingTitle: listing.title || "Contenuto Marketplace",
        listingSummary: listing.summary || "",
        sellerType: listing.sellerType,
        sellerId: listing.sellerId,
        offerId: offer._id,
        offerLabel: offer.label || "Offerta",
        pricing: offer.pricing || null,
      });
    }
  }

  return options;
}

module.exports = { listMarketplaceForkOptionsForSubject };
