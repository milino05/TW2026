const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { resolveRoute } = require("./graphRouting.service");
const { placesForIntent } = require("./venueRouting.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function resolveMovementSpeed(preference = 0.5) {
  const p = Math.max(0, Math.min(1, Number(preference ?? 0.5)));
  const calm = policy.coldStart.paceFactors.calm, fast = policy.coldStart.paceFactors.fast;
  return Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, policy.coldStart.movementSpeedMps * (calm + (fast - calm) * p)));
}
function translateRequirements(layoutRevision, requirements = []) {
  const attrs = layoutRevision.routingAttributes || [];
  const byLocal = new Map(attrs.map((entry) => [entry.key, entry]));
  const byCanonical = new Map(attrs.filter((entry) => entry.canonicalKey).map((entry) => [entry.canonicalKey, entry]));
  const translated = [], warnings = [], unsupportedRequired = [];
  for (const requirement of requirements || []) {
    const definition = byLocal.get(requirement.attributeKey) || byCanonical.get(requirement.attributeKey);
    if (!definition) {
      if ((requirement.priority || "preferred") === "required") unsupportedRequired.push(requirement.attributeKey);
      else warnings.push({ code: "PREFERRED_ATTRIBUTE_UNSUPPORTED", attributeKey: requirement.attributeKey });
    } else translated.push({ ...requirement, attributeKey: definition.key });
  }
  return { requirements: translated, warnings, unsupportedRequired };
}

async function resolveSessionVenuePins(sourceAnchors = []) {
  const targetIds = uniqueIds(sourceAnchors.map((entry) => entry.venueTargetId));
  if (!targetIds.length) return { venuePins: [], targetById: new Map(), bundleByVenueId: new Map() };
  const targets = await VenueTarget.find({ _id: { $in: targetIds } }).lean();
  if (targets.length !== targetIds.length) throw new AppError("Uno o piu VenueTarget della sorgente non esistono", 409, [{ code: "VENUE_TARGET_MISSING_AT_SESSION_START" }]);
  const targetById = new Map(targets.map((entry) => [id(entry._id), entry]));
  const venueIds = uniqueIds(targets.map((entry) => entry.venueId));
  const venues = await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).lean();
  if (venues.length !== venueIds.length) throw new AppError("Una Venue richiesta dalla visita non e disponibile", 409);
  const venueById = new Map(venues.map((entry) => [id(entry._id), entry]));
  const venuePins = [], bundleByVenueId = new Map();
  for (const venueId of venueIds) {
    const venue = venueById.get(venueId);
    if (!venue?.publishedReleaseId) throw new AppError("Venue senza VenueRelease pubblicata", 409, [{ code: "VENUE_WITHOUT_PUBLISHED_RELEASE", context: { venueId } }]);
    const release = await VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: venue._id, status: "published" }).lean();
    if (!release || release.integrity?.status !== "valid") throw new AppError("VenueRelease corrente non utilizzabile", 409, [{ code: "VENUE_RELEASE_INVALID", context: { venueId } }]);
    const layout = await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: venue._id, status: { $in: ["published", "superseded"] } }).lean();
    if (!layout) throw new AppError("LayoutRevision della VenueRelease non disponibile", 409);
    const activeTargets = new Set((release.targetBindings || []).filter((entry) => entry.availability === "active").map((entry) => id(entry.venueTargetId)));
    const placementByTarget = new Map((layout.venueTargetPlacements || []).map((entry) => [id(entry.venueTargetId), entry]));
    for (const target of targets.filter((entry) => id(entry.venueId) === venueId)) {
      if (target.lifecycleStatus !== "active" || !activeTargets.has(id(target._id))) throw new AppError("VenueTarget non disponibile nella VenueRelease corrente", 409, [{ code: "VENUE_TARGET_UNAVAILABLE_AT_SESSION_START", context: { venueId, venueTargetId: target._id } }]);
      if (!placementByTarget.get(id(target._id))?.primaryPlaceId) throw new AppError("VenueTarget senza placement nella LayoutRevision corrente", 409, [{ code: "VENUE_TARGET_WITHOUT_PLACEMENT", context: { venueId, venueTargetId: target._id } }]);
    }
    const pin = { venueId: venue._id, venueReleaseId: release._id, layoutRevisionId: layout._id };
    venuePins.push(pin);
    bundleByVenueId.set(venueId, { venue, release, layout, placementByTarget });
  }
  return { venuePins, targetById, bundleByVenueId };
}

async function materializeSessionPhysicalPlan({ sourceAnchors = [], sourceLegHints = new Map(), navigation = {} }) {
  const resolved = await resolveSessionVenuePins(sourceAnchors);
  const profiles = sourceAnchors.length ? await VenueTargetObservationProfile.find({ venueTargetId: { $in: sourceAnchors.map((entry) => entry.venueTargetId) } }).lean() : [];
  const profileByTarget = new Map(profiles.map((entry) => [id(entry.venueTargetId), entry]));
  const warnings = [], requirementsByVenue = new Map();
  for (const [venueId, bundle] of resolved.bundleByVenueId) {
    const translated = translateRequirements(bundle.layout, navigation.requirements || []);
    if (translated.unsupportedRequired.length) throw new AppError("Una Venue non supporta un requisito di routing necessario", 409, translated.unsupportedRequired.map((attributeKey) => ({ field: "navigation.requirements", code: "REQUIRED_ATTRIBUTE_UNSUPPORTED", message: attributeKey, context: { venueId } })));
    warnings.push(...translated.warnings.map((entry) => ({ ...entry, venueId: bundle.venue._id })));
    requirementsByVenue.set(venueId, translated.requirements);
  }
  const visitAnchors = sourceAnchors.map((source) => {
    const target = resolved.targetById.get(id(source.venueTargetId));
    const bundle = resolved.bundleByVenueId.get(id(target.venueId));
    const placement = bundle.placementByTarget.get(id(target._id));
    const profile = profileByTarget.get(id(target._id));
    const learned = Number(profile?.typicalObservationSeconds);
    const observationSeconds = Number(profile?.confidence) >= policy.confidence.usableThreshold && Number.isFinite(learned) ? learned : policy.coldStart.observationSeconds;
    return {
      _id: source._id,
      sourceAnchorId: source._id,
      venueTargetId: target._id,
      venueId: target.venueId,
      placeId: placement.primaryPlaceId,
      estimatedObservationSeconds: Math.round(Math.max(0, observationSeconds)),
    };
  });
  const speedMps = resolveMovementSpeed(navigation.movementPacePreference);
  const legs = [];
  for (let index = 1; index < visitAnchors.length; index += 1) {
    const from = visitAnchors[index - 1], to = visitAnchors[index];
    const hint = sourceLegHints.get(`${id(from.sourceAnchorId)}>${id(to.sourceAnchorId)}`) || null;
    if (id(from.venueId) !== id(to.venueId)) {
      const estimatedSeconds = Number(hint?.estimatedSeconds ?? hint?.estimatedTransferSeconds);
      if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) throw new AppError("Trasferimento inter-Venue senza stima esplicita", 409, [{ code: "INTER_VENUE_TRANSFER_ESTIMATE_REQUIRED", context: { fromVenueId: from.venueId, toVenueId: to.venueId } }]);
      legs.push({ type: "inter_venue", fromAnchorId: from._id, toAnchorId: to._id, venueReleaseId: null, layoutRevisionId: null, path: [], estimatedSeconds: Math.round(estimatedSeconds), preferencePenalty: 0, instruction: hint?.instruction || hint?.instructionOverride || null });
      continue;
    }
    const bundle = resolved.bundleByVenueId.get(id(from.venueId));
    const route = resolveRoute({ connections: bundle.layout.connections || [], fromPlaceId: from.placeId, toPlaceId: to.placeId, requirements: requirementsByVenue.get(id(from.venueId)) || [], speedMps, learnedResidualByConnection: {} });
    if (!route.reachable) throw new AppError("Nessun percorso compatibile tra due VisitAnchor", 409, [{ code: "SESSION_ROUTE_UNREACHABLE", context: { venueId: from.venueId, fromAnchorId: from._id, toAnchorId: to._id } }]);
    legs.push({ type: "indoor", fromAnchorId: from._id, toAnchorId: to._id, venueReleaseId: bundle.release._id, layoutRevisionId: bundle.layout._id, path: (route.path || []).map((entry) => entry.connectionId || entry), estimatedSeconds: Math.round(route.estimatedSeconds), preferencePenalty: route.preferencePenalty || 0, instruction: hint?.instruction || hint?.instructionOverride || null });
  }
  return { ...resolved, visitAnchors, physicalRoute: { legs }, warnings, speedMps };
}

async function loadPinnedBundle(session, venueId) {
  const pin = (session.venuePins || []).find((entry) => id(entry.venueId) === id(venueId));
  if (!pin) throw new AppError("Venue non pinzata nella Session", 409);
  const [release, layout] = await Promise.all([
    VenueRelease.findOne({ _id: pin.venueReleaseId, venueId: pin.venueId }).lean(),
    LayoutRevision.findOne({ _id: pin.layoutRevisionId, venueId: pin.venueId }).lean(),
  ]);
  if (!release || !layout) throw new AppError("Snapshot fisica pinzata dalla Session non disponibile", 409);
  return { pin, release, layout };
}

async function routeToIntentInSession({ session, venueId, fromPlaceId, intent }) {
  const bundle = await loadPinnedBundle(session, venueId);
  const destinations = placesForIntent(bundle.layout, intent);
  if (!destinations.length) throw new AppError("La Venue non dichiara una destinazione per questo intento", 404);
  const translated = translateRequirements(bundle.layout, session.navigationSnapshot?.requirements || []);
  if (translated.unsupportedRequired.length) throw new AppError("Snapshot fisica non supporta un requisito obbligatorio", 409);
  const candidates = destinations.map((destination) => ({ destination, route: resolveRoute({ connections: bundle.layout.connections || [], fromPlaceId, toPlaceId: destination._id, requirements: translated.requirements, speedMps: session.sessionMovementSpeedMps, learnedResidualByConnection: {} }) })).filter((entry) => entry.route.reachable);
  if (!candidates.length) throw new AppError("Nessuna destinazione raggiungibile per questo intento", 409);
  const fastest = Math.min(...candidates.map((entry) => entry.route.estimatedSeconds));
  const acceptable = candidates.filter((entry) => entry.route.estimatedSeconds <= fastest * (1 + policy.routing.maxPreferredDetourRatio));
  acceptable.sort((a, b) => (a.route.preferencePenalty || 0) - (b.route.preferencePenalty || 0) || a.route.estimatedSeconds - b.route.estimatedSeconds);
  const best = acceptable[0];
  return { venueId: bundle.pin.venueId, venueReleaseId: bundle.pin.venueReleaseId, layoutRevisionId: bundle.pin.layoutRevisionId, intent: String(intent || "").trim().toUpperCase(), destination: best.destination, warnings: translated.warnings, ...best.route };
}

module.exports = { id, resolveMovementSpeed, translateRequirements, resolveSessionVenuePins, materializeSessionPhysicalPlan, loadPinnedBundle, routeToIntentInSession };
