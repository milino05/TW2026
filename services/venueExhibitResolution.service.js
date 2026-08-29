const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function exhibitSlotEntryMap(layoutRevision) {
  return new Map((layoutRevision?.exhibitSlots || []).map((entry) => [id(entry.exhibitSlotId), entry]));
}

function bindingMap(venueRelease) {
  return new Map((venueRelease?.targetBindings || []).map((entry) => [id(entry.venueTargetId), entry]));
}

function resolveVenueTargetExhibit({ venueRelease, layoutRevision, venueTargetId, requireAvailable = true }) {
  const binding = bindingMap(venueRelease).get(id(venueTargetId));
  if (!binding) throw new AppError("Entità non inclusa nella VenueRelease", 409, [{ code: "VENUE_TARGET_NOT_BOUND", context: { venueTargetId } }]);
  if (requireAvailable && binding.availability !== "active") throw new AppError("Entità non disponibile nella VenueRelease", 409, [{ code: "VENUE_TARGET_UNAVAILABLE", context: { venueTargetId } }]);
  if (!binding.exhibitSlotId) throw new AppError("Entità non assegnata a uno slot espositivo", 409, [{ code: "VENUE_TARGET_UNPLACED", context: { venueTargetId } }]);
  const exhibitSlot = exhibitSlotEntryMap(layoutRevision).get(id(binding.exhibitSlotId));
  if (!exhibitSlot) throw new AppError("Slot assegnato non presente nella LayoutRevision", 409, [{ code: "EXHIBIT_SLOT_NOT_IN_LAYOUT", context: { venueTargetId, exhibitSlotId: binding.exhibitSlotId } }]);
  const place = (layoutRevision?.places || []).find((entry) => id(entry._id) === id(exhibitSlot.placeId));
  if (!place) throw new AppError("Luogo dello slot non presente nella LayoutRevision", 409, [{ code: "EXHIBIT_SLOT_PLACE_MISSING", context: { exhibitSlotId: binding.exhibitSlotId, placeId: exhibitSlot.placeId } }]);
  return { binding, exhibitSlot, place };
}

function resolveApproachInstruction({ layoutRevision, destinationExhibitSlotId, sourceExhibitSlotId = null, incomingConnectionId = null }) {
  const destination = exhibitSlotEntryMap(layoutRevision).get(id(destinationExhibitSlotId));
  if (!destination) return null;
  const overrides = destination.approachGuidance?.overrides || [];
  if (sourceExhibitSlotId) {
    const source = exhibitSlotEntryMap(layoutRevision).get(id(sourceExhibitSlotId));
    if (source && id(source.placeId) === id(destination.placeId)) {
      const fromSlot = overrides.find((entry) => entry.sourceKind === "exhibit_slot" && id(entry.sourceExhibitSlotId) === id(sourceExhibitSlotId));
      if (fromSlot?.instruction) return fromSlot.instruction;
    }
  }
  if (incomingConnectionId) {
    const fromConnection = overrides.find((entry) => entry.sourceKind === "incoming_connection" && id(entry.sourceConnectionId) === id(incomingConnectionId));
    if (fromConnection?.instruction) return fromConnection.instruction;
  }
  if (destination.approachGuidance?.defaultInstruction) return destination.approachGuidance.defaultInstruction;
  return `Cerca “${destination.label}” all'interno del luogo raggiunto.`;
}

module.exports = {
  id,
  exhibitSlotEntryMap,
  bindingMap,
  resolveVenueTargetExhibit,
  resolveApproachInstruction,
};
