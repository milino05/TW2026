function id(value) { return String(value?._id || value || ""); }

const EXECUTION_PHASES = Object.freeze({
  LOCATION_REQUIRED: "location_required",
  NAVIGATING_TO_VISIT_STOP: "navigating_to_visit_stop",
  APPROACHING_VISIT_TARGET: "approaching_visit_target",
  PRESENTING_VISIT_CONTENT: "presenting_visit_content",
  PRESENTING_SEMANTIC_CONTENT: "presenting_semantic_content",
  NAVIGATING_DETOUR: "navigating_detour",
  AT_DETOUR_DESTINATION: "at_detour_destination",
  ROUTE_COMPLETED: "route_completed",
});

function anchorById(plan, anchorId) {
  if (!anchorId) return null;
  return (plan?.visitAnchors || []).find((anchor) => id(anchor._id) === id(anchorId)) || null;
}

function entryAt(plan, index) {
  const entries = plan?.contentEntries || [];
  if (!entries.length) return null;
  const value = Number(index);
  if (!Number.isInteger(value) || value < 0 || value >= entries.length) return null;
  return entries[value] || null;
}

function deliveryAnchorForIndex(plan, index) {
  const entry = entryAt(plan, index);
  return entry?.deliveryAnchorId ? anchorById(plan, entry.deliveryAnchorId) : null;
}

function contextAnchorForIndex(plan, index) {
  const entries = plan?.contentEntries || [];
  for (let cursor = Math.min(Number(index) || 0, entries.length - 1); cursor >= 0; cursor -= 1) {
    const anchor = deliveryAnchorForIndex(plan, cursor);
    if (anchor) return anchor;
  }
  return null;
}

function hasPhysicalStops(plan) {
  return Boolean((plan?.visitAnchors || []).length);
}

function locationMatchesPlace(location, target) {
  return Boolean(location?.venueId && location?.placeId && target?.venueId && target?.placeId
    && id(location.venueId) === id(target.venueId)
    && id(location.placeId) === id(target.placeId));
}

function knownLocationSatisfiesAnchor(location, anchor) {
  if (!location || !anchor) return false;
  if (location.visitAnchorId && id(location.visitAnchorId) === id(anchor._id)) return true;
  return Boolean(location.exhibitSlotId && anchor.exhibitSlotId
    && id(location.venueId) === id(anchor.venueId)
    && id(location.exhibitSlotId) === id(anchor.exhibitSlotId));
}

function detourDestinationReached(location, detour) {
  return locationMatchesPlace(location, detour?.destination);
}

function semanticPresentationForEntry(session, entry) {
  const semantic = session?.semanticPresentation || null;
  if (!semantic || !entry) return null;
  return id(semantic.sourceContentEntryId) === id(entry._id) ? semantic : null;
}

function deriveVisitExecutionState({ personalSession, plan, currentEntryIndex, effectiveStatus = null } = {}) {
  const entry = entryAt(plan, currentEntryIndex);
  const deliveryAnchor = deliveryAnchorForIndex(plan, currentEntryIndex);
  const contextAnchor = contextAnchorForIndex(plan, currentEntryIndex);
  const knownLocation = personalSession?.physicalRuntime?.knownLocation || null;
  const detour = personalSession?.physicalRuntime?.detour || null;
  const status = effectiveStatus || personalSession?.status || null;

  const result = (phase, presentationAvailable = false) => ({
    phase,
    presentationAvailable,
    entry,
    deliveryAnchor,
    contextAnchor,
    knownLocation,
    detour,
  });

  if (status === "route_completed" || (!entry && (plan?.contentEntries || []).length)) {
    return result(EXECUTION_PHASES.ROUTE_COMPLETED, false);
  }

  if (!entry) return result(EXECUTION_PHASES.ROUTE_COMPLETED, false);

  if (detour) {
    return result(
      detourDestinationReached(knownLocation, detour)
        ? EXECUTION_PHASES.AT_DETOUR_DESTINATION
        : EXECUTION_PHASES.NAVIGATING_DETOUR,
      false,
    );
  }

  if (semanticPresentationForEntry(personalSession, entry)) {
    return result(EXECUTION_PHASES.PRESENTING_SEMANTIC_CONTENT, true);
  }

  // A truly location-independent ContentEntry has no delivery gate even when
  // the same visit contains physical stops elsewhere. Location is requested
  // only when the current narrative target actually needs a VisitAnchor.
  if (!deliveryAnchor) {
    return result(EXECUTION_PHASES.PRESENTING_VISIT_CONTENT, true);
  }

  if (!knownLocation && hasPhysicalStops(plan)) {
    return result(EXECUTION_PHASES.LOCATION_REQUIRED, false);
  }

  if (knownLocationSatisfiesAnchor(knownLocation, deliveryAnchor)) {
    return result(EXECUTION_PHASES.PRESENTING_VISIT_CONTENT, true);
  }

  if (locationMatchesPlace(knownLocation, deliveryAnchor)) {
    return result(EXECUTION_PHASES.APPROACHING_VISIT_TARGET, false);
  }

  return result(EXECUTION_PHASES.NAVIGATING_TO_VISIT_STOP, false);
}

module.exports = {
  EXECUTION_PHASES,
  anchorById,
  entryAt,
  deliveryAnchorForIndex,
  contextAnchorForIndex,
  hasPhysicalStops,
  locationMatchesPlace,
  knownLocationSatisfiesAnchor,
  detourDestinationReached,
  semanticPresentationForEntry,
  deriveVisitExecutionState,
};