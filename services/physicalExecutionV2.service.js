const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { resolveRoute } = require("./graphRouting.service");
const { placesForPhysicalFeature } = require("./venueRouting.service");
const { loadLayoutPhysicalVocabulary } = require("./layoutPhysicalVocabulary.service");
const { translateRoutingRequirements } = require("./physicalVocabularyResolver.service");
const { selectionMap, resolveVenueRoutingRequirements } = require("./routingProfileSelectionV2.service");
const { resolveVenueTargetExhibit, resolveApproachInstruction } = require("./venueExhibitResolution.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function resolveMovementSpeed(preference = 0.5) {
  const p = Math.max(0, Math.min(1, Number(preference ?? 0.5)));
  const calm = policy.coldStart.paceFactors.calm, fast = policy.coldStart.paceFactors.fast;
  return Math.max(policy.movement.minSpeedMps, Math.min(policy.movement.maxSpeedMps, policy.coldStart.movementSpeedMps * (calm + (fast - calm) * p)));
}
function translateRequirements(vocabularyRevision, physicalVocabulary, requirements = [], options = {}) {
  return translateRoutingRequirements({ requirements, physicalVocabulary, revision: vocabularyRevision, ...options });
}
function routingBlockerDetails(blockers = [], { venueId = null, field = "navigation.requirements" } = {}) {
  return blockers.map((blocker) => ({
    field,
    code: blocker.code || "PHYSICAL_REQUIREMENT_UNRESOLVED",
    message: blocker.message || "Requisito fisico non risolvibile.",
    context: {
      ...(venueId ? { venueId } : {}),
      priority: blocker.priority || "required",
      reason: blocker.reason || null,
      physicalFeatureRef: blocker.physicalFeatureRef || null,
      ...(blocker.actualFamily ? { actualFamily: blocker.actualFamily } : {}),
      ...(blocker.physicalAttributeDefinitionId ? { physicalAttributeDefinitionId: blocker.physicalAttributeDefinitionId } : {}),
    },
  }));
}
function globalSemanticRequirements(requirements = []) {
  return (requirements || []).filter((requirement) => requirement?.physicalFeatureRef?.kind === "semantic");
}
function assertRequirementScope({ requirements = [], venueCount }) {
  if (venueCount <= 1) return;
  const local = (requirements || []).filter((requirement) => requirement?.physicalFeatureRef?.kind === "local" || requirement?.physicalAttributeDefinitionId);
  if (!local.length) return;
  throw new AppError("Un requisito locale deve essere limitato a una singola Venue", 409, local.map((requirement) => ({
    field: "navigation.requirements",
    code: "LOCAL_PHYSICAL_FEATURE_REQUIRES_VENUE_SCOPE",
    message: "Un PhysicalFeatureRef locale non può essere applicato come preferenza globale a più sedi.",
    context: { physicalFeatureRef: requirement.physicalFeatureRef || null },
  })));
}
function interVenueRequirementOutcome({ requirements = [], fromVenueId, toVenueId }) {
  const relevant = globalSemanticRequirements(requirements);
  const required = relevant.filter((requirement) => (requirement.priority || "preferred") === "required");
  const soft = relevant.filter((requirement) => (requirement.priority || "preferred") !== "required");
  const contextFor = (requirement) => ({ fromVenueId, toVenueId, priority: requirement.priority || "preferred", physicalFeatureRef: requirement.physicalFeatureRef });
  const blockers = required.map((requirement) => ({
    field: "navigation.requirements",
    code: "INTER_VENUE_PHYSICAL_REQUIREMENT_UNVERIFIABLE",
    message: "Il trasferimento tra sedi non dispone ancora di un provider capace di verificare questo requisito fisico obbligatorio.",
    context: contextFor(requirement),
  }));
  const warnings = soft.map((requirement) => ({
    code: "INTER_VENUE_PHYSICAL_REQUIREMENT_UNVERIFIABLE",
    message: (requirement.priority || "preferred") === "avoid"
      ? "Una caratteristica che vuoi evitare non può essere verificata durante il trasferimento tra sedi."
      : "Una preferenza di percorso non può essere verificata durante il trasferimento tra sedi.",
    priority: requirement.priority || "preferred",
    physicalFeatureRef: requirement.physicalFeatureRef,
    fromVenueId,
    toVenueId,
  }));
  return { blockers, warnings };
}
function assertProfileSelectionScope(profileSelections, bundleByVenueId) {
  const unknown = [...profileSelections.keys()].filter((venueId) => !bundleByVenueId.has(venueId));
  if (!unknown.length) return;
  throw new AppError("Un profilo di percorso appartiene a una Venue fuori dallo scope fisico", 409, unknown.map((venueId) => ({
    field: "routingProfileSelections",
    code: "ROUTING_PROFILE_OUTSIDE_PHYSICAL_SCOPE",
    context: { venueId },
  })));
}
function resolveNavigationRequirementsForVenue({ bundle, globalRequirements = [], routingProfileSelection = null }) {
  return resolveVenueRoutingRequirements({
    globalRequirements,
    routingProfileSelection,
    physicalVocabulary: bundle.physicalVocabulary,
    revision: bundle.physicalVocabularyRevision,
  });
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
    const { physicalVocabulary, revision: physicalVocabularyRevision } = await loadLayoutPhysicalVocabulary(layout, { requireStable: true });
    const resolutionByTarget = new Map();
    for (const target of targets.filter((entry) => id(entry.venueId) === venueId)) {
      if (target.lifecycleStatus !== "active") throw new AppError("VenueTarget non disponibile nella VenueRelease corrente", 409, [{ code: "VENUE_TARGET_UNAVAILABLE_AT_SESSION_START", context: { venueId, venueTargetId: target._id } }]);
      resolutionByTarget.set(id(target._id), resolveVenueTargetExhibit({ venueRelease: release, layoutRevision: layout, venueTargetId: target._id }));
    }
    const pin = { venueId: venue._id, venueReleaseId: release._id, layoutRevisionId: layout._id };
    venuePins.push(pin);
    bundleByVenueId.set(venueId, { venue, release, layout, physicalVocabulary, physicalVocabularyRevision, resolutionByTarget });
  }
  return { venuePins, targetById, bundleByVenueId };
}

async function materializeSessionPhysicalPlan({ sourceAnchors = [], sourceLegHints = new Map(), navigation = {} }) {
  const resolved = await resolveSessionVenuePins(sourceAnchors);
  assertRequirementScope({ requirements: navigation.requirements || [], venueCount: resolved.bundleByVenueId.size });
  const profileSelections = selectionMap(navigation.routingProfileSelections || []);
  assertProfileSelectionScope(profileSelections, resolved.bundleByVenueId);
  const profiles = sourceAnchors.length ? await VenueTargetObservationProfile.find({ venueTargetId: { $in: sourceAnchors.map((entry) => entry.venueTargetId) } }).lean() : [];
  const profileByTarget = new Map(profiles.map((entry) => [id(entry.venueTargetId), entry]));
  const warnings = [], requirementsByVenue = new Map();
  for (const [venueId, bundle] of resolved.bundleByVenueId) {
    const translated = resolveNavigationRequirementsForVenue({
      bundle,
      globalRequirements: navigation.requirements || [],
      routingProfileSelection: profileSelections.get(venueId) || null,
    });
    if (translated.blockers.length) throw new AppError("Una Venue non supporta la configurazione di routing richiesta", 409, routingBlockerDetails(translated.blockers, { venueId }));
    warnings.push(...translated.warnings.map((entry) => ({ ...entry, venueId: bundle.venue._id })));
    requirementsByVenue.set(venueId, translated.requirements);
  }
  const visitAnchors = sourceAnchors.map((source) => {
    const target = resolved.targetById.get(id(source.venueTargetId));
    const bundle = resolved.bundleByVenueId.get(id(target.venueId));
    const physical = bundle.resolutionByTarget.get(id(target._id));
    const profile = profileByTarget.get(id(target._id));
    const learned = Number(profile?.typicalObservationSeconds);
    const observationSeconds = Number(profile?.confidence) >= policy.confidence.usableThreshold && Number.isFinite(learned) ? learned : policy.coldStart.observationSeconds;
    return {
      _id: source._id,
      sourceAnchorId: source._id,
      venueTargetId: target._id,
      exhibitSlotId: physical.exhibitSlot.exhibitSlotId,
      venueId: target.venueId,
      placeId: physical.place._id,
      estimatedObservationSeconds: Math.round(Math.max(0, observationSeconds)),
      approachInstruction: null,
    };
  });
  if (visitAnchors[0]) {
    const firstBundle = resolved.bundleByVenueId.get(id(visitAnchors[0].venueId));
    visitAnchors[0].approachInstruction = resolveApproachInstruction({ layoutRevision: firstBundle.layout, destinationExhibitSlotId: visitAnchors[0].exhibitSlotId });
  }
  const speedMps = resolveMovementSpeed(navigation.movementPacePreference);
  const legs = [];
  for (let index = 1; index < visitAnchors.length; index += 1) {
    const from = visitAnchors[index - 1], to = visitAnchors[index];
    const hint = sourceLegHints.get(`${id(from.sourceAnchorId)}>${id(to.sourceAnchorId)}`) || null;
    if (id(from.venueId) !== id(to.venueId)) {
      const verification = interVenueRequirementOutcome({ requirements: navigation.requirements || [], fromVenueId: from.venueId, toVenueId: to.venueId });
      if (verification.blockers.length) throw new AppError("Il trasferimento tra sedi non può verificare un requisito fisico obbligatorio", 409, verification.blockers);
      warnings.push(...verification.warnings);
      const estimatedSeconds = Number(hint?.estimatedSeconds ?? hint?.estimatedTransferSeconds);
      if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) throw new AppError("Trasferimento inter-Venue senza stima esplicita", 409, [{ code: "INTER_VENUE_TRANSFER_ESTIMATE_REQUIRED", context: { fromVenueId: from.venueId, toVenueId: to.venueId } }]);
      legs.push({ type: "inter_venue", fromAnchorId: from._id, toAnchorId: to._id, venueReleaseId: null, layoutRevisionId: null, path: [], estimatedSeconds: Math.round(estimatedSeconds), preferencePenalty: 0, instruction: hint?.instruction || hint?.instructionOverride || null });
      const destinationBundle = resolved.bundleByVenueId.get(id(to.venueId));
      to.approachInstruction = resolveApproachInstruction({ layoutRevision: destinationBundle.layout, destinationExhibitSlotId: to.exhibitSlotId });
      continue;
    }
    const bundle = resolved.bundleByVenueId.get(id(from.venueId));
    const route = resolveRoute({ connections: bundle.layout.connections || [], places: bundle.layout.places || [], fromPlaceId: from.placeId, toPlaceId: to.placeId, requirements: requirementsByVenue.get(id(from.venueId)) || [], speedMps, learnedResidualByConnection: {} });
    if (!route.reachable) throw new AppError("Nessun percorso compatibile tra due VisitAnchor", 409, [{ code: "SESSION_ROUTE_UNREACHABLE", context: { venueId: from.venueId, fromAnchorId: from._id, toAnchorId: to._id } }]);
    const incomingConnectionId = route.path?.at(-1)?.connectionId || route.path?.at(-1) || null;
    to.approachInstruction = resolveApproachInstruction({
      layoutRevision: bundle.layout,
      destinationExhibitSlotId: to.exhibitSlotId,
      sourceExhibitSlotId: from.exhibitSlotId,
      incomingConnectionId,
    });
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
  const { physicalVocabulary, revision: physicalVocabularyRevision } = await loadLayoutPhysicalVocabulary(layout, { requireStable: true });
  return { pin, release, layout, physicalVocabulary, physicalVocabularyRevision };
}

async function routeToPhysicalFeatureInSession({ session, venueId, fromPlaceId, physicalFeatureRef }) {
  const bundle = await loadPinnedBundle(session, venueId);
  const destinations = placesForPhysicalFeature({ layoutRevision: bundle.layout, physicalVocabulary: bundle.physicalVocabulary, physicalVocabularyRevision: bundle.physicalVocabularyRevision, physicalFeatureRef });
  if (!destinations.length) throw new AppError("La Venue non contiene una destinazione per la caratteristica fisica richiesta", 404);
  const profileSelections = selectionMap(session.navigationSnapshot?.routingProfileSelections || []);
  const translated = resolveNavigationRequirementsForVenue({
    bundle,
    globalRequirements: session.navigationSnapshot?.requirements || [],
    routingProfileSelection: profileSelections.get(id(venueId)) || null,
  });
  if (translated.blockers.length) throw new AppError("Snapshot fisica non supporta la configurazione di routing richiesta", 409, routingBlockerDetails(translated.blockers, { venueId }));
  const candidates = destinations.map((destination) => ({
    destination,
    route: resolveRoute({ connections: bundle.layout.connections || [], places: bundle.layout.places || [], fromPlaceId, toPlaceId: destination._id, requirements: translated.requirements, speedMps: session.sessionMovementSpeedMps, learnedResidualByConnection: {} }),
  })).filter((entry) => entry.route.reachable);
  if (!candidates.length) throw new AppError("Nessuna destinazione raggiungibile per la caratteristica fisica richiesta", 409);
  const fastest = Math.min(...candidates.map((entry) => entry.route.estimatedSeconds));
  const acceptable = candidates.filter((entry) => entry.route.estimatedSeconds <= fastest * (1 + policy.routing.maxPreferredDetourRatio));
  acceptable.sort((a, b) => (a.route.preferencePenalty || 0) - (b.route.preferencePenalty || 0) || a.route.estimatedSeconds - b.route.estimatedSeconds);
  const best = acceptable[0];
  return {
    venueId: bundle.pin.venueId,
    venueReleaseId: bundle.pin.venueReleaseId,
    layoutRevisionId: bundle.pin.layoutRevisionId,
    requestedPhysicalFeatureRef: physicalFeatureRef,
    physicalFeatureRef: { kind: "local", physicalVocabularyId: bundle.physicalVocabulary._id, definitionId: best.destination.placeTypeDefinitionId },
    destination: best.destination,
    warnings: translated.warnings.map((entry) => ({ ...entry, venueId: bundle.pin.venueId })),
    ...best.route,
  };
}

module.exports = {
  id,
  resolveMovementSpeed,
  translateRequirements,
  routingBlockerDetails,
  assertRequirementScope,
  interVenueRequirementOutcome,
  resolveNavigationRequirementsForVenue,
  resolveSessionVenuePins,
  materializeSessionPhysicalPlan,
  loadPinnedBundle,
  routeToPhysicalFeatureInSession,
};
