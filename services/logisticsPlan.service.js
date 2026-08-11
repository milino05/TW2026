const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const User = require("../models/user");
const UserVisitPreference = require("../models/userVisitPreference.model");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const ItemObservationProfile = require("../models/itemObservationProfile.model");
const VisitTimingProfile = require("../models/visitTimingProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { buildPresentationPlan } = require("./userPreference.service");
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { resolveRoute, resolvePlannedPath } = require("./graphRouting.service");
const { loadPopulationProfiles, resolveEffectiveSpeed, resolveMovementBaseline, resolvePaceFactor, resolveObservationSeconds } = require("./adaptiveEstimation.service");

function mergeNavigationPreference(user, visitPreference, override = {}) {
  const global = user?.defaultNavigationPreference || {};
  const local = visitPreference?.navigation || {};
  return {
    movementPacePreference: Number.isFinite(Number(override.movementPacePreference)) ? Math.max(0, Math.min(1, Number(override.movementPacePreference))) : (Number.isFinite(local.movementPacePreference) ? local.movementPacePreference : (global.movementPacePreference ?? 0.5)),
    requirements: Array.isArray(override.requirements) ? override.requirements : (Array.isArray(local.requirements) && local.requirements.length ? local.requirements : (global.requirements || [])),
  };
}

function translateRequirements(layoutRevision, requirements = []) {
  const attributes = layoutRevision.routingAttributes || [];
  const byLocal = new Map(attributes.map((entry) => [entry.key, entry]));
  const byCanonical = new Map(attributes.filter((entry) => entry.canonicalKey).map((entry) => [entry.canonicalKey, entry]));
  const translated = []; const warnings = []; const unsupportedRequired = [];
  for (const requirement of requirements) {
    const local = byLocal.get(requirement.attributeKey) || byCanonical.get(requirement.attributeKey);
    if (!local) { if (requirement.priority === "required") unsupportedRequired.push(requirement.attributeKey); else warnings.push({ code: "PREFERRED_ATTRIBUTE_UNSUPPORTED", attributeKey: requirement.attributeKey }); continue; }
    translated.push({ ...requirement, attributeKey: local.key });
  }
  return { requirements: translated, warnings, unsupportedRequired };
}

function placementMap(revision) { return new Map((revision.itemPlacements || []).map((entry) => [String(entry.itemId), entry])); }
async function loadLayout(museumId, requestedRevisionId = null) { const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(); if (!layout) return null; if (requestedRevisionId && String(requestedRevisionId) === String(layout.publishedRevisionId)) return MuseumLayoutRevision.findById(requestedRevisionId).lean(); return MuseumLayoutRevision.findById(layout.publishedRevisionId).lean(); }

async function buildLogisticsPlan({ userId, visitId, navigationOverride = {} }) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
  if (!revision) throw new AppError("Revisione pubblicata della visita non trovata", 404);
  const [user, visitPreference, adaptiveProfile, presentationPlan, timingProfile, globalPopulation] = await Promise.all([User.findById(userId).lean(), UserVisitPreference.findOne({ userId, visitId }).lean(), UserAdaptiveProfile.findOne({ userId }).lean(), buildPresentationPlan({ userId, visitId }), VisitTimingProfile.findOne({ visitRevisionId: revision._id }).lean(), loadPopulationProfiles(null)]);
  const navigation = mergeNavigationPreference(user, visitPreference, navigationOverride);
  const movementBaselineMps = resolveMovementBaseline({ userProfile: adaptiveProfile, globalProfile: globalPopulation.globalProfile });
  const paceFactor = resolvePaceFactor({ preference: navigation.movementPacePreference, globalProfile: globalPopulation.globalProfile });
  const effectiveMovementSpeedMps = Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, movementBaselineMps * paceFactor));
  const observationBaselineSeconds = resolveObservationSeconds({ userProfile: adaptiveProfile, globalProfile: globalPopulation.globalProfile });
  const items = await Promise.all(revision.stops.map((stop) => Item.findById(stop.itemId).lean()));
  const transitions = []; const warnings = []; const populationCache = new Map(); let logisticsSeconds = 0; let observationSeconds = 0;
  async function populationForMuseum(museumId) { const key = String(museumId); if (!populationCache.has(key)) populationCache.set(key, await loadPopulationProfiles(museumId)); return populationCache.get(key); }

  for (const item of items) {
    if (!item) continue;
    const [itemProfile, population] = await Promise.all([ItemObservationProfile.findOne({ itemId: item._id }).lean(), populationForMuseum(item.museumId)]);
    observationSeconds += resolveObservationSeconds({ userProfile: adaptiveProfile, globalProfile: population.globalProfile, museumProfile: population.museumProfile, itemProfile });
  }

  for (let index = 0; index < revision.stops.length - 1; index += 1) {
    const fromItem = items[index]; const toItem = items[index + 1];
    if (!fromItem || !toItem) continue;
    const configured = (revision.logistics?.transitions || []).find((entry) => entry.fromStopIndex === index && entry.toStopIndex === index + 1);
    if (String(fromItem.museumId) !== String(toItem.museumId)) { const seconds = Number(configured?.estimatedTransferSeconds) || 0; logisticsSeconds += seconds; transitions.push({ type: "inter_venue", fromStopIndex: index, toStopIndex: index + 1, estimatedSeconds: seconds, instruction: configured?.instructionOverride || null, communityNote: configured?.communityNote || null }); continue; }
    const layoutRevision = await loadLayout(fromItem.museumId, configured?.layoutRevisionId);
    if (!layoutRevision) throw new AppError("Layout pubblicato non disponibile per una transizione indoor", 409);
    const translated = translateRequirements(layoutRevision, navigation.requirements);
    warnings.push(...translated.warnings.map((warning) => ({ ...warning, museumId: fromItem.museumId, transitionIndex: index })));
    if (translated.unsupportedRequired.length) throw new AppError("Il museo non dichiara attributi necessari per garantire il percorso richiesto", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "navigation.requirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: `Attributo richiesto non supportato dal layout: ${attributeKey}` })));
    const placements = placementMap(layoutRevision);
    const fromPlacement = placements.get(String(fromItem._id)); const toPlacement = placements.get(String(toItem._id));
    if (!fromPlacement || !toPlacement) throw new AppError("Una tappa non ha una posizione nel layout pubblicato", 409);
    const [learnedResidualByConnection, population] = await Promise.all([getLearnedResidualByConnection(layoutRevision), populationForMuseum(fromItem.museumId)]);
    const movement = resolveEffectiveSpeed({ preference: navigation.movementPacePreference, userProfile: adaptiveProfile, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
    const plannedIds = configured?.plannedPath || [];
    const planned = plannedIds.length ? resolvePlannedPath({ connections: layoutRevision.connections, pathConnectionIds: plannedIds, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId, requirements: translated.requirements, speedMps: movement.speedMps, learnedResidualByConnection }) : { reachable: false };
    const dynamic = resolveRoute({ connections: layoutRevision.connections, fromPlaceId: fromPlacement.primaryPlaceId, toPlaceId: toPlacement.primaryPlaceId, requirements: translated.requirements, speedMps: movement.speedMps, learnedResidualByConnection });
    let route = planned; let source = "planned";
    if (!planned.reachable) { route = dynamic; source = "dynamic"; }
    else if (dynamic.reachable && dynamic.preferencePenalty < planned.preferencePenalty && dynamic.estimatedSeconds <= planned.estimatedSeconds * (1 + policy.routing.maxPreferredDetourRatio)) { route = dynamic; source = "dynamic_preference"; }
    if (!route.reachable) throw new AppError("Nessun percorso compatibile con le esigenze dell'utente", 409);
    logisticsSeconds += route.estimatedSeconds;
    transitions.push({ type: "indoor", source, fromStopIndex: index, toStopIndex: index + 1, layoutRevisionId: layoutRevision._id, ...route, instructionOverride: configured?.instructionOverride || null, communityNote: configured?.communityNote || null });
  }
  const contentSeconds = presentationPlan.estimatedContentSeconds || 0;
  const rawTotalSeconds = contentSeconds + observationSeconds + logisticsSeconds;
  const learnedVisitResidual = timingProfile && timingProfile.confidence >= policy.confidence.usableThreshold ? timingProfile.typicalResidualSeconds * Math.min(0.8, timingProfile.confidence) : 0;
  return { visitId: visit._id, visitRevisionId: revision._id, adaptivePolicyVersion: policy.version, presentationPlan, navigation, movementBaselineMps, paceFactor, effectiveMovementSpeedMps, observationBaselineSeconds, estimatedContentSeconds: Math.round(contentSeconds), estimatedObservationSeconds: Math.round(observationSeconds), estimatedLogisticsSeconds: Math.round(logisticsSeconds), estimatedVisitResidualSeconds: Math.round(learnedVisitResidual), estimatedTotalSeconds: Math.round(Math.max(0, rawTotalSeconds + learnedVisitResidual)), typicalVisitRange: timingProfile?.confidence >= policy.confidence.usableThreshold ? { lowerSeconds: timingProfile.lowerTypicalSeconds, upperSeconds: timingProfile.upperTypicalSeconds, confidence: timingProfile.confidence } : null, warnings, transitions };
}

module.exports = { mergeNavigationPreference, translateRequirements, buildLogisticsPlan };
