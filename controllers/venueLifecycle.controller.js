const venueService = require("../services/venue.service");
const { assertVenuePermission } = require("../services/venueAuthorization.service");

async function impact(req, res, next) {
  try {
    await assertVenuePermission({ userId: req.user._id, venueId: req.params.venueId, permissionCode: "venue.lifecycle.manage" });
    const value = await venueService.getVenueLifecycleImpact({ venueId: req.params.venueId });
    res.status(200).json(value);
  } catch (error) { next(error); }
}

async function trash(req, res, next) {
  try {
    res.status(200).json(await venueService.trashVenue({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function restore(req, res, next) {
  try {
    res.status(200).json(await venueService.restoreVenue({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = { impact, trash, restore };
