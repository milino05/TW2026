const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");

function commandError(message, code, field = null, statusCode = 400, extra = {}) {
  throw new AppError(message, statusCode, [{ ...(field ? { field } : {}), code, ...extra }]);
}
function id(value) { return String(value?._id || value || ""); }

async function detachVenueTargetFromWorkingConfiguration({ venueId, venueTargetId, actorUserId }) {
  const { venue } = await assertVenuePermission({
    userId: actorUserId,
    venueId,
    permissionCode: "venue.physical.edit",
  });
  if (!venue.workingReleaseId) {
    commandError("Nessuna configurazione fisica di lavoro disponibile", "WORKING_RELEASE_NOT_FOUND", null, 409);
  }

  let commandResult = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const currentVenue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" })
        .select("_id workingReleaseId")
        .session(session);
      if (!currentVenue?.workingReleaseId) {
        commandError("Nessuna configurazione fisica di lavoro disponibile", "WORKING_RELEASE_NOT_FOUND", null, 409);
      }
      const target = await VenueTarget.findOne({
        _id: venueTargetId,
        venueId,
        lifecycleStatus: "active",
      }).session(session);
      if (!target) commandError("Entità della sede non trovata", "VENUE_TARGET_NOT_FOUND", "venueTargetId", 404);

      const release = await VenueRelease.findOne({ _id: currentVenue.workingReleaseId, venueId }).session(session);
      if (!release) commandError("Working VenueRelease non disponibile", "WORKING_RELEASE_NOT_FOUND", null, 409);
      try { markRevisionEdited(release, actorUserId); }
      catch (error) { commandError(error.message, error.code || "REVISION_NOT_EDITABLE", null, 409); }

      const binding = (release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
      const recognitionMediaUrls = (binding?.recognitionMedia || []).map((entry) => String(entry.url || "")).filter(Boolean);
      const hadBinding = Boolean(binding);
      release.targetBindings = (release.targetBindings || []).filter((entry) => id(entry.venueTargetId) !== id(target._id));
      release.updatedBy = actorUserId;
      await release.save({ session });

      commandResult = {
        venueId,
        venueTargetId: target._id,
        releaseId: release._id,
        detached: hadBinding,
        removedBinding: hadBinding,
        recognitionMediaUrls,
      };
    });
    return commandResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Rimozione dell’entità dalla configurazione non completata", 500, [{
      code: "VENUE_TARGET_DETACH_FAILED",
      message: error.message,
    }]);
  }
}

module.exports = {
  detachVenueTargetFromWorkingConfiguration,
};