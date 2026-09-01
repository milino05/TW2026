const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { venueTargetIdentityMap } = require("./venueTargetIdentityProjection.service");
const {
  projectVenueSubjectContext,
  venueSubjectContextMap,
} = require("./venueSubjectContextProjection.service");

function id(value) { return String(value?._id || value || ""); }
function projectSubject(subject, fallbackSubjectId) {
  if (!subject) return { id: fallbackSubjectId, missing: true };
  return {
    id: subject._id,
    preferredLabel: subject.preferredLabel,
    description: subject.description || "",
    externalIdentities: (subject.externalIdentities || []).map((identity) => ({
      scheme: identity.scheme,
      id: identity.id,
      role: identity.role,
      canonicalId: identity.canonicalId || null,
      verificationStatus: identity.verification?.status,
    })),
  };
}
function inventoryRank(status) {
  return { exposed: 0, unplaced: 1, unavailable: 2 }[status] ?? 3;
}

async function listVenueAuthoringTargets({ venueId, actorUserId }) {
  const { venue, authority } = await assertVenuePermission({
    userId: actorUserId,
    venueId,
    permissionCode: "venue.view",
  });
  const targets = await VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active" })
    .sort({ createdAt: 1 })
    .lean();
  const contextProjection = await projectVenueSubjectContext({
    venueId: venue._id,
    subjectIds: targets.map((target) => target.subjectId),
    view: "effective",
  });
  const release = contextProjection.releaseId
    ? await VenueRelease.findOne({ _id: contextProjection.releaseId, venueId: venue._id }).select("targetBindings").lean()
    : null;
  const bindingByTarget = new Map((release?.targetBindings || []).map((binding) => [id(binding.venueTargetId), binding]));
  const identityByTargetId = await venueTargetIdentityMap(targets);
  const contextBySubjectId = venueSubjectContextMap(contextProjection);
  const projectedTargets = targets.map((target) => {
    const identity = identityByTargetId.get(id(target)) || {};
    const binding = bindingByTarget.get(id(target));
    const subjectContext = contextBySubjectId.get(id(target.subjectId)) || {
      inventory: null,
      museumContent: { availableCount: 0, draftCount: 0 },
    };
    return {
      id: target._id,
      label: identity.label || "Entità della sede",
      description: identity.description || "",
      subject: projectSubject(identity.subject, target.subjectId),
      inventory: subjectContext.inventory || {
        venueTargetId: target._id,
        status: "unplaced",
        availability: null,
        slot: null,
        place: null,
      },
      museumContent: subjectContext.museumContent,
      recognitionMedia: (binding?.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || null })),
    };
  }).sort((left, right) => inventoryRank(left.inventory?.status) - inventoryRank(right.inventory?.status)
    || String(left.label || "").localeCompare(String(right.label || ""), "it"));

  return {
    venue: {
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      ownerOrganizationId: venue.ownerOrganizationId,
    },
    permissions: {
      canCreateContent: authority.effectivePermissions.includes("item.create"),
      canEditInventory: authority.effectivePermissions.includes("venue.physical.edit"),
    },
    view: contextProjection.view,
    targets: projectedTargets,
  };
}

module.exports = { listVenueAuthoringTargets };