const Item = require("../models/item.model");
const policy = require("../config/adaptivePolicy");
const { materializePhysicalRoute } = require("./visitPhysicalRoute.service");
const { timingFromPlan } = require("./physicalRoute.service");

async function computeBaselineTiming({ visit, revision, estimatedContentSeconds }) {
  const sourceEntries = Array.isArray(revision.contentEntries) ? revision.contentEntries : [];
  const items = await Item.find({ _id: { $in: sourceEntries.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).lean();
  const byId = new Map(items.map((item) => [String(item._id), item]));
  const materialized = sourceEntries.map((entry) => {
    const item = byId.get(String(entry.itemId));
    return {
      _id: entry._id,
      sourceContentEntryId: entry._id,
      itemId: entry.itemId,
      museumId: item?.museumId,
      spatialMode: entry.spatialMode,
      estimatedContentSeconds: 0,
    };
  }).filter((entry) => entry.museumId);
  const routeResult = await materializePhysicalRoute({
    contentEntries: materialized,
    sourceRevision: revision,
    adaptiveProfile: null,
    navigation: { movementPacePreference: 0.5, requirements: [], startPlaceId: null },
    defaultMovementSpeedMps: policy.coldStart.movementSpeedMps,
  });
  const routeTiming = timingFromPlan(routeResult.contentEntries, routeResult.physicalRoute);
  const content = Math.max(0, Number(estimatedContentSeconds) || 0);
  return {
    estimatedContentSeconds: Math.round(content),
    estimatedObservationSeconds: routeTiming.observationSeconds,
    estimatedLogisticsSeconds: routeTiming.logisticsSeconds,
    estimatedTotalSeconds: Math.round(content + routeTiming.observationSeconds + routeTiming.logisticsSeconds),
    adaptivePolicyVersion: policy.version,
    computedAt: new Date(),
  };
}
module.exports = { computeBaselineTiming };
