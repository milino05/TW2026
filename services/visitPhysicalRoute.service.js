const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { resolveRoute, resolvePlannedPath } = require("./graphRouting.service");
const { loadPopulationProfiles, resolveEffectiveSpeed, resolveObservationSeconds } = require("./adaptiveEstimation.service");
const { id, newObjectId, assignDeliveryAnchors } = require("./physicalRoute.service");

function translateRequirements(layoutRevision, requirements = []) {
  const attrs = layoutRevision.routingAttributes || [];
  const byLocal = new Map(attrs.map((entry) => [entry.key, entry]));
  const byCanonical = new Map(attrs.filter((entry) => entry.canonicalKey).map((entry) => [entry.canonicalKey, entry]));
  const translated = [], warnings = [], unsupportedRequired = [];
  for (const requirement of requirements) {
    const local = byLocal.get(requirement.attributeKey) || byCanonical.get(requirement.attributeKey);
    if (!local) {
      if (requirement.priority === "required") unsupportedRequired.push(requirement.attributeKey);
      else warnings.push({ code: "PREFERRED_ATTRIBUTE_UNSUPPORTED", attributeKey: requirement.attributeKey });
    } else translated.push({ ...requirement, attributeKey: local.key });
  }
  return { requirements: translated, warnings, unsupportedRequired };
}
function placementMap(revision) { return new Map((revision.itemPlacements || []).map((entry) => [id(entry.itemId), entry])); }
async function loadLayout(museumId, requestedRevisionId = null) {
  const stable = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!stable) return null;
  const revisionId = requestedRevisionId && id(requestedRevisionId) === id(stable.publishedRevisionId) ? requestedRevisionId : stable.publishedRevisionId;
  return MuseumLayoutRevision.findById(revisionId).lean();
}
function chooseEntrance(layoutRevision, requestedPlaceId = null) {
  if (requestedPlaceId && (layoutRevision.places || []).some((place) => id(place._id) === id(requestedPlaceId))) return requestedPlaceId;
  const types = new Set((layoutRevision.placeTypes || []).filter((type) => (type.userIntents || []).includes("FIND_ENTRANCE")).map((type) => type.key));
  return (layoutRevision.places || []).find((place) => types.has(place.typeKey))?._id || null;
}
function routeHintMap(sourceRevision) {
  return new Map((sourceRevision?.logistics?.routeHints || []).map((hint) => [`${id(hint.fromTargetEntryId)}>${id(hint.toTargetEntryId)}`, hint]));
}

async function materializePhysicalRoute({ contentEntries, sourceRevision = null, adaptiveProfile = null, navigation = {}, defaultMovementSpeedMps = 1 }) {
  const targets = contentEntries.filter((entry) => entry.spatialMode === "target");
  const hints = routeHintMap(sourceRevision);
  const anchors = [], legs = [], warnings = [], layouts = new Map(), populations = new Map();
  async function layoutFor(museumId, requested = null) {
    const key = `${id(museumId)}:${id(requested)}`;
    if (!layouts.has(key)) layouts.set(key, await loadLayout(museumId, requested));
    return layouts.get(key);
  }
  async function populationFor(museumId) {
    const key = id(museumId);
    if (!populations.has(key)) populations.set(key, await loadPopulationProfiles(museumId));
    return populations.get(key);
  }

  let previousAnchor = null, previousTarget = null;
  if (targets.length) {
    const first = targets[0], layout = await layoutFor(first.museumId);
    if (!layout) throw new AppError("Il primo target non ha un layout pubblicato", 409);
    const firstPlacement = placementMap(layout).get(id(first.itemId));
    if (!firstPlacement?.primaryPlaceId) throw new AppError("Il primo target non ha un placement", 409);
    previousAnchor = { _id: newObjectId(), kind: "place", purpose: "start", contentEntryId: null, itemId: null, museumId: first.museumId, placeId: chooseEntrance(layout, navigation.startPlaceId) || firstPlacement.primaryPlaceId, estimatedObservationSeconds: 0 };
    anchors.push(previousAnchor);
  } else if (contentEntries.length) {
    const layout = await layoutFor(contentEntries[0].museumId);
    const placeId = layout ? chooseEntrance(layout, navigation.startPlaceId) : null;
    if (placeId) {
      previousAnchor = { _id: newObjectId(), kind: "place", purpose: "start", contentEntryId: null, itemId: null, museumId: contentEntries[0].museumId, placeId, estimatedObservationSeconds: 0 };
      anchors.push(previousAnchor);
    }
  }

  for (const entry of targets) {
    const hint = previousTarget ? hints.get(`${id(previousTarget.sourceContentEntryId)}>${id(entry.sourceContentEntryId)}`) : null;
    const layout = await layoutFor(entry.museumId, hint?.layoutRevisionId);
    if (!layout) throw new AppError("Un target non ha un layout pubblicato", 409);
    const placement = placementMap(layout).get(id(entry.itemId));
    if (!placement?.primaryPlaceId) throw new AppError("Un target non ha un placement nel layout pubblicato", 409);
    const [itemProfile, population] = await Promise.all([ItemObservationProfile.findOne({ itemId: entry.itemId }).lean(), populationFor(entry.museumId)]);
    const observation = resolveObservationSeconds({ userProfile: adaptiveProfile, globalProfile: population.globalProfile, museumProfile: population.museumProfile, itemProfile });
    const anchor = { _id: newObjectId(), kind: "content_target", purpose: "content", contentEntryId: entry._id, itemId: entry.itemId, museumId: entry.museumId, placeId: placement.primaryPlaceId, estimatedObservationSeconds: Math.round(observation) };
    if (previousAnchor) {
      if (id(previousAnchor.museumId) !== id(anchor.museumId)) {
        if (!hint) warnings.push({ code: "INTER_VENUE_ROUTE_HINT_MISSING", fromContentEntryId: previousTarget?._id || null, toContentEntryId: entry._id });
        legs.push({ _id: newObjectId(), type: "inter_venue", fromAnchorId: previousAnchor._id, toAnchorId: anchor._id, layoutRevisionId: null, path: [], estimatedSeconds: Number(hint?.estimatedTransferSeconds) || 0, preferencePenalty: 0, instruction: hint?.instructionOverride || null, communityNote: hint?.communityNote || null });
      } else {
        const translated = translateRequirements(layout, navigation.requirements || []);
        warnings.push(...translated.warnings.map((warning) => ({ ...warning, museumId: entry.museumId })));
        if (translated.unsupportedRequired.length) throw new AppError("Il museo non supporta un requisito di routing necessario", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "navigation.requirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: attributeKey })));
        const learned = await getLearnedResidualByConnection(layout);
        const movement = resolveEffectiveSpeed({ preference: navigation.movementPacePreference ?? 0.5, userProfile: adaptiveProfile, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
        const speedMps = movement?.speedMps || defaultMovementSpeedMps;
        const plannedIds = hint?.plannedPath || [];
        const planned = plannedIds.length ? resolvePlannedPath({ connections: layout.connections, pathConnectionIds: plannedIds, fromPlaceId: previousAnchor.placeId, toPlaceId: anchor.placeId, requirements: translated.requirements, speedMps, learnedResidualByConnection: learned }) : { reachable: false };
        const dynamic = resolveRoute({ connections: layout.connections, fromPlaceId: previousAnchor.placeId, toPlaceId: anchor.placeId, requirements: translated.requirements, speedMps, learnedResidualByConnection: learned });
        let route = planned, source = "planned";
        if (!planned.reachable) { route = dynamic; source = "dynamic"; }
        else if (dynamic.reachable && dynamic.preferencePenalty < planned.preferencePenalty && dynamic.estimatedSeconds <= planned.estimatedSeconds * (1 + policy.routing.maxPreferredDetourRatio)) { route = dynamic; source = "dynamic_preference"; }
        if (!route.reachable) throw new AppError("Nessun percorso compatibile tra due target", 409);
        legs.push({ _id: newObjectId(), type: "indoor", source, fromAnchorId: previousAnchor._id, toAnchorId: anchor._id, layoutRevisionId: layout._id, path: (route.path || []).map((value) => value.connectionId || value), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0, instruction: hint?.instructionOverride || null, communityNote: hint?.communityNote || null });
      }
    }
    anchors.push(anchor);
    previousAnchor = anchor;
    previousTarget = entry;
  }
  const physicalRoute = { anchors, legs };
  return { contentEntries: assignDeliveryAnchors(contentEntries, physicalRoute), physicalRoute, warnings, sourceLayoutRevisionIds: [...new Set(anchors.map((anchor) => legs.find((leg) => id(leg.toAnchorId) === id(anchor._id))?.layoutRevisionId).filter(Boolean).map(id))] };
}

module.exports = { translateRequirements, placementMap, loadLayout, chooseEntrance, materializePhysicalRoute };
