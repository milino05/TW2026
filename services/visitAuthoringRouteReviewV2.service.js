const VenueTarget = require("../models/venueTarget.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const { resolveRoute } = require("./graphRouting.service");
const { resolveVenueTargetExhibit } = require("./venueExhibitResolution.service");

function id(value) { return String(value?._id || value || ""); }
function venueMapHref(venueId) { return `/venues/editor?venueId=${encodeURIComponent(id(venueId))}#venue-map`; }
function blocker(code, message, context = {}) {
  return { code, message, severity: "error", ...context };
}
function warning(code, message, context = {}) {
  return { code, message, severity: "warning", ...context };
}
function hintFor(revision, fromAnchorId, toAnchorId, type = null) {
  return (revision.logistics?.routeHints || []).find((hint) => (
    id(hint.fromAnchorId) === id(fromAnchorId)
    && id(hint.toAnchorId) === id(toAnchorId)
    && (!type || hint.type === type)
  )) || null;
}

async function physicalBundlesForAnchors(revision) {
  const targetIds = [...new Set((revision.visitAnchors || []).map((anchor) => id(anchor.venueTargetId)).filter(Boolean))];
  const targets = targetIds.length
    ? await VenueTarget.find({ _id: { $in: targetIds }, lifecycleStatus: "active" }).select("_id venueId displayLabelOverride subjectId").lean()
    : [];
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  const venueIds = [...new Set(targets.map((target) => id(target.venueId)))];
  const venues = venueIds.length
    ? await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).select("_id name publishedReleaseId").lean()
    : [];
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const releaseIds = venues.map((venue) => venue.publishedReleaseId).filter(Boolean);
  const releases = releaseIds.length
    ? await VenueRelease.find({ _id: { $in: releaseIds }, status: "published" }).select("_id venueId layoutRevisionId targetBindings integrity").lean()
    : [];
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  const layoutIds = releases.map((release) => release.layoutRevisionId).filter(Boolean);
  const layouts = layoutIds.length
    ? await LayoutRevision.find({ _id: { $in: layoutIds }, status: { $in: ["published", "superseded"] } })
      .select("_id venueId places connections exhibitSlots")
      .lean()
    : [];
  const layoutById = new Map(layouts.map((layout) => [id(layout._id), layout]));
  const bundleByVenueId = new Map();
  for (const venue of venues) {
    const release = releaseById.get(id(venue.publishedReleaseId));
    const layout = release ? layoutById.get(id(release.layoutRevisionId)) : null;
    bundleByVenueId.set(id(venue._id), { venue, release, layout });
  }
  return { targetById, venueById, bundleByVenueId };
}

async function projectVisitAuthoringRouteReview(revision) {
  if (!revision) return { status: "not_available", legs: [], blockers: [], warnings: [] };
  const anchors = revision.visitAnchors || [];
  const physical = await physicalBundlesForAnchors(revision);
  const blockers = [];
  const warnings = [];
  const resolvedAnchors = new Map();

  for (const [index, anchor] of anchors.entries()) {
    const target = physical.targetById.get(id(anchor.venueTargetId));
    if (!target) {
      blockers.push(blocker("VISIT_ANCHOR_TARGET_UNAVAILABLE", "La tappa fa riferimento a un’entità fisica non più disponibile.", {
        anchorId: anchor._id,
        anchorIndex: index,
      }));
      continue;
    }
    const bundle = physical.bundleByVenueId.get(id(target.venueId));
    const fixHref = venueMapHref(target.venueId);
    if (!bundle?.release || bundle.release.integrity?.status !== "valid" || !bundle.layout) {
      blockers.push(blocker("VISIT_VENUE_PHYSICAL_CONFIGURATION_UNAVAILABLE", "La configurazione fisica pubblicata della sede non è utilizzabile.", {
        anchorId: anchor._id,
        anchorIndex: index,
        venueId: target.venueId,
        fixHref,
      }));
      continue;
    }
    let physicalResolution;
    try { physicalResolution = resolveVenueTargetExhibit({ venueRelease: bundle.release, layoutRevision: bundle.layout, venueTargetId: target._id }); }
    catch {
      blockers.push(blocker("VISIT_ANCHOR_TARGET_UNPLACED", "L'entità della tappa non è assegnata a uno slot espositivo pubblicato.", {
        anchorId: anchor._id,
        anchorIndex: index,
        venueId: target.venueId,
        fixHref,
      }));
      continue;
    }
    resolvedAnchors.set(id(anchor._id), {
      anchor,
      target,
      bundle,
      exhibitSlotId: physicalResolution.exhibitSlot.exhibitSlotId,
      placeId: physicalResolution.place._id,
    });
  }

  const legs = [];
  for (let index = 1; index < anchors.length; index += 1) {
    const fromAnchor = anchors[index - 1];
    const toAnchor = anchors[index];
    const from = resolvedAnchors.get(id(fromAnchor._id));
    const to = resolvedAnchors.get(id(toAnchor._id));
    if (!from || !to) {
      legs.push({
        index: index - 1,
        fromAnchorId: fromAnchor._id,
        toAnchorId: toAnchor._id,
        type: "unresolved",
        status: "blocked",
      });
      continue;
    }
    if (id(from.target.venueId) !== id(to.target.venueId)) {
      const hint = hintFor(revision, fromAnchor._id, toAnchor._id, "inter_venue");
      const estimatedSeconds = Number(hint?.estimatedTransferSeconds);
      if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) {
        blockers.push(blocker("VISIT_INTER_VENUE_TRANSFER_REQUIRED", "Indica una stima di trasferimento tra le due sedi; ArtAround non inventa tempi inter-Venue.", {
          fromAnchorId: fromAnchor._id,
          toAnchorId: toAnchor._id,
          fromVenueId: from.target.venueId,
          toVenueId: to.target.venueId,
        }));
        legs.push({
          index: index - 1,
          fromAnchorId: fromAnchor._id,
          toAnchorId: toAnchor._id,
          type: "inter_venue",
          status: "blocked",
          estimatedSeconds: null,
          instruction: hint?.instructionOverride || null,
        });
        continue;
      }
      legs.push({
        index: index - 1,
        fromAnchorId: fromAnchor._id,
        toAnchorId: toAnchor._id,
        type: "inter_venue",
        status: "ready",
        estimatedSeconds: Math.round(estimatedSeconds),
        distanceMeters: null,
        instruction: hint?.instructionOverride || null,
      });
      continue;
    }

    const bundle = from.bundle;
    const route = resolveRoute({
      connections: bundle.layout.connections || [],
      places: bundle.layout.places || [],
      fromPlaceId: from.placeId,
      toPlaceId: to.placeId,
      requirements: [],
      learnedResidualByConnection: {},
    });
    const indoorHint = hintFor(revision, fromAnchor._id, toAnchor._id, "indoor");
    if (!route.reachable) {
      const fixHref = venueMapHref(from.target.venueId);
      blockers.push(blocker("VISIT_INDOOR_ROUTE_UNREACHABLE", "Le due tappe non sono collegate da un percorso nella mappa pubblicata della sede.", {
        fromAnchorId: fromAnchor._id,
        toAnchorId: toAnchor._id,
        venueId: from.target.venueId,
        fixHref,
      }));
      legs.push({
        index: index - 1,
        fromAnchorId: fromAnchor._id,
        toAnchorId: toAnchor._id,
        type: "indoor",
        status: "blocked",
        venueId: from.target.venueId,
        estimatedSeconds: null,
        distanceMeters: null,
        instruction: indoorHint?.instructionOverride || null,
      });
      continue;
    }
    legs.push({
      index: index - 1,
      fromAnchorId: fromAnchor._id,
      toAnchorId: toAnchor._id,
      type: "indoor",
      status: "ready",
      venueId: from.target.venueId,
      estimatedSeconds: Math.round(Number(route.estimatedSeconds) || 0),
      distanceMeters: Math.round((Number(route.distanceMeters) || 0) * 10) / 10,
      instruction: indoorHint?.instructionOverride || null,
    });
  }

  if (anchors.length === 1) {
    warnings.push(warning("VISIT_SINGLE_PHYSICAL_STOP", "La visita contiene una sola tappa fisica; non è necessario calcolare un percorso tra tappe."));
  }

  return {
    status: blockers.length ? "blocked" : "ready",
    legs,
    blockers,
    warnings,
  };
}

module.exports = {
  venueMapHref,
  projectVisitAuthoringRouteReview,
};
