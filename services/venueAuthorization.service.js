const Venue = require("../models/venue.model");
const AppError = require("../utils/AppError");
const { assertOrganizationRole } = require("./organizationAuthorization.service");

async function findVenueOrFail({ venueId, includeTrashed = false }) {
  const query = { _id: venueId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const venue = await Venue.findOne(query);
  if (!venue) throw new AppError("Venue non trovata", 404);
  return venue;
}

async function assertVenueRole({ userId, venueId, minimumRole = "operator" }) {
  const venue = await findVenueOrFail({ venueId });
  const user = await assertOrganizationRole({
    userId,
    organizationId: venue.ownerOrganizationId,
    minimumRole,
  });
  return { venue, user };
}

module.exports = { findVenueOrFail, assertVenueRole };
