const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { ensureWorkingVenueRelease } = require("./venueRelease.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");

function id(value) { return String(value?._id || value || ""); }
function commandError(message, code, field = null, statusCode = 400, extra = {}) {
  throw new AppError(message, statusCode, [{ ...(field ? { field } : {}), code, ...extra }]);
}
function assertAllowedFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) commandError("payload deve essere un oggetto", "INVALID_TYPE", "payload");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) commandError(`Campo non supportato: ${key}`, "UNKNOWN_FIELD", key);
}
function requiredText(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) commandError(`${field} e obbligatorio`, "REQUIRED", field);
  if (normalized.length > maxLength) commandError(`${field} troppo lungo`, "MAX_LENGTH", field, 400, { maxLength });
  return normalized;
}
function optionalText(value, field, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > maxLength) commandError(`${field} troppo lungo`, "MAX_LENGTH", field, 400, { maxLength });
  return normalized || null;
}

async function mutateTargetBinding({ venueId, venueTargetId, actorUserId, mutate }) {
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
      const release = await VenueRelease.findOne({ _id: ensured.release._id, venueId }).session(session);
      const target = await VenueTarget.findOne({ _id: venueTargetId, venueId, lifecycleStatus: "active" }).session(session);
      if (!release) commandError("Bozza fisica non disponibile", "WORKING_RELEASE_NOT_FOUND", null, 409);
      if (!target) commandError("Oggetto della sede non trovato", "VENUE_TARGET_NOT_FOUND", "venueTargetId", 404);
      try { markRevisionEdited(release, actorUserId); }
      catch (error) { commandError(error.message, error.code || "REVISION_NOT_EDITABLE", null, 409); }
      let binding = (release.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id));
      if (!binding) {
        release.targetBindings.push({ venueTargetId: target._id, exhibitSlotId: null, availability: "active", recognitionMedia: [] });
        binding = release.targetBindings.at(-1);
      }
      const result = await mutate({ release, target, binding, session });
      release.updatedBy = actorUserId;
      await release.save({ session });
      commandResult = { venueId, venueTargetId: target._id, releaseId: release._id, result };
    });
    return commandResult;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Comando sul binding fisico dell'oggetto non completato", 500, [{ code: "VENUE_TARGET_BINDING_COMMAND_FAILED", message: error.message }]);
  }
}

async function setAvailability({ venueId, venueTargetId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["availability"]);
  return mutateTargetBinding({ venueId, venueTargetId, actorUserId, mutate: ({ binding }) => {
    const availability = String(payload.availability || "");
    if (!["active", "unavailable"].includes(availability)) {
      commandError("Disponibilita non valida", "INVALID_AVAILABILITY", "availability");
    }
    binding.availability = availability;
    return { availability };
  } });
}

async function addRecognitionMedia({ venueId, venueTargetId, actorUserId, payload = {} }) {
  assertAllowedFields(payload, ["url", "altText"]);
  return mutateTargetBinding({ venueId, venueTargetId, actorUserId, mutate: ({ binding }) => {
    const url = requiredText(payload.url, "url", 2000);
    if ((binding.recognitionMedia || []).some((entry) => entry.url === url)) {
      commandError("Immagine di riconoscimento gia presente", "DUPLICATE_RECOGNITION_MEDIA", "url", 409);
    }
    binding.recognitionMedia.push({ url, altText: optionalText(payload.altText, "altText", 500) });
    const media = binding.recognitionMedia.at(-1);
    return { mediaId: media._id, url: media.url, altText: media.altText };
  } });
}

async function removeRecognitionMedia({ venueId, venueTargetId, mediaId, actorUserId }) {
  return mutateTargetBinding({ venueId, venueTargetId, actorUserId, mutate: ({ binding }) => {
    const media = binding.recognitionMedia?.id(mediaId);
    if (!media) commandError("Immagine di riconoscimento non trovata", "RECOGNITION_MEDIA_NOT_FOUND", "mediaId", 404);
    const removed = { mediaId: media._id, url: media.url, altText: media.altText };
    binding.recognitionMedia.pull(media._id);
    return removed;
  } });
}

module.exports = { setAvailability, addRecognitionMedia, removeRecognitionMedia };
