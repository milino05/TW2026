const User = require("../models/user");
const Organization = require("../models/organization.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const { CAPABILITY_DEFINITIONS } = require("../config/marketplaceCapabilities");
const { assertCanActForPrincipal } = require("./principalResolution.service");
const { availablePrincipalProjection, getDistributionDashboard } = require("./marketplaceWorkspaceV2.service");
const { resolveMarketableResource, LIVE_RESOURCE_TYPES } = require("./marketplaceResourceV2.service");
const { capabilityLabel } = require("./marketplaceV2.service");

const ADOPTION_ACTION_LABELS = Object.freeze({
  content_link: "Contenuto usato in una raccolta",
  content_fork: "Contenuto riutilizzato come nuova derivazione",
  namespace_use: "Regole editoriali usate per creare contenuti",
  namespace_fork: "Regole editoriali riutilizzate come nuova derivazione",
  context_reference: "Raccolta editoriale usata come riferimento",
  context_import: "Raccolta editoriale importata",
  context_venue_primary: "Raccolta editoriale usata da una sede",
  visit_copy: "Visita riutilizzata come copia indipendente",
});

function id(value) { return String(value?._id || value || ""); }

function versionPolicyOptions(resourceType) {
  if (LIVE_RESOURCE_TYPES.has(resourceType)) {
    return [
      { code: "follow_current", label: "Include gli aggiornamenti futuri" },
      { code: "pin_at_acquisition", label: "Mantiene la versione acquisita" },
    ];
  }
  return [{ code: "pinned", label: "Versione fissa" }];
}

function capabilityOptions(resourceType) {
  return Object.entries(CAPABILITY_DEFINITIONS)
    .filter(([, resourceTypes]) => resourceTypes.includes(resourceType))
    .map(([code]) => ({ code, label: capabilityLabel(code) }));
}

function revenueFor(acquisitions) {
  const revenueByCurrency = {};
  for (const acquisition of acquisitions) {
    if (acquisition.pricingSnapshot?.type !== "paid") continue;
    const currency = acquisition.pricingSnapshot.currency || "";
    revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + Number(acquisition.pricingSnapshot.amountMinor || 0);
  }
  return revenueByCurrency;
}

async function hydrateDistribution(distribution) {
  const recentSales = distribution?.recentSales || [];
  const recentAdoptions = distribution?.recentAdoptions || [];
  const listingIds = [...new Set(recentSales.map((entry) => id(entry.listingId)).filter(Boolean))];
  const principalRefs = [...recentSales.map((entry) => entry.buyer), ...recentAdoptions.map((entry) => entry.beneficiary)];
  const userIds = [...new Set(principalRefs.filter((entry) => entry?.type === "user").map((entry) => id(entry.id)).filter(Boolean))];
  const organizationIds = [...new Set(principalRefs.filter((entry) => entry?.type === "organization").map((entry) => id(entry.id)).filter(Boolean))];
  const [listings, users, organizations] = await Promise.all([
    listingIds.length ? MarketplaceListing.find({ _id: { $in: listingIds } }).select("title resourceType").lean() : [],
    userIds.length ? User.find({ _id: { $in: userIds } }).select("username").lean() : [],
    organizationIds.length ? Organization.find({ _id: { $in: organizationIds } }).select("name").lean() : [],
  ]);
  const listingById = new Map(listings.map((entry) => [id(entry._id), entry]));
  const userNameById = new Map(users.map((entry) => [id(entry._id), entry.username]));
  const organizationNameById = new Map(organizations.map((entry) => [id(entry._id), entry.name]));
  const principalSummary = (entry) => ({
    type: entry?.type || "user",
    id: entry?.id || null,
    name: entry?.type === "organization"
      ? (organizationNameById.get(id(entry.id)) || "Organizzazione")
      : (userNameById.get(id(entry?.id)) || "Persona"),
  });

  return {
    ...(distribution || {}),
    recentSales: recentSales.map((sale) => {
      const listing = listingById.get(id(sale.listingId));
      return {
        ...sale,
        asset: {
          type: listing?.resourceType || null,
          title: listing?.title || "Risorsa del Marketplace",
        },
        buyer: principalSummary(sale.buyer),
      };
    }),
    recentAdoptions: recentAdoptions.map((adoption) => ({
      ...adoption,
      actionLabel: ADOPTION_ACTION_LABELS[adoption.action] || "Risorsa riutilizzata",
      beneficiary: principalSummary(adoption.beneficiary),
    })),
  };
}

async function getCommercialManagement({ actorUserId, principalType = "user", principalId = actorUserId, page = 1, limit = 10 }) {
  await assertCanActForPrincipal({
    actorUserId,
    principalType,
    principalId,
    minimumOrganizationRole: principalType === "organization" ? "manager" : "operator",
  });
  const availablePrincipals = (await availablePrincipalProjection(actorUserId))
    .filter((entry) => entry.type === "user" || entry.role === "manager");
  const selected = availablePrincipals.find((entry) => entry.type === principalType && id(entry.id) === id(principalId));
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const listingQuery = { sellerType: principalType, sellerId: principalId };
  const [listings, total, rawDistribution] = await Promise.all([
    MarketplaceListing.find(listingQuery).sort({ updatedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    MarketplaceListing.countDocuments(listingQuery),
    getDistributionDashboard({ actorUserId, principalType, principalId, limit: 8 }),
  ]);
  const listingIds = listings.map((entry) => entry._id);
  const [offers, acquisitions] = await Promise.all([
    listingIds.length ? MarketplaceOffer.find({ listingId: { $in: listingIds } }).sort({ createdAt: -1 }).lean() : [],
    listingIds.length ? MarketplaceAcquisition.find({ listingId: { $in: listingIds } }).lean() : [],
  ]);
  const offersByListing = new Map();
  const acquisitionsByListing = new Map();
  const acquisitionsByOffer = new Map();
  for (const offer of offers) {
    const key = id(offer.listingId);
    if (!offersByListing.has(key)) offersByListing.set(key, []);
    offersByListing.get(key).push(offer);
  }
  for (const acquisition of acquisitions) {
    const listingKey = id(acquisition.listingId);
    const offerKey = id(acquisition.offerId);
    if (!acquisitionsByListing.has(listingKey)) acquisitionsByListing.set(listingKey, []);
    if (!acquisitionsByOffer.has(offerKey)) acquisitionsByOffer.set(offerKey, []);
    acquisitionsByListing.get(listingKey).push(acquisition);
    acquisitionsByOffer.get(offerKey).push(acquisition);
  }

  const projectedListings = [];
  for (const listing of listings) {
    let asset = {
      type: listing.resourceType,
      id: listing.resourceId,
      title: listing.title || "Risorsa del Marketplace",
      summary: listing.summary || "",
      editorialLicense: null,
    };
    try {
      const marketable = await resolveMarketableResource({ resourceType: listing.resourceType, resourceId: listing.resourceId });
      asset = { ...marketable.asset, title: listing.title || marketable.asset.title, summary: listing.summary || marketable.asset.summary };
    } catch (error) {
      if (![404, 409].includes(error?.status)) throw error;
    }
    const listingOffers = offersByListing.get(id(listing._id)) || [];
    const listingAcquisitions = acquisitionsByListing.get(id(listing._id)) || [];
    const policyLabels = new Map(versionPolicyOptions(listing.resourceType).map((entry) => [entry.code, entry.label]));
    projectedListings.push({
      id: listing._id,
      status: listing.status,
      asset,
      publishedAt: listing.publishedAt,
      withdrawnAt: listing.withdrawnAt,
      offerConfiguration: {
        resourceRef: { resourceType: listing.resourceType, resourceId: listing.resourceId },
        capabilityOptions: capabilityOptions(listing.resourceType),
        versionPolicyOptions: versionPolicyOptions(listing.resourceType),
        defaultCurrency: "EUR",
      },
      offers: listingOffers.map((offer) => {
        const offerAcquisitions = acquisitionsByOffer.get(id(offer._id)) || [];
        return {
          id: offer._id,
          label: offer.label || "Offerta",
          pricing: offer.pricing,
          status: offer.status,
          grants: (offer.grants || []).map((grant) => ({
            resourceType: grant.resourceType,
            resourceId: grant.resourceId,
            capability: grant.capability,
            label: capabilityLabel(grant.capability),
            versionPolicy: grant.versionPolicy,
            versionBehaviour: {
              code: grant.versionPolicy,
              label: policyLabels.get(grant.versionPolicy) || "Comportamento versione",
            },
          })),
          dependencyIntegrity: offer.dependencyIntegrity,
          acquisitionCount: offerAcquisitions.length,
          revenueByCurrency: revenueFor(offerAcquisitions),
          createdAt: offer.createdAt,
          withdrawnAt: offer.withdrawnAt,
          availableOperations: offer.status === "active"
            ? [{ code: "withdraw_offer", label: "Ritira offerta" }]
            : [],
        };
      }),
      metrics: {
        acquisitionCount: listingAcquisitions.length,
        paidAcquisitionCount: listingAcquisitions.filter((entry) => entry.pricingSnapshot?.type === "paid").length,
        freeAcquisitionCount: listingAcquisitions.filter((entry) => entry.pricingSnapshot?.type === "free").length,
        revenueByCurrency: revenueFor(listingAcquisitions),
      },
      availableOperations: [
        ...(["draft", "published"].includes(listing.status) ? [{ code: "create_offer", label: "Crea offerta" }] : []),
        ...(["draft", "published"].includes(listing.status) ? [{ code: "withdraw_listing", label: "Ritira listing" }] : []),
      ],
    });
  }
  return {
    principal: selected || { type: principalType, id: principalId, name: principalType === "user" ? "Profilo personale" : "Organizzazione" },
    availablePrincipals,
    distribution: await hydrateDistribution(rawDistribution),
    listings: projectedListings,
    page: safePage,
    pageSize: safeLimit,
    total,
  };
}

module.exports = {
  ADOPTION_ACTION_LABELS,
  getCommercialManagement,
  capabilityOptions,
  versionPolicyOptions,
  hydrateDistribution,
};
