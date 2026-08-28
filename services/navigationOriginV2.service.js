const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
const DEFAULT_OBSERVATION_MAX_AGE_MS = 30_000;

function isFreshLocationObservation(observation, { now = new Date(), maxAgeMs = DEFAULT_OBSERVATION_MAX_AGE_MS } = {}) {
  const observedAt = Date.parse(String(observation?.observedAt || ""));
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const age = currentTime - observedAt;
  return Number.isFinite(observedAt)
    && Number.isFinite(currentTime)
    && Number.isFinite(maxAgeMs)
    && maxAgeMs >= 0
    && age >= 0
    && age <= maxAgeMs;
}

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

function resolveNavigationOrigin({
  session,
  plan,
  explicitOrigin = null,
  locationObservation = null,
  now = new Date(),
  observationMaxAgeMs = DEFAULT_OBSERVATION_MAX_AGE_MS,
} = {}) {
  if (explicitOrigin?.venueId && explicitOrigin?.placeId) {
    return {
      venueId: explicitOrigin.venueId,
      placeId: explicitOrigin.placeId,
      provenance: "explicit",
    };
  }

  const observedLocation = locationObservation?.location || null;
  if (isFreshLocationObservation(locationObservation, { now, maxAgeMs: observationMaxAgeMs }) && observedLocation?.venueId && observedLocation?.placeId) {
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
  DEFAULT_OBSERVATION_MAX_AGE_MS,
  isFreshLocationObservation,
  logicalAnchorForIndex,
  resolveNavigationOrigin,
};
