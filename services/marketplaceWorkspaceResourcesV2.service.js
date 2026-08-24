const ContentSpace = require("../models/contentSpace.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const EditorialContext = require("../models/editorialContext.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Entitlement = require("../models/entitlement.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const { resolveSelectedPrincipal, EXTERNAL_OPERATION_BY_CAPABILITY } = require("./marketplaceWorkspaceV2.service");
const { resolveMarketableResource, resolveResourceAuthority, LIVE_RESOURCE_TYPES } = require("./marketplaceResourceV2.service");
const { projectEditorialWorkflowOperations } = require("./editorialWorkflowOperationsV2.service");

const OWNED_RESOURCE_TYPES = ["item_edition", "editorial_context", "namespace", "visit"];

function id(value) { return String(value?._id || value || ""); }
function key(type, value) { return `${type}:${id(value)}`; }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function workflowState(revision) {
  if (!revision) return null;
  return { status: revision.status, integrityStatus: revision.integrity?.status || "needs_review" };
}
function pagination(page, limit) {
  return {
    page: Math.max(1, Number(page) || 1),
    pageSize: Math.min(50, Math.max(5, Number(limit) || 12)),
  };
}
function normalizeTypes(resourceTypes, allowed = null) {
  const values = Array.isArray(resourceTypes) ? resourceTypes : String(resourceTypes || "").split(",");
  const normalized = [...new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean))];
  return allowed ? normalized.filter((entry) => allowed.includes(entry)) : normalized;
}
function ownedOperations({ published, listing, canManageCommerce = true }) {
  const operations = [{ code: "open_editor", label: "Apri editor" }];
  if (canManageCommerce && published && !listing) operations.push({ code: "create_listing", label: "Pubblica nel Marketplace" });
  if (canManageCommerce && listing) operations.push({ code: "manage_distribution", label: "Gestisci distribuzione" });
  return operations;
}
function withWorkflowOperations({ baseOperations, principalType, actorRole, revision }) {
  return [...baseOperations, ...projectEditorialWorkflowOperations({ ownerType: principalType, actorRole, revision })];
}

async function getCreatorWorkspaceContext({ actorUserId, principalType = "user", principalId = actorUserId }) {
  const { selected, availablePrincipals } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const spaces = await ContentSpace.find({
    ownerType: selected.type,
    ownerId: selected.id,
    lifecycleStatus: "active",
  }).sort({ name: 1 }).select("name description").lean();
  return {
    principal: selected,
    availablePrincipals,
    contentSpaces: spaces.map((space) => ({ id: space._id, name: space.name, description: space.description || "" })),
  };
}

async function facetCandidates(Model, pipeline, { windowSize }) {
  const [result] = await Model.aggregate([
    ...pipeline,
    { $sort: { updatedAt: -1, _id: -1 } },
    {
      $facet: {
        results: [{ $limit: windowSize }],
        total: [{ $count: "value" }],
      },
    },
  ]);
  return { results: result?.results || [], total: Number(result?.total?.[0]?.value || 0) };
}

async function itemCandidates({ principal, q, windowSize }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [
    { $lookup: { from: ItemV2.collection.name, localField: "itemId", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $match: { "item.ownerType": principal.type, "item.ownerId": principal.id, "item.lifecycleStatus": "active" } },
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: ItemRevisionV2.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
  ];
  if (regex) pipeline.push({ $match: { $or: [{ "revision.label": regex }, { "revision.tags": regex }, { "revision.authorCredits": regex }] } });
  pipeline.push({ $project: { _id: 1, itemId: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "item_edition" } } });
  return facetCandidates(ItemEdition, pipeline, { windowSize });
}

async function contextCandidates({ principal, q, windowSize }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [
    { $lookup: { from: ContentSpace.collection.name, localField: "contentSpaceId", foreignField: "_id", as: "space" } },
    { $unwind: "$space" },
    { $match: { "space.ownerType": principal.type, "space.ownerId": principal.id, "space.lifecycleStatus": "active", lifecycleStatus: "active" } },
  ];
  if (regex) pipeline.push({ $match: { $or: [{ displayName: regex }, { shortDescription: regex }, { description: regex }] } });
  pipeline.push({ $project: { _id: 1, displayName: 1, shortDescription: 1, description: 1, publishedReleaseId: 1, updatedAt: 1, resourceType: { $literal: "editorial_context" } } });
  return facetCandidates(EditorialContext, pipeline, { windowSize });
}

async function namespaceCandidates({ principal, q, windowSize }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [
    { $match: { ownerType: principal.type, ownerId: principal.id, lifecycleStatus: "active" } },
  ];
  if (regex) pipeline.push({ $match: { $or: [{ name: regex }, { description: regex }] } });
  pipeline.push(
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: NamespaceRevision.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
    { $project: { _id: 1, name: 1, description: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "namespace" } } },
  );
  return facetCandidates(Namespace, pipeline, { windowSize });
}

async function visitCandidates({ principal, q, windowSize }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [
    { $match: { ownerType: principal.type, ownerId: principal.id, lifecycleStatus: "active" } },
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: VisitRevisionV2.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
  ];
  if (regex) pipeline.push({ $match: { $or: [{ "revision.title": regex }, { "revision.description": regex }] } });
  pipeline.push({ $project: { _id: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "visit" } } });
  return facetCandidates(VisitV2, pipeline, { windowSize });
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

function projectOwnedCandidate(candidate, { principal, actorRole, listings }) {
  const canManageCommerce = principal.type === "user" || actorRole === "manager";
  const listing = listings.get(key(candidate.resourceType, candidate._id)) || null;
  if (candidate.resourceType === "item_edition") {
    const revision = candidate.revision || null;
    const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce });
    return {
      ownership: "owned", resourceType: "item_edition", resourceId: candidate._id,
      sourceRef: { resourceType: "item_edition", resourceId: candidate._id },
      authoringRef: { resourceType: "item", resourceId: candidate.itemId },
      title: revision?.label || "Contenuto", summary: "",
      state: candidate.workingRevisionId ? "working" : (candidate.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "item_revision", resourceId: candidate.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principalType: principal.type, actorRole, revision }),
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
      availableOperations: ownedOperations({ published: Boolean(candidate.publishedReleaseId), listing, canManageCommerce }),
    };
  }
  if (candidate.resourceType === "namespace") {
    const revision = candidate.revision || null;
    const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce });
    return {
      ownership: "owned", resourceType: "namespace", resourceId: candidate._id,
      sourceRef: { resourceType: "namespace", resourceId: candidate._id },
      authoringRef: { resourceType: "namespace", resourceId: candidate._id },
      title: candidate.name, summary: candidate.description || "",
      state: candidate.workingRevisionId ? "working" : (candidate.publishedRevisionId ? "published" : "empty"),
      editorialWorkflow: workflowState(revision),
      publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "namespace_revision", resourceId: candidate.publishedRevisionId } : null,
      listing,
      availableOperations: withWorkflowOperations({ baseOperations, principalType: principal.type, actorRole, revision }),
    };
  }
  const revision = candidate.revision || null;
  const baseOperations = ownedOperations({ published: Boolean(candidate.publishedRevisionId), listing, canManageCommerce });
  return {
    ownership: "owned", resourceType: "visit", resourceId: candidate._id,
    sourceRef: { resourceType: "visit", resourceId: candidate._id },
    authoringRef: { resourceType: "visit", resourceId: candidate._id },
    title: revision?.title || "Visita", summary: revision?.description || "",
    state: candidate.workingRevisionId ? "working" : (candidate.publishedRevisionId ? "published" : "empty"),
    editorialWorkflow: workflowState(revision),
    publishedSnapshotRef: candidate.publishedRevisionId ? { resourceType: "visit_revision", resourceId: candidate.publishedRevisionId } : null,
    listing,
    availableOperations: withWorkflowOperations({ baseOperations, principalType: principal.type, actorRole, revision }),
  };
}

async function listOwnedResources({ principal, q, resourceTypes, page, pageSize }) {
  const types = normalizeTypes(resourceTypes, OWNED_RESOURCE_TYPES);
  const selectedTypes = types.length ? types : OWNED_RESOURCE_TYPES;
  const windowSize = page * pageSize;
  const factories = {
    item_edition: itemCandidates,
    editorial_context: contextCandidates,
    namespace: namespaceCandidates,
    visit: visitCandidates,
  };
  const groups = await Promise.all(selectedTypes.map((type) => factories[type]({ principal, q, windowSize })));
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const merged = groups.flatMap((group) => group.results)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) || id(b._id).localeCompare(id(a._id)));
  const offset = (page - 1) * pageSize;
  const candidates = merged.slice(offset, offset + pageSize);
  const listings = await listingMapForCandidates(principal, candidates);
  return {
    total,
    results: candidates.map((candidate) => projectOwnedCandidate(candidate, { principal, actorRole: principal.role, listings })),
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

async function listLicensedResources({ principal, q, resourceTypes, page, pageSize }) {
  const now = new Date();
  const match = {
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
    status: "active",
    validFrom: { $lte: now },
    $or: [{ validUntil: null }, { validUntil: { $gt: now } }],
  };
  const types = normalizeTypes(resourceTypes);
  if (types.length) match.resourceType = { $in: types };
  const pipeline = [
    { $match: match },
    { $lookup: { from: MarketplaceAcquisition.collection.name, localField: "sourceAcquisitionId", foreignField: "_id", as: "acquisition" } },
    { $unwind: { path: "$acquisition", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: MarketplaceListing.collection.name, localField: "acquisition.listingId", foreignField: "_id", as: "listing" } },
    { $unwind: { path: "$listing", preserveNullAndEmptyArrays: true } },
  ];
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    pipeline.push({ $match: { $or: [{ "listing.title": regex }, { "listing.summary": regex }] } });
  }
  pipeline.push(
    {
      $group: {
        _id: { resourceType: "$resourceType", resourceId: "$resourceId" },
        capabilities: { $addToSet: "$capability" },
        versionPolicies: { $addToSet: "$versionPolicy" },
        updatedAt: { $max: "$updatedAt" },
      },
    },
    { $sort: { updatedAt: -1, "_id.resourceId": -1 } },
    {
      $facet: {
        results: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
        total: [{ $count: "value" }],
      },
    },
  );
  const [grouped] = await Entitlement.aggregate(pipeline);
  const projected = [];
  for (const candidate of grouped?.results || []) {
    let marketable;
    try {
      marketable = await resolveMarketableResource({ resourceType: candidate._id.resourceType, resourceId: candidate._id.resourceId });
    } catch (error) {
      if ([404, 409].includes(error?.status)) continue;
      throw error;
    }
    const refs = await actionableRefs(candidate._id.resourceType, candidate._id.resourceId, marketable);
    const capabilities = candidate.capabilities || [];
    projected.push({
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
    });
  }
  return { total: Number(grouped?.total?.[0]?.value || 0), results: projected };
}

async function listCreatorWorkspaceResources({
  actorUserId,
  principalType = "user",
  principalId = actorUserId,
  ownership = "owned",
  q = "",
  resourceTypes = null,
  page = 1,
  limit = 12,
}) {
  const { selected } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const paging = pagination(page, limit);
  const normalizedOwnership = ownership === "licensed" ? "licensed" : "owned";
  const query = String(q || "").trim();
  const data = normalizedOwnership === "licensed"
    ? await listLicensedResources({ principal: selected, q: query, resourceTypes, ...paging })
    : await listOwnedResources({ principal: selected, q: query, resourceTypes, ...paging });
  return {
    principal: selected,
    ownership: normalizedOwnership,
    q: query,
    resourceTypes: normalizeTypes(resourceTypes),
    page: paging.page,
    pageSize: paging.pageSize,
    total: data.total,
    results: data.results,
  };
}

module.exports = {
  OWNED_RESOURCE_TYPES,
  getCreatorWorkspaceContext,
  listCreatorWorkspaceResources,
};
