const { listVenueAuthoringTargets } = require("../services/venueAuthoringTargetsV2.service");

async function venueAuthoringTargets(req, res, next) {
  try {
    res.status(200).json(await listVenueAuthoringTargets({ venueId: req.params.venueId }));
  } catch (error) { next(error); }
}

module.exports = { venueAuthoringTargets };
