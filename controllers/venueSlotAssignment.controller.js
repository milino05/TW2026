const venueTargetConfigurationCommandService = require("../services/venueTargetConfigurationCommand.service");

async function assignSubject(req, res, next) {
  try {
    const result = await venueTargetConfigurationCommandService.assignSubjectToExhibitSlot({
      venueId: req.params.venueId,
      exhibitSlotId: req.params.exhibitSlotId,
      actorUserId: req.user._id,
      payload: req.body || {},
    });
    res.status(result.venueTargetCreated ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { assignSubject };
