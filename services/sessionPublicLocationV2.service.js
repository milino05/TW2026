const ExhibitSlot = require("../models/exhibitSlot.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const AppError = require("../utils/AppError");
const { getCurrentSessionPlanV2 } = require("./sessionPlanV2.service");

function id(value) { return String(value?._id || value || ""); }

function normalizePublicCode(value) {
  const code = String(value || "").trim();
  if (!code) throw new AppError("Codice pubblico mancante", 400, [{ field: "publicCode", code: "PUBLIC_LOCATION_CODE_REQUIRED" }]);
  if (code.length > 128) throw new AppError("Codice pubblico non valido", 400, [{ field: "publicCode", code: "PUBLIC_LOCATION_CODE_INVALID" }]);
  return code;
}

function locationFromBundle({ slot, release, layout, requireActiveBinding = true }) {
  const slotEntry = (layout.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(slot._id));
  if (!slotEntry) throw new AppError("Slot non presente nello snapshot fisico", 409, [{ code: "PUBLIC_LOCATION_NOT_IN_SNAPSHOT", context: { exhibitSlotId: slot._id } }]);
  const binding = (release.targetBindings || []).find((entry) => id(entry.exhibitSlotId) === id(slot._id));
  if (!binding || (requireActiveBinding && binding.availability !== "active")) throw new AppError("Slot non esposto nello snapshot fisico", 409, [{ code: "PUBLIC_LOCATION_NOT_EXPOSED", context: { exhibitSlotId: slot._id } }]);
  const place = (layout.places || []).find((entry) => id(entry._id) === id(slotEntry.placeId));
  const floor = place ? (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId)) : null;
  if (!place || !floor) throw new AppError("Posizione logica dello slot non disponibile", 409, [{ code: "PUBLIC_LOCATION_PLACE_MISSING", context: { exhibitSlotId: slot._id, placeId: slotEntry.placeId } }]);
  return {
    location: {
      venueId: id(slot.venueId),
      floorId: id(floor._id),
      placeId: id(place._id),
      exhibitSlotId: id(slot._id),
      venueTargetId: id(binding.venueTargetId),
    },
  };
}

async function resolvePublicCodeLocation({ sessionId, userId, publicCode }) {
  const code = normalizePublicCode(publicCode);
  const { session } = await getCurrentSessionPlanV2({ sessionId, userId });
  const slot = await ExhibitSlot.findOne({ publicCode: code }).select("_id venueId publicCode lifecycleStatus").lean();
  if (!slot) throw new AppError("Riferimento fisico non disponibile", 404, [{ field: "publicCode", code: "PUBLIC_LOCATION_NOT_FOUND" }]);
  const pin = (session.venuePins || []).find((entry) => id(entry.venueId) === id(slot.venueId));
  if (!pin) throw new AppError("Riferimento fisico non disponibile in questa sessione", 404, [{ field: "publicCode", code: "PUBLIC_LOCATION_OUTSIDE_SESSION_SCOPE" }]);
  const [release, layout] = await Promise.all([
    VenueRelease.findOne({ _id: pin.venueReleaseId, venueId: pin.venueId }).lean(),
    LayoutRevision.findOne({ _id: pin.layoutRevisionId, venueId: pin.venueId }).lean(),
  ]);
  if (!release || !layout || id(release.layoutRevisionId) !== id(layout._id)) {
    throw new AppError("Snapshot fisico pinzato non disponibile", 409, [{ code: "PUBLIC_LOCATION_PINNED_SNAPSHOT_MISSING" }]);
  }
  return locationFromBundle({ slot, release, layout });
}

async function resolveCurrentPublishedPublicCode({ publicCode }) {
  const code = normalizePublicCode(publicCode);
  const slot = await ExhibitSlot.findOne({ publicCode: code, lifecycleStatus: "active" }).select("_id venueId publicCode").lean();
  if (!slot) throw new AppError("Riferimento fisico non disponibile", 404, [{ field: "publicCode", code: "PUBLIC_LOCATION_NOT_FOUND" }]);
  const venue = await Venue.findOne({ _id: slot.venueId, lifecycleStatus: "active", publishedReleaseId: { $ne: null } }).select("publishedReleaseId").lean();
  if (!venue) throw new AppError("Sede pubblicata non disponibile", 404, [{ code: "PUBLIC_LOCATION_VENUE_NOT_PUBLISHED" }]);
  const release = await VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: slot.venueId, status: "published" }).lean();
  const layout = release ? await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: slot.venueId, status: "published" }).lean() : null;
  if (!release || !layout) throw new AppError("Snapshot fisico pubblicato non disponibile", 409, [{ code: "PUBLIC_LOCATION_SNAPSHOT_MISSING" }]);
  return locationFromBundle({ slot, release, layout });
}

module.exports = { resolvePublicCodeLocation, resolveCurrentPublishedPublicCode, locationFromBundle };
