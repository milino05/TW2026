const { addVenueSubjectToInventory } = require("../services/venueInventoryCommand.service");

async function createTarget(req, res, next) {
  try {
    const result = await addVenueSubjectToInventory({
      venueId: req.params.venueId,
      payload: req.body || {},
      actorUserId: req.user._id,
    });
    res.status(result.created ? 201 : 200).json(result.target);
  } catch (error) { next(error); }
}

module.exports = { createTarget };
