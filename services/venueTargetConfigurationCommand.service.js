const mongoose = require("mongoose");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");

function id(value) { return String(value?._id || value || ""); }
function commandError(message, code, field = null, statusCode = 400, extra = {}) {
  throw new AppError(message, statusCode, [{ ...(field ? { field } : {}), code, ...extra }]);
}

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
      const target = await VenueTarget.findOne({
        _id: venueTargetId,
        venueId,
        lifecycleStatus: "active",
      }).session(session);
      if (!target) commandError("Oggetto della sede non trovato", "VENUE_TARGET_NOT_FOUND", "venueTargetId", 404);

      const release = await VenueRelease.findOne({ _id: venue.workingReleaseId, venueId }).session(session);
      if (!release) commandError("Working VenueRelease non disponibile", "WORKING_RELEASE_NOT_FOUND", null, 409);
      const layout = await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId }).session(session);
      if (!layout) commandError("LayoutRevision di lavoro non disponibile", "WORKING_LAYOUT_NOT_FOUND", null, 409);

      try { markRevisionEdited(release, actorUserId); }
      catch (error) { commandError(error.message, error.code || "REVISION_NOT_EDITABLE", null, 409); }

      const binding = (release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
      const recognitionMediaUrls = (binding?.recognitionMedia || []).map((entry) => String(entry.url || "")).filter(Boolean);
      const hadBinding = Boolean(binding);
      const hadPlacement = (layout.venueTargetPlacements || []).some((entry) => id(entry.venueTargetId) === id(target._id));

      release.targetBindings = (release.targetBindings || []).filter((entry) => id(entry.venueTargetId) !== id(target._id));
      layout.venueTargetPlacements = (layout.venueTargetPlacements || []).filter((entry) => id(entry.venueTargetId) !== id(target._id));
      release.updatedBy = actorUserId;
      layout.updatedBy = actorUserId;

      await layout.save({ session });
      await release.save({ session });

      commandResult = {
        venueId,
        venueTargetId: target._id,
        releaseId: release._id,
        layoutRevisionId: layout._id,
        detached: hadBinding || hadPlacement,
        removedBinding: hadBinding,
        removedPlacement: hadPlacement,
        recognitionMediaUrls,
      };
    });
    return commandResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Rimozione dell'oggetto dalla configurazione non completata", 500, [{
      code: "VENUE_TARGET_DETACH_FAILED",
      message: error.message,
    }]);
  }
}

module.exports = { detachVenueTargetFromWorkingConfiguration };
