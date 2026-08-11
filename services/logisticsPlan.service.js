const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const User = require("../models/user");
const UserVisitPreference = require("../models/userVisitPreference.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const ConnectionLearnedProfile = require("../models/connectionLearnedProfile.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const AppError = require("../utils/AppError");
const { buildPresentationPlan } = require("./userPreference.service");
const { resolveRoute, routeCompatible, pacePreferenceToSpeed, estimateConnectionSeconds } = require("./graphRouting.service");

function mergeNavigationPreference(user, visitPreference) {
  const global = user?.defaultNavigationPreference || {};
  const local = visitPreference?.navigation || {};
  return {
    movementPacePreference: Number.isFinite(local.movementPacePreference) ? local.movementPacePreference : (global.movementPacePreference ?? 0.5),
    requirements: Array.isArray(local.requirements) && local.requirements.length ? local.requirements : (global.requirements || []),
  };
}

function translateRequirements(layoutRevision, requirements = []) {
  const attributes = layoutRevision.routingAttributes || [];
  const byLocal = new Map(attributes.map((entry) => [entry.key, entry]));
  const byCanonical = new Map(attributes.filter((entry) => entry.canonicalKey).map((entry) => [entry.canonicalKey, entry]));
  const translated = [];
  const warnings = [];
  const unsupportedRequired = [];
  for (const requirement of requirements) {
    const local = byLocal.get(requirement.attributeKey) || byCanonical.get(requirement.attributeKey);
    if (!local) {
      if (requirement.priority === "required") unsupportedRequired.push(requirement.attributeKey);
      else warnings.push({ code: "PREFERRED_ATTRIBUTE_UNSUPPORTED", attributeKey: requirement.attributeKey });
      continue;
    }
    translated.push({ ...requirement, attributeKey: local.key });
  }
  return { requirements: translated, warnings, unsupportedRequired };
}

function placementMap(revision) {
  return new Map((revision.itemPlacements || []).map((entry) => [String(entry.itemId), entry]));
}

async function loadLayout(museumId, requestedRevisionId = null) {
  if (requestedRevisionId) {
    const revision = await MuseumLayoutRevision.findById(requestedRevisionId).lean();
    if (revision) return revision;
  }
  const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!layout) return null;
  return MuseumLayoutRevision.findById(layout.publishedRevisionId).lean();
}

async function buildLogisticsPlan({ userId, visitId }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
  const [user, visitPreference, adaptiveProfile, presentationPlan] = await Promise.all([
    User.findById(userId).lean(),
    UserVisitPreference.findOne({ userId, visitId }).lean(),
    UserAdaptiveProfile.findOne({ userId }).lean(),
    buildPresentationPlan({ userId, visitId }),
  ]);
  const navigation = mergeNavigationPreference(user, visitPreference);
  const declaredSpeed = pacePreferenceToSpeed(navigation.movementPacePreference);
  const learnedSpeed = adaptiveProfile?.movement?.estimatedSpeedMps;
  const historicalWeight = Math.min(0.5, Number(learnedSpeed?.confidence) || 0);
  const effectiveSpeed = Number.isFinite(learnedSpeed?.value)
    ? declaredSpeed * (1 - historicalWeight) + learnedSpeed.value * historicalWeight
    : declaredSpeed;
  const correctionFactor = adaptiveProfile?.movement?.timeCorrectionFactor?.value || 1;
  const userObservation = adaptiveProfile?.observation?.typicalPostContentObservationSeconds;
  const items = await Promise.all(revision.stops.map((stop) => Item.findById(stop.itemId).lean()));
  const transitions = [];
  const warnings = [];
  let logisticsSeconds = 0;
  let observationSeconds = 0;

  for (const item of items) {
    const learned = item ? await ItemObservationProfile.findOne({ itemId: item._id }).lean() : null;
    const userBase = Number.isFinite(userObservation?.value) ? userObservation.value : 45;
    const itemFactor = learned && learned.confidence >= 0.2 ? learned.observationFactor : 1;
    observationSeconds += Math.max(0, userBase * itemFactor);
  }

  for (let index = 0; index < revision.stops.length - 1; index += 1) {
    const fromItem = items[index];
    const toItem = items[index + 1];
    if (!fromItem || !toItem) continue;
    const configured = (revision.logistics?.transitions || []).find((entry) => entry.fromStopIndex === index && entry.toStopIndex === index + 1);
    if (String(fromItem.museumId) !== String(toItem.museumId)) {
      const seconds = Number(configured?.estimatedTransferSeconds) || 0;
      logisticsSeconds += seconds;
      transitions.push({ type: "inter_venue", fromStopIndex: index, toStopIndex: index + 1, estimatedSeconds: seconds, instruction: configured?.instructionOverride || null, communityNote: configured?.communityNote || null });
      continue;
    }

    const layoutRevision = await loadLayout(fromItem.museumId, configured?.layoutRevisionId);
    if (!layoutRevision) throw new AppError("Layout pubblicato non disponibile per una transizione indoor", 409);
    const translated = translateRequirements(layoutRevision, navigation.requirements);
    warnings.push(...translated.warnings.map((warning) => ({ ...warning, museumId: fromItem.museumId, transitionIndex: index })));
    if (translated.unsupportedRequired.length) {
      throw new AppError("Il museo non dichiara attributi necessari per garantire il percorso richiesto", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "navigation.requirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: `Attributo richiesto non supportato dal layout: ${attributeKey}` })));
    }

    const placements = placementMap(layoutRevision);
    const fromPlacement = placements.get(String(fromItem._id));
    const toPlacement = placements.get(String(toItem._id));
    if (!fromPlacement || !toPlacement) throw new AppError("Una tappa non ha una posizione nel layout pubblicato", 409);
    const learnedProfiles = await ConnectionLearnedProfile.find({ layoutRevisionId: layoutRevision._id }).lean();
    const learnedResidualByConnection = Object.fromEntries(learnedProfiles.map((entry) => [String(entry.connectionId), entry.confidence >= 0.2 ? entry.typicalResidualSeconds : 0]));
    const plannedIds = configured?.plannedPath || [];
    let route;
    let source = "dynamic";
    if (plannedIds.length && routeCompatible({ connections: layoutRevision.connections, pathConnectionIds: plannedIds, requirements: translated.requirements })) {
      const byId = new Map(layoutRevision.connections.map((connection) => [String(connection._id), connection]));
      const path = plannedIds.map((id) => byId.get(String(id))).filter(Boolean);
      const estimatedSeconds = path.reduce((sum, connection) => sum + estimateConnectionSeconds(connection, { speedMps: effectiveSpeed, learnedResidualSeconds: learnedResidualByConnection[String(connection._id)] || 0, userCorrectionFactor: correctionFactor }), 0);
      route = { reachable: path.length === plannedIds.length, path: path.map((connection) => ({ connectionId: connection._id, distanceMeters: connection.distanceMeters })), estimatedSeconds, distanceMeters: path.reduce((sum, connection) => sum + connection.distanceMeters, 0) };
      source = "planned";
    } else {
      route = resolveRoute({ connections: layoutRevision.connections, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId, requirements: translated.requirements, speedMps: effectiveSpeed, learnedResidualByConnection, userCorrectionFactor: correctionFactor });
    }
    if (!route.reachable) throw new AppError("Nessun percorso compatibile con le esigenze dell'utente", 409);
    logisticsSeconds += route.estimatedSeconds;
    transitions.push({ type: "indoor", source, fromStopIndex: index, toStopIndex: index + 1, layoutRevisionId: layoutRevision._id, ...route, instructionOverride: configured?.instructionOverride || null, communityNote: configured?.communityNote || null });
  }

  const contentSeconds = presentationPlan.estimatedContentSeconds || 0;
  return {
    visitId: visit._id,
    visitRevisionId: revision._id,
    presentationPlan,
    navigation,
    effectiveMovementSpeedMps: effectiveSpeed,
    estimatedContentSeconds: contentSeconds,
    estimatedObservationSeconds: Math.round(observationSeconds),
    estimatedLogisticsSeconds: Math.round(logisticsSeconds),
    estimatedTotalSeconds: Math.round(contentSeconds + observationSeconds + logisticsSeconds),
    warnings,
    transitions,
  };
}

module.exports = { mergeNavigationPreference, translateRequirements, buildLogisticsPlan };
