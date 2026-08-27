const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const { EXTERNAL_OPERATION_BY_CAPABILITY } = require("./marketplaceWorkspaceV2.service");
const { resolveMarketableResource, resolveResourceAuthority, LIVE_RESOURCE_TYPES } = require("./marketplaceResourceV2.service");
const { projectEditorialWorkflowOperations } = require("./editorialWorkflowOperationsV2.service");

function id(value) { return String(value?._id || value || ""); }
function key(type, value) { return `${type}:${id(value)}`; }

function workflowState(revision) {
  if (!revision) return null;
  return { status: revision.status, integrityStatus: revision.integrity?.status || "needs_review" };
}

function itemState(candidate, listing) {
  if (candidate.workingRevisionId) return "working";
  if (!candidate.publishedRevisionId) return "empty";
  return listing?.status === "published" && Number(listing.activeOfferCount) > 0 ? "published" : "private";
}

function itemWorkflowState(revision, listing) {
  const state = workflowState(revision);
  const publiclyAvailable = listing?.status === "published" && Number(listing.activeOfferCount) > 0;
  return state?.status === "published" && !publiclyAvailable ? { ...state, status: "private" } : state;
}

function ownedOperations({ published, listing, canManageCommerce = true, canEdit = true }) {
  const operations = canEdit ? [{ code: "open_editor", label: "Apri editor" }] : [];
  if (canManageCommerce && published && !listing) operations.push({ code: "create_listing", label: "Configura offerta e pubblica" });
  if (canManageCommerce && listing) operations.push({ code: "manage_distribution", label: "Gestisci distribuzione" });
  return operations;
}

function workflowCapabilities(principal, resourceType) {
  if (principal.type === "user") return { edit: true, review: true, publish: true };
  const permissions = new Set(principal.effectivePermissions || []);
  const prefix = resourceType === "item_edition" ? "item" : resourceType;
  return { edit: permissions.has(`${prefix}.edit`), review: permissions.has(`${prefix}.review`), publish: permissions.has(`${prefix}.publish`) };
}

function withWorkflowOperations({ baseOperations, principal, resourceType, revision }) {
  return [...baseOperations, ...projectEditorialWorkflowOperations({
    ownerType: principal.type,
    capabilities: workflowCapabilities(principal, resourceType),
    revision,
    finalizePrivatelyOnCheck: resourceType === "item_edition",
  })];
}

async function listingMapForCandidates(principal, candidates) {
  if (!candidates.length) return new Map();
  const refs = candidates.map((entry) => ({ resourceType: entry.resourceType, resourceId: entry._id }));
  const listings = await MarketplaceListing.find({
    sellerType: principal.type,
    sellerId: principal.id,
    status: { $in: ["draft", "published"] },
    $or: refs,
  }).lean();
  const offers = listings.length
    ? await MarketplaceOffer.find({ listingId: { $in: listings.map((entry) => entry._id) }, status: "active" }).select("listingId").lean()
    : [];
  const offerCount = new Map();
  for (const offer of offers) offerCount.set(id(offer.listingId), (offerCount.get(id(offer.listingId)) || 0) + 1);
  return new Map(listings.map((listing) => [key(listing.resourceType, listing.resourceId), {
    id: listing._id,
    status: listing.status,
    activeOfferCount: offerCount.get(id(listing._id)) || 0,
  }]));
}

function projectOwnedCandidate(candidate, { principal, listings }) {
  const canManageCommerce = principal.type === "user" || (principal.effectivePermissions || []).includes("marketplace.distribution.manage");
  const capabilities = workflowCapabilities(principal, candidate.resourceType);
  const listing = listings.get(key(candidate.resourceType, candidate._id)) || null;
  if (candidate.resourceType === "item_edition") {
    const revision = candidate.revision || null;
    const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce, canEdit: capabilities.edit });
    return {
      ownership: "owned", resourceType: "item_edition", resourceId: candidate._id,
      sourceRef: { resourceType: "item_edition", resourceId: candidate._id },
      authoringRef: { resourceType: "item", resourceId: candidate.itemId },
      title: revision?.label || "Contenuto", summary: "",
      state: itemState(candidate, listing),
      editorialWorkflow: itemWorkflowState(revision, listing),
      publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "item_revision", resourceId: candidate.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "item_edition", revision }),
    };
  }
  if (candidate.resourceType === "editorial_context") {
    return {
      ownership: "owned", resourceType: "editorial_context", resourceId: candidate._id,
      sourceRef: { resourceType: "editorial_context", resourceId: candidate._id },
      authoringRef: { resourceType: "editorial_context", resourceId: candidate._id },
      title: candidate.displayName, summary: candidate.shortDescription || candidate.description || "",
      state: candidate.publishedReleaseId ? "published" : "working",
      publishedSnapshotRef: candidate.publishedReleaseId ? { resourceType: "editorial_release", resourceId: candidate.publishedReleaseId } : null,
      listing,
      availableOperations: ownedOperations({ published: Boolean(candidate.publishedReleaseId), listing, canManageCommerce, canEdit: capabilities.edit }),
    };
  }
  if (candidate.resourceType === "namespace") {
    const revision = candidate.revision || null;
    const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce, canEdit: capabilities.edit });
    return {
      ownership: "owned", resourceType: "namespace", resourceId: candidate._id,
      sourceRef: { resourceType: "namespace", resourceId: candidate._id },
      authoringRef: { resourceType: "namespace", resourceId: candidate._id },
      title: candidate.name, summary: candidate.description || "",
      state: candidate.workingRevisionId ? "working" : (candidate.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "namespace_revision", resourceId: candidate.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "namespace", revision }),
    };
  }
  const revision = candidate.revision || null;
  const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce, canEdit: capabilities.edit });
  return {
    ownership: "owned", resourceType: "visit", resourceId: candidate._id,
    sourceRef: { resourceType: "visit", resourceId: candidate._id },
    authoringRef: { resourceType: "visit", resourceId: candidate._id },
    title: revision?.title || "Visita", summary: revision?.description || "",
    state: candidate.workingRevisionId ? "working" : (candidate.publishedRevisionId ? "published" : "empty"),
    editorialWorkflow: workflowState(revision),
    publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "visit_revision", resourceId: candidate.publishedRevisionId } : null,
    listing,
    availableOperations: withWorkflowOperations({ baseOperations, principal, resourceType: "visit", revision }),
  };
}

async function actionableRefs(resourceType, resourceId, marketable) {
  if (LIVE_RESOURCE_TYPES.has(resourceType)) return { sourceRef: { resourceType, resourceId }, snapshotRef: marketable.snapshotRef || null };
  const authority = await resolveResourceAuthority(resourceType, resourceId);
  if (!authority) return { sourceRef: null, snapshotRef: { resourceType, resourceId } };
  if (resourceType === "item_revision" && authority.edition) return { sourceRef: { resourceType: "item_edition", resourceId: authority.edition._id }, snapshotRef: { resourceType, resourceId } };
  if (resourceType === "editorial_release" && authority.context) return { sourceRef: { resourceType: "editorial_context", resourceId: authority.context._id }, snapshotRef: { resourceType, resourceId } };
  if (resourceType === "namespace_revision" && authority.aggregate) return { sourceRef: { resourceType: "namespace", resourceId: authority.aggregate._id }, snapshotRef: { resourceType, resourceId } };
  if (resourceType === "visit_revision" && authority.aggregate) return { sourceRef: { resourceType: "visit", resourceId: authority.aggregate._id }, snapshotRef: { resourceType, resourceId } };
  return { sourceRef: null, snapshotRef: { resourceType, resourceId } };
}

async function projectLicensedCandidate(candidate, { skipUnavailable = true } = {}) {
  let marketable;
  try {
    marketable = await resolveMarketableResource({ resourceType: candidate._id.resourceType, resourceId: candidate._id.resourceId });
  } catch (error) {
    if (skipUnavailable && [404, 409].includes(error?.status)) return null;
    throw error;
  }
  const refs = await actionableRefs(candidate._id.resourceType, candidate._id.resourceId, marketable);
  const capabilities = candidate.capabilities || [];
  return {
    ownership: "licensed",
    resourceType: candidate._id.resourceType,
    resourceId: candidate._id.resourceId,
    sourceRef: refs.sourceRef,
    snapshotRef: refs.snapshotRef,
    title: marketable.asset.title,
    summary: marketable.asset.summary || "",
    versionMode: candidate.versionPolicies?.[0] || null,
    capabilities,
    availableOperations: capabilities.map((capability) => ({
      ...EXTERNAL_OPERATION_BY_CAPABILITY[capability], capability, sourceRef: refs.sourceRef, snapshotRef: refs.snapshotRef,
    })).filter((operation) => operation.code),
  };
}

module.exports = {
  listingMapForCandidates,
  projectOwnedCandidate,
  projectLicensedCandidate,
};
