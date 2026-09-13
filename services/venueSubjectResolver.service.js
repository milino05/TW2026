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
function activityTime(value) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function rankingTier(projected, usage) {
  if (projected?.inventory?.status === "exposed") return { tier: 1, source: "venue_exposed" };
  if (projected?.inventory?.venueTargetId) return { tier: 2, source: "venue_inventory" };
  if ((usage?.itemCount || 0) > 0) return { tier: 3, source: "organization_content" };
  return { tier: 4, source: "artaround" };
}

async function recommendedOrganizationSubjectIds({ organizationId, excludedSubjectIds = [] }) {
  const subjectFilter = excludedSubjectIds.length ? { $nin: excludedSubjectIds } : { $ne: null };
  const rows = await ItemV2.aggregate([
    { $match: { ownerType: "organization", ownerId: organizationId, lifecycleStatus: "active", primarySubjectId: subjectFilter } },
    { $group: { _id: "$primarySubjectId", lastUsedAt: { $max: "$updatedAt" } } },
    { $sort: { lastUsedAt: -1, _id: 1 } },
  ]);
  return rows.map((entry) => entry._id);
}

async function searchSubjects(query) {
  const queryTokens = [...tokens(query)];
  const candidateRegex = queryTokens.length ? new RegExp(queryTokens.map(escapedRegex).join("|"), "i") : null;
  const filter = candidateRegex ? { $or: [{ preferredLabel: candidateRegex }, { description: candidateRegex }] } : {};
  return Subject.find(filter).lean();
}

function defaultUsage() {
  return {
    itemCount: 0,
    availableCount: 0,
    draftCount: 0,
    collectionCount: 0,
    venueCount: 0,
    lastActivityAt: null,
    previewMedia: null,
  };
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

  let subjects = [];
  if (!normalizedQuery) {
    const existingTargets = await VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active" }).select("subjectId").lean();
    const recommendedIds = await recommendedOrganizationSubjectIds({
      organizationId: venue.ownerOrganizationId,
      excludedSubjectIds: existingTargets.map((entry) => entry.subjectId),
    });
    subjects = recommendedIds.length ? await Subject.find({ _id: { $in: recommendedIds } }).lean() : [];
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
    subjects = await searchSubjects(query);
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
    const usage = usageBySubjectId.get(subjectId) || defaultUsage();
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
        lastActivityAt: usage.lastActivityAt || null,
      },
      previewMedia: usage.previewMedia || null,
      proposal: relationship.proposal,
      relationshipState: relationship.relationshipState,
      availableOperations: relationship.availableOperations,
    };
  }).sort((left, right) => {
    if (!normalizedQuery) {
      return right.organizationUsage.availableCount - left.organizationUsage.availableCount
        || right.organizationUsage.draftCount - left.organizationUsage.draftCount
        || right.organizationUsage.collectionCount - left.organizationUsage.collectionCount
        || activityTime(right.organizationUsage.lastActivityAt) - activityTime(left.organizationUsage.lastActivityAt)
        || left.preferredLabel.localeCompare(right.preferredLabel, "it");
    }
    return left.tier - right.tier
      || Number(right.exact) - Number(left.exact)
      || right.similarity - left.similarity
      || right.organizationUsage.availableCount - left.organizationUsage.availableCount
      || right.organizationUsage.draftCount - left.organizationUsage.draftCount
      || right.organizationUsage.collectionCount - left.organizationUsage.collectionCount
      || activityTime(right.organizationUsage.lastActivityAt) - activityTime(left.organizationUsage.lastActivityAt)
      || left.preferredLabel.localeCompare(right.preferredLabel, "it");
  });

  const total = ranked.length;
  const totalPages = Math.ceil(total / safeResultLimit);
  const start = (safeResultPage - 1) * safeResultLimit;
  const results = ranked.slice(start, start + safeResultLimit);
  const exactMatches = normalizedQuery ? ranked.filter((entry) => entry.exact) : [];
  const exact = exactMatches.slice(0, safeResultLimit);
  const suggestions = normalizedQuery
    ? results.filter((entry) => !entry.exact && entry.similarity >= 0.25)
    : [];

  return {
    ...context,
    query: String(query || "").trim(),
    results,
    exact,
    suggestions,
    pagination: { page: safeResultPage, limit: safeResultLimit, total, totalPages },
    manualCreation: {
      allowed: Boolean(normalizedQuery && exactMatches.length === 0),
      reason: exactMatches.length ? "exact_duplicate" : null,
      possibleDuplicateSubjectIds: ranked.filter((entry) => !entry.exact && entry.similarity >= 0.75).slice(0, safeResultLimit).map((entry) => entry.id),
    },
  };
}

module.exports = { normalizedLabel, similarity, searchVenueSubjectCandidates };
