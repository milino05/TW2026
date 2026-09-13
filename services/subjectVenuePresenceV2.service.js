const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueInventoryProposal = require("../models/venueInventoryProposal.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { resolveSelectedPrincipal } = require("./marketplaceWorkspaceV2.service");
const { projectVenueSubjectContext } = require("./venueSubjectContextProjection.service");
const { projectOrganizationSubjectUsage } = require("./organizationSubjectUsage.service");
const { projectVenueInventoryOperations } = require("./venueInventoryOperations.service");
const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");

function id(value) { return String(value?._id || value || ""); }
function permissionSet(authority) { return new Set(authority?.effectivePermissions || []); }

async function projectVenuePresence({ venue, subjectId, view, organizationUsageBySubjectId = null }) {
  const projection = await projectVenueSubjectContext({ venueId: venue._id, subjectIds: [subjectId], view, organizationUsageBySubjectId });
  const subject = projection.subjects?.[0] || {
    inventory: null,
    museumContent: { availableCount: 0, draftCount: 0 },
    organizationUsage: { itemCount: 0, availableCount: 0, draftCount: 0, collectionCount: 0, venueCount: 0, previewMedia: null },
  };
  return {
    venue: {
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      ownerOrganizationId: venue.ownerOrganizationId,
    },
    view: projection.view,
    inventory: subject.inventory,
    museumContent: subject.museumContent,
    organizationUsage: subject.organizationUsage,
  };
}

async function publicPlacements(subjectId) {
  const targetRows = await VenueTarget.find({ subjectId, lifecycleStatus: "active" }).select("_id venueId").lean();
  if (!targetRows.length) return [];
  const venueIds = [...new Set(targetRows.map((target) => id(target.venueId)))];
  const venues = await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active", publishedReleaseId: { $ne: null } })
    .select("name description ownerOrganizationId publishedReleaseId")
    .lean();
  const result = [];
  for (const venue of venues) {
    const projected = await projectVenuePresence({ venue, subjectId, view: "published", organizationUsageBySubjectId: new Map() });
    if (projected.inventory?.status !== "exposed") continue;
    result.push({
      ...projected,
      mapTargetId: projected.inventory?.venueTargetId || null,
    });
  }
  return result.sort((left, right) => String(left.venue.name).localeCompare(String(right.venue.name), "it"));
}

async function organizationPresence({ organizationId, subjectId, actorUserId }) {
  const authority = await resolveOrganizationAuthority({ userId: actorUserId, organizationId });
  const permissions = permissionSet(authority);
  const venues = await Venue.find({ ownerOrganizationId: organizationId, lifecycleStatus: "active" })
    .select("name description ownerOrganizationId workingReleaseId publishedReleaseId")
    .sort({ name: 1 })
    .lean();
  const organizationUsageBySubjectId = await projectOrganizationSubjectUsage({ organizationId, subjectIds: [subjectId] });
  const organizationUsage = organizationUsageBySubjectId.get(id(subjectId)) || {
    itemCount: 0,
    availableCount: 0,
    draftCount: 0,
    collectionCount: 0,
    venueCount: 0,
    previewMedia: null,
  };
  if (!venues.length) {
    return {
      venues: [],
      usage: organizationUsage,
      permissions: {
        canCreateContent: permissions.has("item.create"),
        canProposeInventory: permissions.has("venue.inventory.propose"),
        canManageInventory: permissions.has("venue.inventory.manage"),
      },
    };
  }
  const pending = await VenueInventoryProposal.find({
    venueId: { $in: venues.map((venue) => venue._id) },
    subjectId,
    status: "pending",
  }).select("_id venueId proposedByUserId createdAt message sourceItemId status").lean();
  const pendingByVenueId = new Map(pending.map((proposal) => [id(proposal.venueId), proposal]));
  const projected = [];
  for (const venue of venues) {
    const presence = await projectVenuePresence({ venue, subjectId, view: "effective", organizationUsageBySubjectId });
    const relationship = projectVenueInventoryOperations({
      inventory: presence.inventory,
      proposal: pendingByVenueId.get(id(venue._id)) || null,
      effectivePermissions: permissions,
      actorUserId,
    });
    projected.push({
      ...presence,
      proposal: relationship.proposal,
      relationshipState: relationship.relationshipState,
      availableOperations: relationship.availableOperations,
    });
  }
  return {
    venues: projected,
    usage: organizationUsage,
    permissions: {
      canCreateContent: permissions.has("item.create"),
      canProposeInventory: permissions.has("venue.inventory.propose"),
      canManageInventory: permissions.has("venue.inventory.manage"),
    },
  };
}

async function getSubjectVenuePresence({ subjectId, actorUserId, principalType = "user", principalId = actorUserId }) {
  const subject = await Subject.findById(subjectId).select("preferredLabel description externalIdentities").lean();
  if (!subject) throw new AppError("Subject non trovato", 404);
  const { selected } = await resolveSelectedPrincipal({ actorUserId, principalType, principalId });
  const [publicVenuePlacements, organization] = await Promise.all([
    publicPlacements(subject._id),
    selected.type === "organization"
      ? organizationPresence({ organizationId: selected.id, subjectId: subject._id, actorUserId })
      : Promise.resolve(null),
  ]);
  return {
    subject: {
      id: subject._id,
      preferredLabel: subject.preferredLabel,
      description: subject.description || "",
      externalIdentities: subject.externalIdentities || [],
    },
    principal: { type: selected.type, id: selected.id, name: selected.name },
    organization,
    publicPlacements: publicVenuePlacements,
  };
}

module.exports = { getSubjectVenuePresence, publicPlacements, organizationPresence };
