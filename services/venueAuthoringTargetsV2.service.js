const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
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

async function listVenueAuthoringTargets({ venueId }) {
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" })
    .select("name description publishedReleaseId")
    .lean();
  if (!venue) throw new AppError("Venue non disponibile", 404);
  if (!venue.publishedReleaseId) {
    return { venue: { id: venue._id, name: venue.name, description: venue.description || "" }, targets: [] };
  }
  const release = await VenueRelease.findById(venue.publishedReleaseId).select("targetBindings").lean();
  if (!release) throw new AppError("VenueRelease pubblicata non disponibile", 409);
  const activeBindings = (release.targetBindings || []).filter((binding) => binding.availability === "active" && binding.exhibitSlotId);
  const targetIds = activeBindings.map((binding) => binding.venueTargetId);
  if (!targetIds.length) return { venue: { id: venue._id, name: venue.name, description: venue.description || "" }, targets: [] };
  const targets = await VenueTarget.find({ _id: { $in: targetIds }, venueId: venue._id, lifecycleStatus: "active" }).lean();
  const targetById = new Map(targets.map((target) => [id(target), target]));
  const bindingByTarget = new Map(activeBindings.map((binding) => [id(binding.venueTargetId), binding]));
  const [identityByTargetId, contextProjection] = await Promise.all([
    venueTargetIdentityMap(targets),
    projectVenueSubjectContext({ venueId: venue._id, subjectIds: targets.map((target) => target.subjectId), view: "published" }),
  ]);
  const contextBySubjectId = venueSubjectContextMap(contextProjection);
  return {
    venue: { id: venue._id, name: venue.name, description: venue.description || "" },
    targets: targetIds.map((targetId) => {
      const target = targetById.get(id(targetId));
      if (!target) return null;
      const identity = identityByTargetId.get(id(targetId)) || {};
      const binding = bindingByTarget.get(id(targetId));
      const subjectContext = contextBySubjectId.get(id(target.subjectId)) || {
        inventory: null,
        museumContent: { availableCount: 0, draftCount: 0 },
      };
      return {
        id: target._id,
        label: identity.label || "Entità della sede",
        description: identity.description || "",
        subject: projectSubject(identity.subject, target.subjectId),
        inventory: subjectContext.inventory,
        museumContent: subjectContext.museumContent,
        recognitionMedia: (binding?.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || null })),
      };
    }).filter(Boolean),
  };
}

module.exports = { listVenueAuthoringTargets };
