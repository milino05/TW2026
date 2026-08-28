const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function anchorMap(plan) {
  return new Map((plan?.visitAnchors || []).map((anchor) => [id(anchor._id), anchor]));
}

function logicalAnchorForIndex(plan, index) {
  const anchors = anchorMap(plan);
  for (let cursor = Math.min(Number(index) || 0, (plan?.contentEntries || []).length - 1); cursor >= 0; cursor -= 1) {
    const anchorId = plan.contentEntries[cursor]?.deliveryAnchorId;
    if (anchorId && anchors.has(id(anchorId))) return anchors.get(id(anchorId));
  }
  return null;
}

function resolveNavigationOrigin({ session, plan, explicitOrigin = null, locationObservation = null } = {}) {
  if (explicitOrigin?.venueId && explicitOrigin?.placeId) {
    return {
      venueId: explicitOrigin.venueId,
      placeId: explicitOrigin.placeId,
      provenance: "explicit",
    };
  }

  const observedLocation = locationObservation?.location || null;
  if (locationObservation?.isFresh === true && observedLocation?.venueId && observedLocation?.placeId) {
    return {
      venueId: observedLocation.venueId,
      placeId: observedLocation.placeId,
      provenance: "physical_observation",
      providerId: locationObservation.providerId || null,
      observedAt: locationObservation.observedAt || null,
      venueTargetId: observedLocation.venueTargetId || null,
    };
  }

  const anchor = logicalAnchorForIndex(plan, session?.currentEntryIndex);
  if (anchor?.venueId && anchor?.placeId) {
    return {
      venueId: anchor.venueId,
      placeId: anchor.placeId,
      provenance: "logical_anchor",
      visitAnchorId: anchor._id,
      venueTargetId: anchor.venueTargetId,
    };
  }

  throw new AppError("La Session non possiede un'origine utilizzabile per la navigazione", 409, [{
    code: "NAVIGATION_ORIGIN_REQUIRED",
  }]);
}

module.exports = {
  logicalAnchorForIndex,
  resolveNavigationOrigin,
};
