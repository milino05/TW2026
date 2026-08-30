const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const ExhibitSlot = require("../models/exhibitSlot.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { ensureWorkingVenueRelease } = require("./venueRelease.service");
const { ensureVenueEntity } = require("./venueTarget.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");

function id(value) { return String(value?._id || value || ""); }
function commandError(message, code, field = null, statusCode = 400, extra = {}) {
  throw new AppError(message, statusCode, [{ ...(field ? { field } : {}), code, ...extra }]);
}
function assertAllowedFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) commandError("payload deve essere un oggetto", "INVALID_TYPE", "payload");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) commandError(`Campo non supportato: ${key}`, "UNKNOWN_FIELD", key);
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

async function assignSubjectToExhibitSlot({ venueId, exhibitSlotId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["subjectId", "displayLabelOverride", "inventoryNote"]);
  const ensured = await ensureWorkingVenueRelease({ venueId, actorUserId });
  let commandResult = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const currentVenue = await Venue.findOne({
        _id: venueId,
        lifecycleStatus: "active",
        workingReleaseId: ensured.release._id,
      }).select("_id workingReleaseId").session(session);
      if (!currentVenue) commandError("La bozza fisica è cambiata durante il comando", "WORKING_RELEASE_CHANGED", null, 409);

      const [release, layout, slot] = await Promise.all([
        VenueRelease.findOne({ _id: ensured.release._id, venueId }).session(session),
        LayoutRevision.findOne({ _id: ensured.layout._id, venueId }).session(session),
        ExhibitSlot.findOne({ _id: exhibitSlotId, venueId, lifecycleStatus: "active" }).session(session),
      ]);
      if (!release || !layout) commandError("Bozza fisica non disponibile", "WORKING_LAYOUT_NOT_FOUND", null, 409);
      if (!slot) commandError("Slot espositivo non trovato", "EXHIBIT_SLOT_NOT_FOUND", "exhibitSlotId", 404);
      const slotEntry = (layout.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(slot._id));
      if (!slotEntry) commandError("Slot espositivo non presente nella configurazione di lavoro", "EXHIBIT_SLOT_NOT_IN_LAYOUT", "exhibitSlotId", 409);

      try { markRevisionEdited(release, actorUserId); }
      catch (error) { commandError(error.message, error.code || "REVISION_NOT_EDITABLE", null, 409); }

      const ensuredTarget = await ensureVenueEntity({
        venueId,
        actorUserId,
        session,
        skipAuthorization: true,
        payload: {
          subjectId: payload.subjectId,
          displayLabelOverride: payload.displayLabelOverride || null,
          inventoryNote: payload.inventoryNote || null,
          provenance: { origin: "human" },
        },
      });
      const target = ensuredTarget.target;

      let replacedVenueTargetId = null;
      for (const binding of release.targetBindings || []) {
        if (id(binding.exhibitSlotId) === id(slot._id) && id(binding.venueTargetId) !== id(target._id)) {
          replacedVenueTargetId = binding.venueTargetId;
          binding.exhibitSlotId = null;
        }
      }

      let binding = (release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
      const previousExhibitSlotId = binding?.exhibitSlotId || null;
      if (!binding) {
        release.targetBindings.push({
          venueTargetId: target._id,
          exhibitSlotId: slot._id,
          availability: "active",
          recognitionMedia: [],
        });
        binding = release.targetBindings.at(-1);
      } else {
        binding.exhibitSlotId = slot._id;
      }

      release.updatedBy = actorUserId;
      await release.save({ session });
      commandResult = {
        venueId,
        releaseId: release._id,
        exhibitSlotId: slot._id,
        venueTargetId: target._id,
        subjectId: target.subjectId,
        venueTargetCreated: ensuredTarget.created,
        previousExhibitSlotId,
        replacedVenueTargetId,
        availability: binding.availability,
      };
    });
    return commandResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Assegnazione del Subject allo slot non completata", 500, [{
      code: "EXHIBIT_SLOT_SUBJECT_ASSIGNMENT_FAILED",
      message: error.message,
    }]);
  }
}

module.exports = {
  detachVenueTargetFromWorkingConfiguration,
  assignSubjectToExhibitSlot,
};
