const ContentSpace = require("../models/contentSpace.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const EditorialContext = require("../models/editorialContext.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const Entitlement = require("../models/entitlement.model");
const { Adoption } = require("../models/adoption.model");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { resolveActorPrincipals, assertCanActForPrincipal } = require("./principalResolution.service");
const { resolveMarketableResource, resolveResourceAuthority, LIVE_RESOURCE_TYPES } = require("./marketplaceResourceV2.service");
const { nowWithin } = require("./capabilityAuthorization.service");
const { projectEditorialWorkflowOperations } = require("./editorialWorkflowOperationsV2.service");

function id(value) { return String(value?._id || value || ""); }
function key(type, value) { return `${type}:${id(value)}`; }

const EXTERNAL_OPERATION_BY_CAPABILITY = Object.freeze({
  "content.consume": { code: "content.consume", label: "Fruisci contenuto" },
  "content.use_in_editorial_release": { code: "content.link", label: "Usa in una release editoriale" },
  "content.fork": { code: "content.fork", label: "Crea derivazione" },
  "context.generate": { code: "context.generate", label: "Genera da questo contesto" },
  "context.compose_visit": { code: "context.compose_visit", label: "Usa per comporre una visita" },
  "context.use_as_venue_primary": { code: "context.venue_primary", label: "Usa come contesto principale di una sede" },
  "context.import_snapshot": { code: "context.import_snapshot", label: "Importa snapshot" },
  "namespace.author": { code: "namespace.author", label: "Crea contenuti con questo Namespace" },
  "namespace.fork": { code: "namespace.fork", label: "Crea Namespace derivato" },
  "visit.execute": { code: "visit.execute", label: "Esegui visita" },
  "visit.copy_detached": { code: "visit.copy_detached", label: "Crea copia indipendente" },
});

async function availablePrincipalProjection(actorUserId) {
  const { user, principals } = await resolveActorPrincipals(actorUserId);
  const organizationIds = principals.filter((entry) => entry.type === "organization").map((entry) => entry.id);
  const organizations = organizationIds.length
    ? await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("name").lean()
    : [];
  const nameById = new Map(organizations.map((entry) => [id(entry._id), entry.name]));
  return principals.map((principal) => ({
    type: principal.type,
    id: principal.id,
    name: principal.type === "user" ? user.username : (nameById.get(id(principal.id)) || "Organization"),
    roles: principal.roles,
    isOwner: principal.isOwner,
    effectivePermissions: principal.effectivePermissions,
  }));
}

async function resolveSelectedPrincipal({ actorUserId, principalType = "user", principalId = actorUserId }) {
  await assertCanActForPrincipal({ actorUserId, principalType, principalId });
  const availablePrincipals = await availablePrincipalProjection(actorUserId);
  const selected = availablePrincipals.find((entry) => entry.type === principalType && id(entry.id) === id(principalId));
  if (!selected) throw new AppError("Principal Workspace non disponibile", 403, [{ code: "PRINCIPAL_AUTHORITY_REQUIRED" }]);
  return { selected, availablePrincipals };
}

async function listingMapForPrincipal(principalType, principalId) {
  const listings = await MarketplaceListing.find({
    sellerType: principalType,
    sellerId: principalId,
    status: { $in: ["draft", "published"] },
  }).lean();
  const offers = listings.length
    ? await MarketplaceOffer.find({ listingId: { $in: listings.map((entry) => entry._id) }, status: "active" }).lean()
    : [];
  const offerCount = new Map();
  for (const offer of offers) offerCount.set(id(offer.listingId), (offerCount.get(id(offer.listingId)) || 0) + 1);
  return new Map(listings.map((listing) => [key(listing.resourceType, listing.resourceId), {
    id: listing._id,
    status: listing.status,
    activeOfferCount: offerCount.get(id(listing._id)) || 0,
  }]));
}

function ownedOperations({ published, listing, canManageCommerce = true, canEdit = true }) {
  const operations = canEdit ? [{ code: "open_editor", label: "Apri editor" }] : [];
  if (canManageCommerce && published && !listing) operations.push({ code: "create_listing", label: "Configura offerta e pubblica" });
  if (canManageCommerce && listing) operations.push({ code: "manage_distribution", label: "Gestisci distribuzione" });
  return operations;
}

function workflowState(revision) {
  if (!revision) return null;
  return {
    status: revision.status,
    integrityStatus: revision.integrity?.status || "needs_review",
  };
}

function resourceCapabilities(principal, resourceType) {
  if (principal.type === "user") return { edit: true, review: true, publish: true };
  const permissions = new Set(principal.effectivePermissions || []);
  const prefix = resourceType === "item_edition" ? "item" : resourceType;
  return {
    edit: permissions.has(`${prefix}.edit`),
    review: permissions.has(`${prefix}.review`),
    publish: permissions.has(`${prefix}.publish`),
  };
}

function withWorkflowOperations({ baseOperations, principal, resourceType, revision }) {
  return [
    ...baseOperations,
    ...projectEditorialWorkflowOperations({ ownerType: principal.type, capabilities: resourceCapabilities(principal, resourceType), revision }),
  ];
}

async function projectOwnedAssets({ principal, listings }) {
  const principalType = principal.type;
  const principalId = principal.id;
  const permissions = new Set(principal.effectivePermissions || []);
  const can = (code) => principalType === "user" || permissions.has(code);
  const canManageCommerce = can("marketplace.distribution.manage");
  const spaces = await ContentSpace.find({ ownerType: principalType, ownerId: principalId, lifecycleStatus: "active" }).sort({ name: 1 }).lean();
  const items = await ItemV2.find({ ownerType: principalType, ownerId: principalId, lifecycleStatus: "active" }).select("_id primarySubjectId").lean();
  const editions = items.length ? await ItemEdition.find({ itemId: { $in: items.map((entry) => entry._id) } }).lean() : [];
  const editionRevisionIds = editions.flatMap((entry) => [entry.workingRevisionId, entry.publishedRevisionId]).filter(Boolean);
  const itemRevisions = editionRevisionIds.length
    ? await ItemRevisionV2.find({ _id: { $in: editionRevisionIds } }).select("label status version integrity.status").lean()
    : [];
  const itemRevisionById = new Map(itemRevisions.map((entry) => [id(entry._id), entry]));

  const contexts = spaces.length
    ? await EditorialContext.find({ contentSpaceId: { $in: spaces.map((entry) => entry._id) }, lifecycleStatus: "active" }).sort({ displayName: 1 }).lean()
    : [];
  const namespaces = await Namespace.find({ ownerType: principalType, ownerId: principalId, lifecycleStatus: "active" }).sort({ name: 1 }).lean();
  const namespaceRevisionIds = namespaces.flatMap((entry) => [entry.workingRevisionId, entry.publishedRevisionId]).filter(Boolean);
  const namespaceRevisions = namespaceRevisionIds.length
    ? await NamespaceRevision.find({ _id: { $in: namespaceRevisionIds } }).select("status version integrity.status").lean()
    : [];
  const namespaceRevisionById = new Map(namespaceRevisions.map((entry) => [id(entry._id), entry]));

  const visits = await VisitV2.find({ ownerType: principalType, ownerId: principalId, lifecycleStatus: "active" }).lean();
  const visitRevisionIds = visits.flatMap((entry) => [entry.workingRevisionId, entry.publishedRevisionId]).filter(Boolean);
  const visitRevisions = visitRevisionIds.length
    ? await VisitRevisionV2.find({ _id: { $in: visitRevisionIds } }).select("title description status version integrity.status").lean()
    : [];
  const visitRevisionById = new Map(visitRevisions.map((entry) => [id(entry._id), entry]));

  const assets = [];
  for (const edition of editions) {
    if (!can("item.view")) continue;
    const revision = itemRevisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId));
    const listing = listings.get(key("item_edition", edition._id)) || null;
    const baseOperations = ownedOperations({ published: Boolean(edition.publishedRevisionId), listing, canManageCommerce, canEdit: can("item.edit") });
    assets.push({
      ownership: "owned",
      resourceType: "item_edition",
      resourceId: edition._id,
      sourceRef: { resourceType: "item_edition", resourceId: edition._id },
      authoringRef: { resourceType: "item", resourceId: edition.itemId },
      title: revision?.label || "Contenuto",
      state: edition.workingRevisionId ? "working" : (edition.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: edition.publishedRevisionId ? { resourceType: "item_revision", resourceId: edition.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "item_edition", revision }),
    });
  }
  for (const context of contexts) {
    if (!can("editorial_context.view")) continue;
    const listing = listings.get(key("editorial_context", context._id)) || null;
    assets.push({
      ownership: "owned",
      resourceType: "editorial_context",
      resourceId: context._id,
      sourceRef: { resourceType: "editorial_context", resourceId: context._id },
      authoringRef: { resourceType: "editorial_context", resourceId: context._id },
      title: context.displayName,
      state: context.publishedReleaseId ? "published" : "working",
      publishedSnapshotRef: context.publishedReleaseId ? { resourceType: "editorial_release", resourceId: context.publishedReleaseId } : null,
      listing,
      availableOperations: ownedOperations({ published: Boolean(context.publishedReleaseId), listing, canManageCommerce, canEdit: can("editorial_context.edit") }),
    });
  }
  for (const namespace of namespaces) {
    if (!can("namespace.view")) continue;
    const revision = namespaceRevisionById.get(id(namespace.workingRevisionId || namespace.publishedRevisionId));
    const listing = listings.get(key("namespace", namespace._id)) || null;
    const baseOperations = ownedOperations({ published: Boolean(namespace.publishedRevisionId), listing, canManageCommerce, canEdit: can("namespace.edit") });
    assets.push({
      ownership: "owned",
      resourceType: "namespace",
      resourceId: namespace._id,
      sourceRef: { resourceType: "namespace", resourceId: namespace._id },
      authoringRef: { resourceType: "namespace", resourceId: namespace._id },
      title: namespace.name,
      state: namespace.workingRevisionId ? "working" : (namespace.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: namespace.publishedRevisionId ? { resourceType: "namespace_revision", resourceId: namespace.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "namespace", revision }),
    });
  }
  for (const visit of visits) {
    if (!can("visit.view")) continue;
    const revision = visitRevisionById.get(id(visit.workingRevisionId || visit.publishedRevisionId));
    const listing = listings.get(key("visit", visit._id)) || null;
    const baseOperations = ownedOperations({ published: Boolean(visit.publishedRevisionId), listing, canManageCommerce, canEdit: can("visit.edit") });
    assets.push({
      ownership: "owned",
      resourceType: "visit",
      resourceId: visit._id,
      sourceRef: { resourceType: "visit", resourceId: visit._id },
      authoringRef: { resourceType: "visit", resourceId: visit._id },
      title: revision?.title || "Visita",
      summary: revision?.description || "",
      state: visit.workingRevisionId ? "working" : (visit.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: visit.publishedRevisionId ? { resourceType: "visit_revision", resourceId: visit.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "visit", revision }),
    });
  }
  return {
    contentSpaces: can("editorial_space.view") ? spaces.map((space) => ({ id: space._id, name: space.name, description: space.description || "" })) : [],
    assets,
  };
}

async function actionableRefs(resourceType, resourceId, marketable) {
  if (LIVE_RESOURCE_TYPES.has(resourceType)) {
    return {
      sourceRef: { resourceType, resourceId },
      snapshotRef: marketable.snapshotRef || null,
    };
  }
  const authority = await resolveResourceAuthority(resourceType, resourceId);
  if (!authority) return { sourceRef: null, snapshotRef: { resourceType, resourceId } };
  if (resourceType === "item_revision" && authority.edition) {
    return { sourceRef: { resourceType: "item_edition", resourceId: authority.edition._id }, snapshotRef: { resourceType, resourceId } };
  }
  if (resourceType === "editorial_release" && authority.context) {
    return { sourceRef: { resourceType: "editorial_context", resourceId: authority.context._id }, snapshotRef: { resourceType, resourceId } };
  }
  if (resourceType === "namespace_revision" && authority.aggregate) {
    return { sourceRef: { resourceType: "namespace", resourceId: authority.aggregate._id }, snapshotRef: { resourceType, resourceId } };
  }
  if (resourceType === "visit_revision" && authority.aggregate) {
    return { sourceRef: { resourceType: "visit", resourceId: authority.aggregate._id }, snapshotRef: { resourceType, resourceId } };
  }
  return { sourceRef: null, snapshotRef: { resourceType, resourceId } };
}

async function projectLicensedAssets({ principalType, principalId }) {
  const entitlements = await Entitlement.find({
    beneficiaryType: principalType,
    beneficiaryId: principalId,
    status: "active",
  }).sort({ createdAt: -1 }).lean();
  const active = entitlements.filter((entry) => nowWithin(entry));
  const grouped = new Map();
  for (const entitlement of active) {
    const resourceKey = key(entitlement.resourceType, entitlement.resourceId);
    if (!grouped.has(resourceKey)) grouped.set(resourceKey, []);
    grouped.get(resourceKey).push(entitlement);
  }
  const assets = [];
  for (const entries of grouped.values()) {
    const first = entries[0];
    let marketable;
    try {
      marketable = await resolveMarketableResource({ resourceType: first.resourceType, resourceId: first.resourceId });
    } catch (error) {
      if ([404, 409].includes(error?.status)) continue;
      throw error;
    }
    const refs = await actionableRefs(first.resourceType, first.resourceId, marketable);
    const capabilities = [...new Set(entries.map((entry) => entry.capability))];
    assets.push({
      ownership: "licensed",
      resourceType: first.resourceType,
      resourceId: first.resourceId,
      sourceRef: refs.sourceRef,
      snapshotRef: refs.snapshotRef,
      title: marketable.asset.title,
      summary: marketable.asset.summary || "",
      versionMode: first.versionPolicy,
      capabilities,
      availableOperations: capabilities.map((capability) => ({
        ...EXTERNAL_OPERATION_BY_CAPABILITY[capability],
        capability,
        sourceRef: refs.sourceRef,
        snapshotRef: refs.snapshotRef,
      })).filter((operation) => operation.code),
    });
  }
  return assets;
}

async function getCreatorWorkspace({ actorUserId, principalType = "user", principalId = actorUserId }) {
  const { selected, availablePrincipals } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const canViewDistribution = selected.type === "user" || selected.effectivePermissions.includes("marketplace.distribution.view");
  const listings = canViewDistribution ? await listingMapForPrincipal(selected.type, selected.id) : new Map();
  const [owned, licensedAssets] = await Promise.all([
    projectOwnedAssets({ principal: selected, listings }),
    projectLicensedAssets({ principalType: selected.type, principalId: selected.id }),
  ]);
  return {
    principal: selected,
    availablePrincipals,
    contentSpaces: owned.contentSpaces,
    ownedAssets: owned.assets,
    licensedAssets,
  };
}

async function getDistributionDashboard({ actorUserId, principalType = "user", principalId = actorUserId, limit = 20 }) {
  const { selected } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const permissions = new Set(selected.effectivePermissions || []);
  if (selected.type === "organization" && !permissions.has("marketplace.distribution.view")) {
    throw new AppError("Non disponi del permesso richiesto", 403, [{ code: "ORGANIZATION_PERMISSION_REQUIRED", permissionCode: "marketplace.distribution.view" }]);
  }
  const financeVisible = selected.type === "user" || permissions.has("marketplace.finance.view");
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const [listings, sales] = await Promise.all([
    MarketplaceListing.find({ sellerType: principalType, sellerId: principalId }).lean(),
    MarketplaceAcquisition.find({ sellerType: principalType, sellerId: principalId }).sort({ acquiredAt: -1 }).lean(),
  ]);
  const publishedListingIds = listings.filter((entry) => entry.status === "published").map((entry) => entry._id);
  const offers = publishedListingIds.length ? await MarketplaceOffer.find({ listingId: { $in: publishedListingIds } }).lean() : [];
  const activeListingIds = new Set(offers.filter((entry) => entry.status === "active").map((entry) => id(entry.listingId)));
  const saleIds = sales.map((entry) => entry._id);
  const entitlements = saleIds.length ? await Entitlement.find({ sourceAcquisitionId: { $in: saleIds } }).select("_id sourceAcquisitionId").lean() : [];
  const entitlementIds = entitlements.map((entry) => entry._id);
  const adoptions = entitlementIds.length
    ? await Adoption.find({ entitlementId: { $in: entitlementIds } }).sort({ adoptedAt: -1 }).lean()
    : [];
  const revenueByCurrency = {};
  if (financeVisible) {
    for (const sale of sales) {
      if (sale.pricingSnapshot?.type !== "paid") continue;
      const currency = sale.pricingSnapshot.currency || "";
      revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + Number(sale.pricingSnapshot.amountMinor || 0);
    }
  }
  const uniqueBuyers = new Set(sales.map((sale) => key(sale.buyerType, sale.buyerId)));
  const uniqueAdopters = new Set(adoptions.map((adoption) => key(adoption.beneficiaryType, adoption.beneficiaryId)));
  return {
    principal: { type: principalType, id: principalId },
    capabilities: { financeView: financeVisible },
    summary: {
      listingCount: listings.length,
      publishedListingCount: listings.filter((entry) => entry.status === "published" && activeListingIds.has(id(entry._id))).length,
      activeOfferCount: offers.filter((entry) => entry.status === "active").length,
      salesCount: sales.length,
      uniqueBuyers: uniqueBuyers.size,
      adoptionCount: adoptions.length,
      uniqueAdopters: uniqueAdopters.size,
      ...(financeVisible ? {
        paidSalesCount: sales.filter((entry) => entry.pricingSnapshot?.type === "paid").length,
        freeAcquisitionCount: sales.filter((entry) => entry.pricingSnapshot?.type === "free").length,
        revenueByCurrency,
      } : {}),
    },
    recentSales: sales.slice(0, safeLimit).map((sale) => ({
      id: sale._id,
      listingId: sale.listingId,
      offerId: sale.offerId,
      buyer: { type: sale.buyerType, id: sale.buyerId },
      ...(financeVisible ? { pricing: sale.pricingSnapshot } : {}),
      acquiredAt: sale.acquiredAt,
    })),
    recentAdoptions: adoptions.slice(0, safeLimit).map((adoption) => ({
      id: adoption._id,
      action: adoption.action,
      beneficiary: { type: adoption.beneficiaryType, id: adoption.beneficiaryId },
      sourceResourceType: adoption.sourceResourceRef.resourceType,
      adoptedAt: adoption.adoptedAt,
    })),
  };
}

module.exports = {
  EXTERNAL_OPERATION_BY_CAPABILITY,
  availablePrincipalProjection,
  resolveSelectedPrincipal,
  getCreatorWorkspace,
  getDistributionDashboard,
};
