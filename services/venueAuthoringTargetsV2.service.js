const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

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
  const subjects = await Subject.find({ _id: { $in: targets.map((target) => target.subjectId) } }).select("preferredLabel description externalIdentities").lean();
  const targetById = new Map(targets.map((target) => [id(target), target]));
  const subjectById = new Map(subjects.map((subject) => [id(subject), subject]));
  const bindingByTarget = new Map(activeBindings.map((binding) => [id(binding.venueTargetId), binding]));
  return {
    venue: { id: venue._id, name: venue.name, description: venue.description || "" },
    targets: targetIds.map((targetId) => {
      const target = targetById.get(id(targetId));
      if (!target) return null;
      const subject = subjectById.get(id(target.subjectId));
      const binding = bindingByTarget.get(id(targetId));
      return {
        id: target._id,
        label: target.displayLabelOverride || subject?.preferredLabel || "Entità della sede",
        description: target.inventoryNote || subject?.description || "",
        subject: subject ? {
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
        } : { id: target.subjectId, missing: true },
        recognitionMedia: (binding?.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || null })),
      };
    }).filter(Boolean),
  };
}

module.exports = { listVenueAuthoringTargets };
