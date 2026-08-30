const Subject = require("../models/subject.model");
const { assertVenuePermission } = require("./venueAuthorization.service");
const {
  projectVenueSubjectContext,
  venueSubjectContextMap,
} = require("./venueSubjectContextProjection.service");

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

function rankingTier(projected) {
  if (projected?.inventory?.status === "exposed") return { tier: 1, source: "venue_exposed" };
  if (projected?.inventory?.venueTargetId) return { tier: 2, source: "venue_inventory" };
  if ((projected?.museumContent?.availableCount || 0) > 0 || (projected?.museumContent?.draftCount || 0) > 0) {
    return { tier: 3, source: "organization_content" };
  }
  return { tier: 4, source: "artaround" };
}

async function searchVenueSubjectCandidates({ venueId, actorUserId, query, limit = 20 }) {
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
  const context = {
    venue: {
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      ownerOrganizationId: venue.ownerOrganizationId,
    },
    permissions: { canEditInventory: authority.effectivePermissions.includes("venue.physical.edit") },
  };
  const normalizedQuery = normalizedLabel(query);
  if (normalizedQuery.length < 2) return {
    ...context,
    query: String(query || ""),
    exact: [],
    suggestions: [],
    manualCreation: { allowed: false, reason: "query_too_short" },
  };
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const queryTokens = [...tokens(query)];
  const candidateRegex = queryTokens.length ? new RegExp(queryTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
  const subjects = await Subject.find(candidateRegex ? { preferredLabel: candidateRegex } : {}).limit(160).lean();
  const subjectIds = subjects.map((subject) => subject._id);
  const venueProjection = await projectVenueSubjectContext({ venueId, subjectIds, view: "effective" });
  const projectedBySubjectId = venueSubjectContextMap(venueProjection);
  const ranked = subjects.map((subject) => {
    const projected = projectedBySubjectId.get(id(subject._id)) || {
      inventory: null,
      museumContent: { availableCount: 0, draftCount: 0 },
    };
    const exact = normalizedLabel(subject.preferredLabel) === normalizedQuery;
    const { tier, source } = rankingTier(projected);
    return {
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalIdentities: subject.externalIdentities || [],
      exact,
      similarity: similarity(query, subject.preferredLabel),
      tier,
      source,
      inventory: projected.inventory,
      museumContent: projected.museumContent,
    };
  }).sort((left, right) => left.tier - right.tier || Number(right.exact) - Number(left.exact) || right.similarity - left.similarity || left.preferredLabel.localeCompare(right.preferredLabel, "it"));
  const exact = ranked.filter((entry) => entry.exact).slice(0, safeLimit);
  const suggestions = ranked.filter((entry) => !entry.exact && entry.similarity >= 0.25).slice(0, safeLimit);
  return {
    ...context,
    query: String(query || "").trim(),
    exact,
    suggestions,
    manualCreation: {
      allowed: exact.length === 0,
      reason: exact.length ? "exact_duplicate" : null,
      possibleDuplicateSubjectIds: suggestions.filter((entry) => entry.similarity >= 0.75).map((entry) => entry.id),
    },
  };
}

module.exports = { normalizedLabel, similarity, searchVenueSubjectCandidates };
