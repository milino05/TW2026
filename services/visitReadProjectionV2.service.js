const VenueTarget = require("../models/venueTarget.model");
const Venue = require("../models/venue.model");

function id(value) {
  return String(value?._id || value || "");
}

async function projectVisitPhysicalScope(revision) {
  const targetIds = [...new Set((revision?.visitAnchors || []).map((entry) => id(entry.venueTargetId)).filter(Boolean))];
  const targets = targetIds.length
    ? await VenueTarget.find({ _id: { $in: targetIds }, lifecycleStatus: "active" }).select("_id venueId label").lean()
    : [];
  const targetById = new Map(targets.map((entry) => [id(entry._id), entry]));
  const venueIds = [...new Set(targets.map((entry) => id(entry.venueId)).filter(Boolean))];
  const venues = venueIds.length
    ? await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).select("_id name description ownerOrganizationId publishedReleaseId").lean()
    : [];
  const venueById = new Map(venues.map((entry) => [id(entry._id), entry]));
  const orderedVenueIds = [];
  for (const anchor of revision?.visitAnchors || []) {
    const target = targetById.get(id(anchor.venueTargetId));
    const venueId = id(target?.venueId);
    if (venueId && !orderedVenueIds.includes(venueId)) orderedVenueIds.push(venueId);
  }
  return {
    venues: orderedVenueIds.map((venueId) => {
      const venue = venueById.get(venueId);
      return venue ? { id: venue._id, name: venue.name, description: venue.description || "" } : null;
    }).filter(Boolean),
    stopCount: (revision?.visitAnchors || []).length,
    resolvableTargetCount: targets.length,
  };
}

function configuredVenueMatches(physicalScope, configuredVenueId) {
  if (!configuredVenueId) return true;
  return (physicalScope?.venues || []).some((venue) => id(venue.id) === id(configuredVenueId));
}

module.exports = {
  projectVisitPhysicalScope,
  configuredVenueMatches,
};
