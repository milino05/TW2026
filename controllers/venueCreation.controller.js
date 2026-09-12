const venueCreationService = require("../services/venueCreation.service");

async function preflight(req, res, next) {
  try {
    res.status(200).json(await venueCreationService.getVenueCreationPreflight({
      organizationId: req.query?.ownerOrganizationId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    res.status(201).json(await venueCreationService.createConfiguredVenue({
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = { preflight, create };
