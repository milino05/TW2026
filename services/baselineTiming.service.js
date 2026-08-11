const Item = require("../models/item.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const policy = require("../config/adaptivePolicy");
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { resolveRoute, resolvePlannedPath } = require("./graphRouting.service");
const { loadPopulationProfiles, resolveEffectiveSpeed, resolveObservationSeconds } = require("./adaptiveEstimation.service");

function placementMap(revision) { return new Map((revision.itemPlacements || []).map((entry) => [String(entry.itemId), entry])); }
async function publishedLayout(museumId) { const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(); return layout ? MuseumLayoutRevision.findById(layout.publishedRevisionId).lean() : null; }

async function computeBaselineTiming({ visit, revision, estimatedContentSeconds }) {
  const items = await Promise.all((revision.stops || []).map((stop) => Item.findById(stop.itemId).lean()));
  const populationCache = new Map();
  const layoutCache = new Map();
  let observationSeconds = 0;
  let logisticsSeconds = 0;
  async function population(museumId) { const key = String(museumId); if (!populationCache.has(key)) populationCache.set(key, await loadPopulationProfiles(museumId)); return populationCache.get(key); }
  async function layout(museumId) { const key = String(museumId); if (!layoutCache.has(key)) layoutCache.set(key, await publishedLayout(museumId)); return layoutCache.get(key); }

  for (const item of items) {
    if (!item) continue;
    const [itemProfile, profiles] = await Promise.all([ItemObservationProfile.findOne({ itemId: item._id }).lean(), population(item.museumId)]);
    observationSeconds += resolveObservationSeconds({ globalProfile: profiles.globalProfile, museumProfile: profiles.museumProfile, itemProfile });
  }

  for (let index = 0; index < items.length - 1; index += 1) {
    const fromItem = items[index];
    const toItem = items[index + 1];
    if (!fromItem || !toItem) continue;
    const configured = (revision.logistics?.transitions || []).find((entry) => entry.fromStopIndex === index && entry.toStopIndex === index + 1);
    if (String(fromItem.museumId) !== String(toItem.museumId)) { logisticsSeconds += Number(configured?.estimatedTransferSeconds) || 0; continue; }
    const layoutRevision = await layout(fromItem.museumId);
    if (!layoutRevision) continue;
    const placements = placementMap(layoutRevision);
    const fromPlacement = placements.get(String(fromItem._id));
    const toPlacement = placements.get(String(toItem._id));
    if (!fromPlacement || !toPlacement) continue;
    const [learnedResidualByConnection, profiles] = await Promise.all([getLearnedResidualByConnection(layoutRevision), population(fromItem.museumId)]);
    const movement = resolveEffectiveSpeed({ preference: 0.5, globalProfile: profiles.globalProfile, museumProfile: profiles.museumProfile });
    const plannedIds = configured?.plannedPath || [];
    let route = plannedIds.length ? resolvePlannedPath({ connections: layoutRevision.connections, pathConnectionIds: plannedIds, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId, requirements: [], speedMps: movement.speedMps, learnedResidualByConnection }) : { reachable: false };
    if (!route.reachable) route = resolveRoute({ connections: layoutRevision.connections, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId, requirements: [], speedMps: movement.speedMps, learnedResidualByConnection });
    if (route.reachable) logisticsSeconds += route.estimatedSeconds;
  }
  const content = Math.max(0, Number(estimatedContentSeconds) || 0);
  return { estimatedContentSeconds: Math.round(content), estimatedObservationSeconds: Math.round(observationSeconds), estimatedLogisticsSeconds: Math.round(logisticsSeconds), estimatedTotalSeconds: Math.round(content + observationSeconds + logisticsSeconds), adaptivePolicyVersion: policy.version, computedAt: new Date() };
}

module.exports = { computeBaselineTiming };
