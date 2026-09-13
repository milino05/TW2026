const Subject = require("../models/subject.model");
const ItemV2 = require("../models/itemV2.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueInventoryProposal = require("../models/venueInventoryProposal.model");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { projectOrganizationSubjectUsage } = require("./organizationSubjectUsage.service");
const {
  projectVenueSubjectContext,
  venueSubjectContextMap,
} = require("./venueSubjectContextProjection.service");
const { projectVenueInventoryOperations } = require("./venueInventoryOperations.service");

function id(value) { return String(value?._id || value || ""); }
function normalizedLabel(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function tokens(value) { return new Set(normalizedLabel(value).split(" ").filter(Boolean)); }
function similarity(left, right) {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const containment = normalizedLabel(left).includes(normalizedLabel(right)) || normalizedLabel(right).includes(normalizedLabel(left)) ? 0.2 : 0;
  return Math.min(1, intersection / union + containment);
}
function safeLimit(value) { return Math.max(1, Math.min(50, Number(value) || 20)); }
function safePage(value) { return Math.max(1, Number(value) || 1); }
function escapedRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function rankingTier(projected, usage) {
  if (projected?.inventory?.status === "exposed") return { tier: 1, source: "venue_exposed" };
  if (projected?.inventory?.venueTargetId) return { tier: 2, source: "venue_inventory" };
  if ((usage?.itemCount || 0) > 0) return { tier: 3, source: "organization_content" };
  return { tier: 4, source: "artaround" };
}

async function recommendedOrganizationSubjectIds({ organizationId, page, limit, excludedSubjectIds = [] }) {
  const skip = (page - 1) * limit;
  const subjectFilter = excludedSubjectIds.length ? { $nin: excludedSubjectIds } : { $ne: null };
  const [facet] = await ItemV2.aggregate([
    { $match: { ownerType: "organization", ownerId: organizationId, lifecycleStatus: "active", primarySubjectId: subjectFilter } },
    { $group: { _id: "$primarySubjectId", itemCount: { $sum: 1 }, lastUsedAt: { $max: "$updatedAt" } } },
    { $sort: { itemCount: -1, lastUsedAt: -1, _id: 1 } },
    { $facet: { results: [{ $skip: skip }, { $limit: limit }], total: [{ $count: "value" }] } },
  ]);
  return {
    ids: (facet?.results || []).map((entry) => entry._id),
    total: Number(facet?.total?.[0]?.value || 0),
  };
}

async function searchSubjects(query, { page, limit }) {
  const queryTokens = [...tokens(query)];
  const candidateRegex = queryTokens.length ? new RegExp(queryTokens.map(escapedRegex).join("|"), "i") : null;
  const filter = candidateRegex ? { $or: [{ preferredLabel: candidateRegex }, { description: candidateRegex }] } : {};
  const skip = (page - 1) * limit;
  const [subjects, total] = await Promise.all([
    Subject.find(filter).sort({ preferredLabel: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    Subject.countDocuments(filter),
  ]);
  return { subjects, total };
}

async function searchVenueSubjectCandidates({ venueId, actorUserId, query = "", limit = 20, page = 1 }) {
  const safeResultLimit = safeLimit(limit);
  const safeResultPage = safePage(page);
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
  const permissions = new Set(authority.effectivePermissions || []);
  const context = {
    venue: {
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      ownerOrganizationId: venue.ownerOrganizationId,
    },
    permissions: {
      canEditInventory: permissions.has("venue.inventory.manage"),
      canManageInventory: permissions.has("venue.inventory.manage"),
      canProposeInventory: permissions.has("venue.inventory.propose"),
    },
  };
  const normalizedQuery = normalizedLabel(query);

  let subjects;
  let total;
  if (!normalizedQuery) {
    const existingTargets = await VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active" }).select("subjectId").lean();
    const recommended = await recommendedOrganizationSubjectIds({
      organizationId: venue.ownerOrganizationId,
      page: safeResultPage,
      limit: safeResultLimit,
      excludedSubjectIds: existingTargets.map((entry) => entry.subjectId),
    });
    subjects = recommended.ids.length
      ? await Subject.find({ _id: { $in: recommended.ids } }).lean()
      : [];
    const order = new Map(recommended.ids.map((subjectId, index) => [id(subjectId), index]));
    subjects.sort((left, right) => (order.get(id(left._id)) ?? 9999) - (order.get(id(right._id)) ?? 9999));
    total = recommended.total;
  } else if (normalizedQuery.length < 2) {
    return {
      ...context,
      query: String(query || ""),
      results: [],
      exact: [],
      suggestions: [],
      pagination: { page: safeResultPage, limit: safeResultLimit, total: 0, totalPages: 0 },
      manualCreation: { allowed: false, reason: "query_too_short" },
    };
  } else {
    const searched = await searchSubjects(query, { page: safeResultPage, limit: safeResultLimit });
    subjects = searched.subjects;
    total = searched.total;
  }

  const subjectIds = subjects.map((subject) => subject._id);
  const usageBySubjectId = await projectOrganizationSubjectUsage({ organizationId: venue.ownerOrganizationId, subjectIds });
  const [venueProjection, pendingProposals] = await Promise.all([
    projectVenueSubjectContext({ venueId, subjectIds, view: "effective", organizationUsageBySubjectId: usageBySubjectId }),
    subjectIds.length
      ? VenueInventoryProposal.find({ venueId: venue._id, subjectId: { $in: subjectIds }, status: "pending" })
        .select("_id subjectId proposedByUserId createdAt message sourceItemId status")
        .lean()
      : [],
  ]);
  const projectedBySubjectId = venueSubjectContextMap(venueProjection);
  const proposalBySubjectId = new Map(pendingProposals.map((proposal) => [id(proposal.subjectId), proposal]));

  const ranked = subjects.map((subject) => {
    const subjectId = id(subject._id);
    const projected = projectedBySubjectId.get(subjectId) || { inventory: null };
    const usage = usageBySubjectId.get(subjectId) || {
      itemCount: 0,
      availableCount: 0,
      draftCount: 0,
      collectionCount: 0,
      venueCount: 0,
      previewMedia: null,
    };
    const relationship = projectVenueInventoryOperations({
      inventory: projected.inventory,
      proposal: proposalBySubjectId.get(subjectId) || null,
      effectivePermissions: permissions,
      actorUserId,
    });
    const exact = normalizedQuery ? normalizedLabel(subject.preferredLabel) === normalizedQuery : false;
    const { tier, source } = rankingTier(projected, usage);
    return {
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalIdentities: subject.externalIdentities || [],
      exact,
      similarity: normalizedQuery ? similarity(query, subject.preferredLabel) : 0,
      tier,
      source,
      inventory: projected.inventory,
      museumContent: { availableCount: usage.availableCount, draftCount: usage.draftCount },
      organizationUsage: {
        itemCount: usage.itemCount,
        availableCount: usage.availableCount,
        draftCount: usage.draftCount,
        collectionCount: usage.collectionCount,
        otherVenueCount: Math.max(0, Number(usage.venueCount || 0) - (projected.inventory?.venueTargetId ? 1 : 0)),
      },
      previewMedia: usage.previewMedia || null,
      proposal: relationship.proposal,
      relationshipState: relationship.relationshipState,
      availableOperations: relationship.availableOperations,
    };
  }).sort((left, right) => {
    if (!normalizedQuery) {
      return right.organizationUsage.availableCount - left.organizationUsage.availableCount
        || right.organizationUsage.itemCount - left.organizationUsage.itemCount
        || right.organizationUsage.draftCount - left.organizationUsage.draftCount
        || right.organizationUsage.collectionCount - left.organizationUsage.collectionCount
        || left.preferredLabel.localeCompare(right.preferredLabel, "it");
    }
    return left.tier - right.tier
      || Number(right.exact) - Number(left.exact)
      || right.similarity - left.similarity
      || right.organizationUsage.itemCount - left.organizationUsage.itemCount
      || left.preferredLabel.localeCompare(right.preferredLabel, "it");
  });

  const exact = normalizedQuery ? ranked.filter((entry) => entry.exact).slice(0, safeResultLimit) : [];
  const suggestions = normalizedQuery
    ? ranked.filter((entry) => !entry.exact && entry.similarity >= 0.25).slice(0, safeResultLimit)
    : [];
  const results = normalizedQuery ? ranked.slice(0, safeResultLimit) : ranked;
  const totalPages = Math.ceil(total / safeResultLimit);
  return {
    ...context,
    query: String(query || "").trim(),
    results,
    exact,
    suggestions,
    pagination: { page: safeResultPage, limit: safeResultLimit, total, totalPages },
    manualCreation: {
      allowed: Boolean(normalizedQuery && exact.length === 0),
      reason: exact.length ? "exact_duplicate" : null,
      possibleDuplicateSubjectIds: suggestions.filter((entry) => entry.similarity >= 0.75).map((entry) => entry.id),
    },
  };
}

module.exports = { normalizedLabel, similarity, searchVenueSubjectCandidates };
