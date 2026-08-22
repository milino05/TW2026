const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const Entitlement = require("../models/entitlement.model");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const {
  RESOURCE_TYPES,
  capabilitySupportsResource,
} = require("../config/marketplaceCapabilities");
const { assertCanActForPrincipal } = require("./principalResolution.service");
const { resolveCapabilityAccess } = require("./capabilityAuthorization.service");
const {
  resolveMarketableResource,
  LIVE_RESOURCE_TYPES,
  SNAPSHOT_RESOURCE_TYPES,
} = require("./marketplaceResourceV2.service");

const CAPABILITY_LABELS = Object.freeze({
  "content.consume": "Fruisci il contenuto",
  "content.use_in_editorial_release": "Usa in una release editoriale",
  "content.fork": "Crea una derivazione del contenuto",
  "context.generate": "Genera visite da questo contesto",
  "context.compose_visit": "Usa il contesto per comporre visite",
  "context.use_as_venue_primary": "Usa come contesto principale di una sede",
  "context.import_snapshot": "Importa uno snapshot editoriale",
  "namespace.author": "Crea contenuti con questo Namespace",
  "namespace.fork": "Crea un Namespace derivato",
  "visit.execute": "Esegui questa visita",
  "visit.copy_detached": "Crea una copia indipendente della visita",
});

function id(value) { return String(value?._id || value || ""); }
function clampLimit(value) { return Math.min(50, Math.max(1, Number(value) || 20)); }
function capabilityLabel(capability) { return CAPABILITY_LABELS[capability] || capability; }
function samePrincipal(typeA, idA, typeB, idB) { return typeA === typeB && id(idA) === id(idB); }

function normalizePricing(payload = {}) {
  const type = payload.type || "free";
  if (type === "free") return { type: "free", amountMinor: 0, currency: null };
  if (type !== "paid") {
    throw new AppError("Tipo di prezzo non supportato", 400, [{ field: "pricing.type", code: "INVALID_ENUM" }]);
  }
  const amountMinor = Number(payload.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new AppError("amountMinor deve essere un intero non negativo", 400, [{ field: "pricing.amountMinor", code: "INVALID_NUMBER" }]);
  }
  const currency = String(payload.currency || "").trim().toUpperCase();
  if (!currency) throw new AppError("currency e obbligatoria per un prezzo paid", 400, [{ field: "pricing.currency", code: "REQUIRED" }]);
  return { type: "paid", amountMinor, currency };
}

function normalizeResourceTypes(values) {
  if (!values) return null;
  const list = Array.isArray(values) ? values : String(values).split(",");
  const normalized = [...new Set(list.map((value) => String(value).trim()).filter(Boolean))];
  const invalid = normalized.filter((value) => !RESOURCE_TYPES.includes(value));
  if (invalid.length) throw new AppError("resourceTypes contiene valori non supportati", 400, [{ field: "resourceTypes", code: "INVALID_ENUM", context: { invalid } }]);
  return normalized.length ? normalized : null;
}

async function sellerSummary(listing) {
  if (listing.sellerType === "organization") {
    const organization = await Organization.findById(listing.sellerId).select("name lifecycleStatus").lean();
    return { type: "organization", id: listing.sellerId, name: organization?.name || "Organization" };
  }
  const user = await User.findById(listing.sellerId).select("username status").lean();
  return { type: "user", id: listing.sellerId, name: user?.username || "Autore" };
}

async function assertSellerOwnsMarketableResource({ resourceType, resourceId, sellerType, sellerId, actorUserId }) {
  await assertCanActForPrincipal({
    actorUserId,
    principalType: sellerType,
    principalId: sellerId,
    minimumOrganizationRole: sellerType === "organization" ? "manager" : "operator",
  });
  const marketable = await resolveMarketableResource({ resourceType, resourceId });
  if (!samePrincipal(marketable.ownerType, marketable.ownerId, sellerType, sellerId)) {
    throw new AppError("Il seller deve possedere la risorsa Marketplace", 403, [{ code: "SELLER_RESOURCE_AUTHORITY_REQUIRED" }]);
  }
  return marketable;
}

async function createListing({ resourceType, resourceId, sellerType, sellerId, actorUserId, metadata = {} }) {
  const marketable = await assertSellerOwnsMarketableResource({ resourceType, resourceId, sellerType, sellerId, actorUserId });
  const existing = await MarketplaceListing.findOne({
    resourceType,
    resourceId,
    sellerType,
    sellerId,
    status: { $in: ["draft", "published"] },
  });
  if (existing) return existing;
  return MarketplaceListing.create({
    sellerType,
    sellerId,
    resourceType,
    resourceId,
    title: String(metadata.title ?? marketable.asset.title ?? "").trim(),
    summary: String(metadata.summary ?? marketable.asset.summary ?? "").trim(),
    catalogMetadata: metadata.catalogMetadata || null,
    status: "published",
    publishedAt: new Date(),
    createdBy: actorUserId,
  });
}

function assertGrantPolicy({ grant, marketable, index }) {
  if (!capabilitySupportsResource(grant.capability, grant.resourceType)) {
    throw new AppError("Capability non compatibile con la risorsa", 400, [{ field: `grants[${index}].capability`, code: "INVALID_CAPABILITY_RESOURCE" }]);
  }
  if (LIVE_RESOURCE_TYPES.has(grant.resourceType)) {
    if (!["follow_current", "pin_at_acquisition"].includes(grant.versionPolicy)) {
      throw new AppError("Version policy non valida per una risorsa live", 400, [{ field: `grants[${index}].versionPolicy`, code: "INVALID_ENUM" }]);
    }
  } else if (SNAPSHOT_RESOURCE_TYPES.has(grant.resourceType)) {
    if (grant.versionPolicy !== "pinned") {
      throw new AppError("Uno snapshot Marketplace deve usare versionPolicy pinned", 400, [{ field: `grants[${index}].versionPolicy`, code: "INVALID_ENUM" }]);
    }
  }
  if (!marketable.snapshotRef) throw new AppError("Snapshot del grant non disponibile", 409, [{ code: "PINNED_SNAPSHOT_UNAVAILABLE" }]);
}

async function validateOfferGrants({ listing, grants, actorUserId }) {
  if (!Array.isArray(grants) || !grants.length) {
    throw new AppError("Un Offer richiede almeno un grant", 400, [{ field: "grants", code: "REQUIRED" }]);
  }
  const validated = [];
  for (let index = 0; index < grants.length; index += 1) {
    const raw = grants[index] || {};
    const grant = {
      resourceType: String(raw.resourceType || "").trim(),
      resourceId: raw.resourceId,
      capability: String(raw.capability || "").trim(),
      versionPolicy: String(raw.versionPolicy || "").trim(),
    };
    const marketable = await assertSellerOwnsMarketableResource({
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      sellerType: listing.sellerType,
      sellerId: listing.sellerId,
      actorUserId,
    });
    assertGrantPolicy({ grant, marketable, index });
    validated.push({ grant, marketable });
  }
  return validated;
}

async function createOffer({ listingId, payload = {}, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, status: "published" }).lean();
  if (!listing) throw new AppError("MarketplaceListing pubblicata non disponibile", 404);
  await assertCanActForPrincipal({
    actorUserId,
    principalType: listing.sellerType,
    principalId: listing.sellerId,
    minimumOrganizationRole: listing.sellerType === "organization" ? "manager" : "operator",
  });
  const validated = await validateOfferGrants({ listing, grants: payload.grants, actorUserId });
  return MarketplaceOffer.create({
    listingId: listing._id,
    label: String(payload.label || "").trim(),
    pricing: normalizePricing(payload.pricing || {}),
    grants: validated.map((entry) => entry.grant),
    status: "active",
    createdBy: actorUserId,
  });
}

async function resolveGrantAtAcquisition(grant) {
  const marketable = await resolveMarketableResource({ resourceType: grant.resourceType, resourceId: grant.resourceId });
  assertGrantPolicy({ grant, marketable, index: 0 });
  const resolvedSnapshotRef = marketable.snapshotRef;
  if (grant.versionPolicy === "pin_at_acquisition") {
    if (!capabilitySupportsResource(grant.capability, resolvedSnapshotRef.resourceType)) {
      throw new AppError("La capability non e compatibile con lo snapshot risolto", 409, [{ code: "PINNED_SNAPSHOT_CAPABILITY_MISMATCH" }]);
    }
    return {
      grantSnapshot: { ...grant, resolvedSnapshotRef },
      entitlement: {
        resourceType: resolvedSnapshotRef.resourceType,
        resourceId: resolvedSnapshotRef.resourceId,
        capability: grant.capability,
        versionPolicy: "pinned",
        baselineSnapshotRef: resolvedSnapshotRef,
      },
    };
  }
  if (grant.versionPolicy === "pinned") {
    return {
      grantSnapshot: { ...grant, resolvedSnapshotRef },
      entitlement: {
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
        capability: grant.capability,
        versionPolicy: "pinned",
        baselineSnapshotRef: resolvedSnapshotRef,
      },
    };
  }
  return {
    grantSnapshot: { ...grant, resolvedSnapshotRef },
    entitlement: {
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      capability: grant.capability,
      versionPolicy: "follow_current",
      baselineSnapshotRef: resolvedSnapshotRef,
    },
  };
}

async function acquireOffer({ offerId, actorUserId, beneficiaryType = "user", beneficiaryId = actorUserId }) {
  await assertCanActForPrincipal({ actorUserId, principalType: beneficiaryType, principalId: beneficiaryId });
  const offer = await MarketplaceOffer.findOne({ _id: offerId, status: "active" }).lean();
  if (!offer) throw new AppError("MarketplaceOffer non disponibile", 404);
  const listing = await MarketplaceListing.findOne({ _id: offer.listingId, status: "published" }).lean();
  if (!listing) throw new AppError("MarketplaceListing pubblicata non disponibile", 409);

  const existing = await MarketplaceAcquisition.findOne({ offerId: offer._id, buyerType: beneficiaryType, buyerId: beneficiaryId }).lean();
  if (existing) {
    const entitlements = await Entitlement.find({ sourceAcquisitionId: existing._id }).lean();
    return { acquisition: existing, entitlements, alreadyAcquired: true };
  }

  const resolved = [];
  for (const grant of offer.grants || []) resolved.push(await resolveGrantAtAcquisition(grant));

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
      grantSnapshots: resolved.map((entry) => entry.grantSnapshot),
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
    for (const entry of resolved) {
      entitlements.push(await Entitlement.create({
        beneficiaryType,
        beneficiaryId,
        sourceAcquisitionId: acquisition._id,
        ...entry.entitlement,
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
  if (versionPolicy === "pin_at_acquisition") return { code: "pinned_at_acquisition", label: "Mantiene la versione acquisita" };
  return { code: "pinned", label: "Versione fissa" };
}

async function viewerCapabilities({ actorUserId, offers }) {
  const capabilities = new Set();
  for (const offer of offers || []) {
    for (const grant of offer.grants || []) {
      const access = await resolveCapabilityAccess({
        actorUserId,
        capability: grant.capability,
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
      });
      if (access.allowed) capabilities.add(grant.capability);
      if (!access.allowed && grant.versionPolicy === "pin_at_acquisition") {
        const marketable = await resolveMarketableResource({ resourceType: grant.resourceType, resourceId: grant.resourceId });
        const snapshotAccess = await resolveCapabilityAccess({
          actorUserId,
          capability: grant.capability,
          resourceType: marketable.snapshotRef.resourceType,
          resourceId: marketable.snapshotRef.resourceId,
        });
        if (snapshotAccess.allowed) capabilities.add(grant.capability);
      }
    }
  }
  return [...capabilities];
}

async function projectCatalogListing({ listing, actorUserId }) {
  let marketable;
  try {
    marketable = await resolveMarketableResource({ resourceType: listing.resourceType, resourceId: listing.resourceId });
  } catch (error) {
    if ([404, 409].includes(error?.status)) return null;
    throw error;
  }
  const [offers, publisher] = await Promise.all([
    MarketplaceOffer.find({ listingId: listing._id, status: "active" }).sort({ createdAt: 1 }).lean(),
    sellerSummary(listing),
  ]);
  if (!offers.length) return null;
  const availableCapabilities = await viewerCapabilities({ actorUserId, offers });
  return {
    listingId: listing._id,
    asset: {
      ...marketable.asset,
      title: listing.title || marketable.asset.title,
      summary: listing.summary || marketable.asset.summary,
      publisher,
      catalogMetadata: listing.catalogMetadata || null,
    },
    offers: offers.map((offer) => ({
      id: offer._id,
      label: offer.label || "Offerta",
      pricing: offer.pricing,
      uses: (offer.grants || []).map((grant) => ({
        capability: grant.capability,
        label: capabilityLabel(grant.capability),
        resourceType: grant.resourceType,
      })),
      versionBehaviour: [...new Set((offer.grants || []).map((grant) => versionBehaviour(grant.versionPolicy).code))].length === 1
        ? versionBehaviour(offer.grants[0]?.versionPolicy)
        : { code: "mixed", label: "Politiche di versione miste" },
    })),
    viewerState: {
      availableCapabilities,
      alreadyUsable: availableCapabilities.length > 0,
    },
  };
}

async function listCatalog({ actorUserId, page = 1, limit = 20, queryText = "", resourceTypes = null, sellerType = null, sellerId = null }) {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);
  const types = normalizeResourceTypes(resourceTypes);
  const query = { status: "published" };
  if (types) query.resourceType = { $in: types };
  if (sellerType) query.sellerType = sellerType;
  if (sellerId) query.sellerId = sellerId;
  const text = String(queryText || "").trim();
  if (text) query.$text = { $search: text };
  const sort = text ? { score: { $meta: "textScore" }, updatedAt: -1 } : { updatedAt: -1 };
  const projection = text ? { score: { $meta: "textScore" } } : null;
  const listingQuery = MarketplaceListing.find(query, projection).sort(sort).skip((safePage - 1) * safeLimit).limit(safeLimit).lean();
  const [listings, total] = await Promise.all([listingQuery, MarketplaceListing.countDocuments(query)]);
  const results = [];
  for (const listing of listings) {
    const projected = await projectCatalogListing({ listing, actorUserId });
    if (projected) results.push(projected);
  }
  return { results, page: safePage, pageSize: safeLimit, total };
}

async function getListingDetail({ listingId, actorUserId }) {
  const listing = await MarketplaceListing.findOne({ _id: listingId, status: "published" }).lean();
  if (!listing) throw new AppError("MarketplaceListing non disponibile", 404);
  const projected = await projectCatalogListing({ listing, actorUserId });
  if (!projected) throw new AppError("La risorsa del Listing non e disponibile", 409);
  return projected;
}

async function listAcquisitionHistory({ actorUserId, beneficiaryType = "user", beneficiaryId = actorUserId, page = 1, limit = 20 }) {
  await assertCanActForPrincipal({ actorUserId, principalType: beneficiaryType, principalId: beneficiaryId });
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);
  const query = { buyerType: beneficiaryType, buyerId: beneficiaryId };
  const [entries, total] = await Promise.all([
    MarketplaceAcquisition.find(query).sort({ acquiredAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    MarketplaceAcquisition.countDocuments(query),
  ]);
  return {
    results: entries.map((entry) => ({
      id: entry._id,
      listingId: entry.listingId,
      offerId: entry.offerId,
      pricing: entry.pricingSnapshot,
      grants: entry.grantSnapshots.map((grant) => ({
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
        capability: grant.capability,
        versionPolicy: grant.versionPolicy,
        resolvedSnapshotRef: grant.resolvedSnapshotRef,
      })),
      acquiredAt: entry.acquiredAt,
    })),
    page: safePage,
    pageSize: safeLimit,
    total,
  };
}

module.exports = {
  capabilityLabel,
  normalizePricing,
  createListing,
  createOffer,
  acquireOffer,
  projectCatalogListing,
  listCatalog,
  getListingDetail,
  listAcquisitionHistory,
};
