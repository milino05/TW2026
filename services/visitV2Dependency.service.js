const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");

function id(value) { return String(value?._id || value || ""); }

async function auditVisitsAgainstVenueRelease({ venueId, venueReleaseId }) {
  const release = await VenueRelease.findOne({ _id: venueReleaseId, venueId }).lean();
  if (!release) throw new Error("VenueRelease non trovata per dependency audit");
  const venueTargetIds = await VenueTarget.find({ venueId }).distinct("_id");
  if (!venueTargetIds.length) return { venueId, venueReleaseId, affectedVisits: [] };
  const activeTargetIds = new Set((release.targetBindings || []).filter((binding) => binding.availability === "active").map((binding) => id(binding.venueTargetId)));
  const revisions = await VisitRevisionV2.find({
    status: "published",
    "visitAnchors.venueTargetId": { $in: venueTargetIds },
  }).select("visitId visitAnchors").lean();
  const venueTargetSet = new Set(venueTargetIds.map(id));
  const affectedVisits = [];
  for (const revision of revisions) {
    const unavailable = [...new Set((revision.visitAnchors || [])
      .map((anchor) => id(anchor.venueTargetId))
      .filter((targetId) => venueTargetSet.has(targetId) && !activeTargetIds.has(targetId)))];
    if (!unavailable.length) continue;
    affectedVisits.push({
      visitId: revision.visitId,
      visitRevisionId: revision._id,
      unavailableVenueTargetIds: unavailable,
      code: "VISIT_PHYSICAL_DEPENDENCY_REVALIDATION_REQUIRED",
    });
  }
  return { venueId, venueReleaseId, affectedVisits };
}

module.exports = { auditVisitsAgainstVenueRelease };
