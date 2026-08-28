const mongoose = require("mongoose");
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
const AppError = require("../utils/AppError");
const { resolveSelectedPrincipal } = require("./marketplaceWorkspaceV2.service");
const {
  listingMapForCandidates,
  projectOwnedCandidate,
  projectLicensedCandidate,
} = require("./marketplaceWorkspaceResourceProjectionV2.service");

const OWNED_RESOURCE_TYPES = ["item_edition", "editorial_context", "namespace", "visit"];
const VIEW_PERMISSION_BY_TYPE = Object.freeze({
  item_edition: "item.view",
  editorial_context: "editorial_context.view",
  namespace: "namespace.view",
  visit: "visit.view",
});

function id(value) { return String(value?._id || value || ""); }
function objectId(value) { return new mongoose.Types.ObjectId(String(value)); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
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
function activeEntitlementMatch(principal, now = new Date()) {
  return {
    beneficiaryType: principal.type,
    beneficiaryId: principal.id,
    status: "active",
    validFrom: { $lte: now },
    $or: [{ validUntil: null }, { validUntil: { $gt: now } }],
  };
}
function visibleOwnedTypes(principal) {
  if (principal.type === "user") return OWNED_RESOURCE_TYPES;
  const permissions = new Set(principal.effectivePermissions || []);
  return OWNED_RESOURCE_TYPES.filter((type) => permissions.has(VIEW_PERMISSION_BY_TYPE[type]));
}

async function getCreatorWorkspaceContext({ actorUserId, principalType = "user", principalId = actorUserId }) {
  const { selected, availablePrincipals } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const canViewSpaces = selected.type === "user" || selected.effectivePermissions.includes("editorial_space.view");
  const spaces = canViewSpaces ? await ContentSpace.find({
    ownerType: selected.type,
    ownerId: selected.id,
    lifecycleStatus: "active",
  }).sort({ name: 1 }).select("name description").lean() : [];
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
    { $facet: { results: [{ $limit: windowSize }], total: [{ $count: "value" }] } },
  ]);
  return { results: result?.results || [], total: Number(result?.total?.[0]?.value || 0) };
}

async function itemCandidates({ principal, q, windowSize, resourceId = null }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [];
  if (resourceId) pipeline.push({ $match: { _id: objectId(resourceId) } });
  pipeline.push(
    { $lookup: { from: ItemV2.collection.name, localField: "itemId", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    { $match: { "item.ownerType": principal.type, "item.ownerId": principal.id, "item.lifecycleStatus": "active" } },
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: ItemRevisionV2.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
  );
  if (regex) pipeline.push({ $match: { $or: [{ "revision.label": regex }, { "revision.tags": regex }, { "revision.authorCredits": regex }] } });
  pipeline.push({ $project: { _id: 1, itemId: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "item_edition" } } });
  return facetCandidates(ItemEdition, pipeline, { windowSize });
}

async function contextCandidates({ principal, q, windowSize, resourceId = null }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const pipeline = [];
  if (resourceId) pipeline.push({ $match: { _id: objectId(resourceId) } });
  pipeline.push(
    { $lookup: { from: ContentSpace.collection.name, localField: "contentSpaceId", foreignField: "_id", as: "space" } },
    { $unwind: "$space" },
    { $match: { "space.ownerType": principal.type, "space.ownerId": principal.id, "space.lifecycleStatus": "active", lifecycleStatus: "active" } },
  );
  if (regex) pipeline.push({ $match: { $or: [{ displayName: regex }, { shortDescription: regex }, { description: regex }] } });
  pipeline.push({ $project: { _id: 1, displayName: 1, shortDescription: 1, description: 1, publishedReleaseId: 1, updatedAt: 1, resourceType: { $literal: "editorial_context" } } });
  return facetCandidates(EditorialContext, pipeline, { windowSize });
}

async function namespaceCandidates({ principal, q, windowSize, resourceId = null }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const match = { ownerType: principal.type, ownerId: principal.id, lifecycleStatus: "active" };
  if (resourceId) match._id = objectId(resourceId);
  const pipeline = [{ $match: match }];
  if (regex) pipeline.push({ $match: { $or: [{ name: regex }, { description: regex }] } });
  pipeline.push(
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: NamespaceRevision.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
    { $project: { _id: 1, name: 1, description: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "namespace" } } },
  );
  return facetCandidates(Namespace, pipeline, { windowSize });
}

async function visitCandidates({ principal, q, windowSize, resourceId = null }) {
  const regex = q ? new RegExp(escapeRegex(q), "i") : null;
  const match = { ownerType: principal.type, ownerId: principal.id, lifecycleStatus: "active" };
  if (resourceId) match._id = objectId(resourceId);
  const pipeline = [
    { $match: match },
    { $addFields: { currentRevisionId: { $ifNull: ["$workingRevisionId", "$publishedRevisionId"] } } },
    { $lookup: { from: VisitRevisionV2.collection.name, localField: "currentRevisionId", foreignField: "_id", as: "revision" } },
    { $unwind: { path: "$revision", preserveNullAndEmptyArrays: true } },
  ];
  if (regex) pipeline.push({ $match: { $or: [{ "revision.title": regex }, { "revision.description": regex }] } });
  pipeline.push({ $project: { _id: 1, workingRevisionId: 1, publishedRevisionId: 1, revision: 1, updatedAt: 1, resourceType: { $literal: "visit" } } });
  return facetCandidates(VisitV2, pipeline, { windowSize });
}

const CANDIDATE_FACTORIES = {
  item_edition: itemCandidates,
  editorial_context: contextCandidates,
  namespace: namespaceCandidates,
  visit: visitCandidates,
};

async function listOwnedResources({ principal, q, resourceTypes, page, pageSize }) {
  const allowedTypes = visibleOwnedTypes(principal);
  const types = normalizeTypes(resourceTypes, allowedTypes);
  const selectedTypes = types.length ? types : allowedTypes;
  if (selectedTypes.length === 0) return { total: 0, results: [] };
  const windowSize = page * pageSize;
  const groups = await Promise.all(selectedTypes.map((type) => CANDIDATE_FACTORIES[type]({ principal, q, windowSize })));
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const merged = groups.flatMap((group) => group.results)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) || id(b._id).localeCompare(id(a._id)));
  const offset = (page - 1) * pageSize;
  const candidates = merged.slice(offset, offset + pageSize);
  const canViewDistribution = principal.type === "user" || principal.effectivePermissions.includes("marketplace.distribution.view");
  const listings = canViewDistribution ? await listingMapForCandidates(principal, candidates) : new Map();
  return { total, results: candidates.map((candidate) => projectOwnedCandidate(candidate, { principal, listings })) };
}

async function listLicensedResources({ principal, q, resourceTypes, page, pageSize }) {
  const match = activeEntitlementMatch(principal);
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
    { $group: { _id: { resourceType: "$resourceType", resourceId: "$resourceId" }, capabilities: { $addToSet: "$capability" }, versionPolicies: { $addToSet: "$versionPolicy" }, baselineSnapshotRefs: { $addToSet: "$baselineSnapshotRef" }, updatedAt: { $max: "$updatedAt" } } },
    { $sort: { updatedAt: -1, "_id.resourceId": -1 } },
    { $facet: { results: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }], total: [{ $count: "value" }] } },
  );
  const [grouped] = await Entitlement.aggregate(pipeline);
  const projected = [];
  for (const candidate of grouped?.results || []) {
    const asset = await projectLicensedCandidate(candidate, { skipUnavailable: true });
    if (asset) projected.push(asset);
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

async function getCreatorWorkspaceResourceDetail({
  actorUserId,
  principalType = "user",
  principalId = actorUserId,
  ownership = "owned",
  resourceType,
  resourceId,
}) {
  const { selected } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const normalizedOwnership = ownership === "licensed" ? "licensed" : "owned";
  let asset = null;

  if (normalizedOwnership === "owned") {
    if (!visibleOwnedTypes(selected).includes(resourceType)) {
      throw new AppError("Risorsa non disponibile nel Workspace", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
    }
    const group = await CANDIDATE_FACTORIES[resourceType]({ principal: selected, q: "", windowSize: 1, resourceId });
    const candidate = group.results[0] || null;
    if (candidate) {
      const canViewDistribution = selected.type === "user" || selected.effectivePermissions.includes("marketplace.distribution.view");
      const listings = canViewDistribution ? await listingMapForCandidates(selected, [candidate]) : new Map();
      asset = projectOwnedCandidate(candidate, { principal: selected, listings });
    }
  } else {
    const entitlements = await Entitlement.find({
      ...activeEntitlementMatch(selected),
      resourceType,
      resourceId,
    }).select("capability versionPolicy baselineSnapshotRef").lean();
    if (entitlements.length) {
      const candidate = {
        _id: { resourceType, resourceId },
        capabilities: [...new Set(entitlements.map((entry) => entry.capability))],
        versionPolicies: [...new Set(entitlements.map((entry) => entry.versionPolicy))],
        baselineSnapshotRefs: entitlements.map((entry) => entry.baselineSnapshotRef).filter(Boolean),
      };
      asset = await projectLicensedCandidate(candidate, { skipUnavailable: false });
    }
  }

  if (!asset) throw new AppError("Risorsa non disponibile nel Workspace", 404, [{ code: "WORKSPACE_RESOURCE_NOT_FOUND" }]);
  return { principal: selected, asset };
}

module.exports = {
  OWNED_RESOURCE_TYPES,
  getCreatorWorkspaceContext,
  listCreatorWorkspaceResources,
  getCreatorWorkspaceResourceDetail,
};
