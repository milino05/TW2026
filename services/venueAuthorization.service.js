const Venue = require("../models/venue.model");
const AppError = require("../utils/AppError");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");

async function findVenueOrFail({ venueId, includeTrashed = false }) {
  const query = { _id: venueId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const venue = await Venue.findOne(query);
  if (!venue) throw new AppError("Venue non trovata", 404);
  return venue;
}

async function assertVenuePermission({ userId, venueId, permissionCode }) {
  const venue = await findVenueOrFail({ venueId });
  const authority = await assertOrganizationPermission({ userId, organizationId: venue.ownerOrganizationId, permissionCode });
  return { venue, user: authority.user, authority };
}

module.exports = { findVenueOrFail, assertVenuePermission };
