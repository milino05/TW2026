const { listVenueAuthoringTargets } = require("../services/venueAuthoringTargetsV2.service");
const { getEditorialReleaseComposer } = require("../services/editorialReleaseComposerV2.service");

async function venueAuthoringTargets(req, res, next) {
  try {
    res.status(200).json(await listVenueAuthoringTargets({ venueId: req.params.venueId }));
  } catch (error) { next(error); }
}

async function editorialReleaseComposer(req, res, next) {
  try {
    res.status(200).json(await getEditorialReleaseComposer({
      editorialContextId: req.params.editorialContextId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

module.exports = { venueAuthoringTargets, editorialReleaseComposer };
