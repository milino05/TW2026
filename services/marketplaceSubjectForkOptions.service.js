const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const { resolveCapabilitySource } = require("./capabilityAuthorization.service");

function id(value) { return String(value?._id || value?.id || value || ""); }

function offerGrantsNamespaceAuthoring({ offer, namespaceId, namespaceRevisionById }) {
  return (offer.grants || []).some((grant) => {
    if (grant.capability !== "namespace.author") return false;
    if (grant.resourceType === "namespace") return id(grant.resourceId) === id(namespaceId);
    if (grant.resourceType !== "namespace_revision") return false;
    const revision = namespaceRevisionById.get(id(grant.resourceId));
    return Boolean(revision && id(revision.namespaceId) === id(namespaceId));
  });
}

async function principalCanAuthorNamespace({ namespaceId, ownerType, ownerId, actorUserId }) {
  if (!actorUserId) return false;
  try {
    const access = await resolveCapabilitySource({
      actorUserId,
      capability: "namespace.author",
      resourceType: "namespace",
      resourceId: namespaceId,
      principalType: ownerType,
      principalId: ownerId,
    });
    return Boolean(access.allowed);
  } catch (error) {
    if ([403, 404, 409].includes(error?.status)) return false;
    throw error;
  }
}

async function listMarketplaceForkOptionsForSubject({ subjectId, ownerType, ownerId, actorUserId }) {
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
    .select("_id itemId namespaceId")
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

  const namespaceRevisionGrantIds = [...new Set(offers.flatMap((offer) => (offer.grants || [])
    .filter((grant) => grant.capability === "namespace.author" && grant.resourceType === "namespace_revision")
    .map((grant) => id(grant.resourceId))
    .filter(Boolean)))];
  const namespaceRevisions = namespaceRevisionGrantIds.length
    ? await NamespaceRevision.find({
      _id: { $in: namespaceRevisionGrantIds },
      status: { $in: ["published", "superseded"] },
    }).select("_id namespaceId").lean()
    : [];
  const namespaceRevisionById = new Map(namespaceRevisions.map((revision) => [id(revision), revision]));

  const editionById = new Map(editions.map((edition) => [id(edition), edition]));
  const currentNamespaceAccess = new Map();
  const options = [];
  const seen = new Set();

  async function canAuthorNamespace(namespaceId) {
    const key = id(namespaceId);
    if (!currentNamespaceAccess.has(key)) {
      currentNamespaceAccess.set(key, principalCanAuthorNamespace({
        namespaceId,
        ownerType,
        ownerId,
        actorUserId,
      }));
    }
    return currentNamespaceAccess.get(key);
  }

  for (const offer of offers) {
    const listing = listingById.get(id(offer.listingId));
    if (!listing) continue;
    for (const grant of offer.grants || []) {
      if (grant.resourceType !== "item_edition" || grant.capability !== "content.fork") continue;
      const edition = editionById.get(id(grant.resourceId));
      if (!edition) continue;

      const namespaceProvidedByOffer = offerGrantsNamespaceAuthoring({
        offer,
        namespaceId: edition.namespaceId,
        namespaceRevisionById,
      });
      if (!namespaceProvidedByOffer && !await canAuthorNamespace(edition.namespaceId)) continue;

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
