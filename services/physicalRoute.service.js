const mongoose = require("mongoose");

function id(value) { return String(value?._id || value || ""); }
function newObjectId() { return new mongoose.Types.ObjectId(); }
function plain(value) { return value?.toObject ? value.toObject() : { ...value }; }

function targetEntries(contentEntries = []) {
  return contentEntries.filter((entry) => entry.spatialMode === "target");
}

function targetEntryIndex(contentEntries = []) {
  const result = new Map();
  contentEntries.forEach((entry, index) => {
    if (entry.spatialMode === "target") result.set(id(entry._id || entry.sourceContentEntryId), index);
  });
  return result;
}

function anchorMap(physicalRoute = {}) {
  return new Map((physicalRoute.anchors || []).map((anchor) => [id(anchor._id), anchor]));
}

function contentTargetAnchorMap(physicalRoute = {}) {
  const result = new Map();
  for (const anchor of physicalRoute.anchors || []) {
    if (anchor.kind === "content_target" && anchor.contentEntryId) result.set(id(anchor.contentEntryId), anchor);
  }
  return result;
}

function startAnchor(physicalRoute = {}) {
  return (physicalRoute.anchors || []).find((anchor) => anchor.purpose === "start") || null;
}

function assignDeliveryAnchors(contentEntries = [], physicalRoute = {}) {
  const byEntry = contentTargetAnchorMap(physicalRoute);
  let currentAnchor = startAnchor(physicalRoute);
  return contentEntries.map((entry) => {
    const copy = plain(entry);
    if (copy.spatialMode === "target") {
      const targetAnchor = byEntry.get(id(copy._id || copy.sourceContentEntryId));
      if (targetAnchor) currentAnchor = targetAnchor;
    }
    copy.deliveryAnchorId = currentAnchor?._id || null;
    return copy;
  });
}

function timingFromPlan(contentEntries = [], physicalRoute = {}, reservedSeconds = 0) {
  const contentSeconds = contentEntries.reduce((sum, entry) => sum + (Number(entry.estimatedContentSeconds ?? entry.targetSeconds) || 0), 0);
  const observationSeconds = (physicalRoute.anchors || []).reduce((sum, anchor) => sum + (Number(anchor.estimatedObservationSeconds) || 0), 0);
  const logisticsSeconds = (physicalRoute.legs || []).reduce((sum, leg) => sum + (Number(leg.estimatedSeconds) || 0), 0);
  return {
    contentSeconds: Math.round(contentSeconds),
    observationSeconds: Math.round(observationSeconds),
    logisticsSeconds: Math.round(logisticsSeconds),
    totalSeconds: Math.round(contentSeconds + observationSeconds + logisticsSeconds),
    reservedSeconds: Math.round(Number(reservedSeconds) || 0),
  };
}

function entryAnchor(contentEntry, physicalRoute = {}) {
  if (!contentEntry?.deliveryAnchorId) return null;
  return anchorMap(physicalRoute).get(id(contentEntry.deliveryAnchorId)) || null;
}

function routeLegsAfterEntry(contentEntries = [], physicalRoute = {}, currentEntryIndex = -1) {
  const indexByEntry = new Map(contentEntries.map((entry, index) => [id(entry._id), index]));
  const anchors = anchorMap(physicalRoute);
  return (physicalRoute.legs || []).filter((leg) => {
    const target = anchors.get(id(leg.toAnchorId));
    if (!target?.contentEntryId) return target?.purpose === "end";
    return (indexByEntry.get(id(target.contentEntryId)) ?? -1) > currentEntryIndex;
  });
}

module.exports = {
  id,
  newObjectId,
  plain,
  targetEntries,
  targetEntryIndex,
  anchorMap,
  contentTargetAnchorMap,
  startAnchor,
  assignDeliveryAnchors,
  timingFromPlan,
  entryAnchor,
  routeLegsAfterEntry,
};
