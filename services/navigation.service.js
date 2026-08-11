const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const User = require("../models/user");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const AppError = require("../utils/AppError");
const { translateRequirements } = require("./logisticsPlan.service");
const { resolveRoute } = require("./graphRouting.service");
const { getLearnedResidualByConnection } = require("./routingLearning.service");
const { loadPopulationProfiles, resolveEffectiveSpeed } = require("./adaptiveEstimation.service");

async function loadPublishedLayout(museumId) {
  const layout = await MuseumLayout.findOne({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean();
  if (!layout) throw new AppError("Layout pubblicato non disponibile", 404);
  const revision = await MuseumLayoutRevision.findById(layout.publishedRevisionId).lean();
  if (!revision) throw new AppError("Revisione pubblicata del layout non disponibile", 404);
  return revision;
}

async function resolveUserRoutingContext(userId, museumId, layoutRevision, override = {}) {
  const [user, profile, population, learnedResidualByConnection] = await Promise.all([
    User.findById(userId).lean(),
    UserAdaptiveProfile.findOne({ userId }).lean(),
    loadPopulationProfiles(museumId),
    getLearnedResidualByConnection(layoutRevision),
  ]);
  const baseNavigation = user?.defaultNavigationPreference || {};
  const pace = Number.isFinite(Number(override.movementPacePreference)) ? Number(override.movementPacePreference) : (baseNavigation.movementPacePreference ?? 0.5);
  const requested = Array.isArray(override.requirements) ? override.requirements : (baseNavigation.requirements || []);
  const translated = translateRequirements(layoutRevision, requested);
  if (translated.unsupportedRequired.length) {
    throw new AppError("Il layout non puo garantire tutti i requisiti obbligatori", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "requirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: `Attributo richiesto non supportato: ${attributeKey}` })));
  }
  const movement = resolveEffectiveSpeed({ preference: pace, userProfile: profile, globalProfile: population.globalProfile, museumProfile: population.museumProfile });
  return { requirements: translated.requirements, warnings: translated.warnings, ...movement, learnedResidualByConnection };
}

async function routeBetweenPlaces({ museumId, userId, fromPlaceId, toPlaceId, navigation = {} }) {
  const layoutRevision = await loadPublishedLayout(museumId);
  const context = await resolveUserRoutingContext(userId, museumId, layoutRevision, navigation);
  const result = resolveRoute({ connections: layoutRevision.connections, fromPlaceId, toPlaceId, requirements: context.requirements, speedMps: context.speedMps, learnedResidualByConnection: context.learnedResidualByConnection });
  if (!result.reachable) throw new AppError("Nessun percorso compatibile con i requisiti indicati", 409);
  return { layoutRevisionId: layoutRevision._id, warnings: context.warnings, movement: { baselineSpeedMps: context.baselineSpeedMps, paceFactor: context.paceFactor, effectiveSpeedMps: context.speedMps }, ...result };
}

async function routeToIntent({ museumId, userId, fromPlaceId, intent, navigation = {} }) {
  const layoutRevision = await loadPublishedLayout(museumId);
  const normalizedIntent = typeof intent === "string" ? intent.trim().toUpperCase() : "";
  if (!normalizedIntent) throw new AppError("intent e obbligatorio", 400);
  const placeTypes = new Set((layoutRevision.placeTypes || []).filter((type) => (type.userIntents || []).includes(normalizedIntent)).map((type) => type.key));
  const destinations = (layoutRevision.places || []).filter((place) => placeTypes.has(place.typeKey));
  if (!destinations.length) throw new AppError("Il museo non ha dichiarato una destinazione per questo intento", 404);
  const context = await resolveUserRoutingContext(userId, museumId, layoutRevision, navigation);
  let best = null;
  for (const destination of destinations) {
    const route = resolveRoute({ connections: layoutRevision.connections, fromPlaceId, toPlaceId: destination._id, requirements: context.requirements, speedMps: context.speedMps, learnedResidualByConnection: context.learnedResidualByConnection });
    if (!route.reachable) continue;
    if (!best || route.estimatedSeconds < best.route.estimatedSeconds) best = { destination, route };
  }
  if (!best) throw new AppError("Nessuna destinazione compatibile con i requisiti indicati", 409);
  return { layoutRevisionId: layoutRevision._id, intent: normalizedIntent, destination: best.destination, warnings: context.warnings, movement: { baselineSpeedMps: context.baselineSpeedMps, paceFactor: context.paceFactor, effectiveSpeedMps: context.speedMps }, ...best.route };
}

module.exports = { loadPublishedLayout, routeBetweenPlaces, routeToIntent };
