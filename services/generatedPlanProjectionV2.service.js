const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const VenueTarget = require("../models/venueTarget.model");
const Venue = require("../models/venue.model");
const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContext = require("../models/editorialContext.model");
const { venueTargetIdentityMap } = require("./venueTargetIdentityProjection.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }

function operationProjection(plan) {
  const operations = [];
  if (plan.status === "proposed") operations.push({ code: "accept", label: "Accetta proposta" });
  if (plan.status === "accepted") {
    operations.push({ code: "start", label: "Avvia visita" });
    if (!plan.materializedVisitId) operations.push({ code: "materialize", label: "Salva nelle mie visite" });
  }
  if (plan.materializedVisitId) operations.push({ code: "open_visit", label: "Apri visita salvata", visitId: plan.materializedVisitId });
  return operations;
}

function warningProjection(warning) {
  const code = warning?.code || "GENERATION_WARNING";
  const messages = {
    VENUE_WITHOUT_PRIMARY_EDITORIAL_CONTEXT: "Una sede selezionata non dispone di un contesto editoriale primario.",
    PRIMARY_EDITORIAL_CONTEXT_NOT_AUTHORIZED: "Il contesto editoriale primario di una sede non è utilizzabile dal tuo account.",
    PREFERRED_ATTRIBUTE_UNSUPPORTED: "Una preferenza di percorso non è disponibile in una delle sedi.",
  };
  return { code, message: messages[code] || warning?.message || "La proposta contiene un avviso." };
}

async function projectGeneratedPlanV2(planDocument) {
  const plan = planDocument?.toObject ? planDocument.toObject() : planDocument;
  const revisionIds = uniqueIds((plan.contentEntries || []).map((entry) => entry.itemRevisionId));
  const targetIds = uniqueIds((plan.visitAnchors || []).map((anchor) => anchor.venueTargetId));
  const releaseIds = uniqueIds(plan.sourceEditorialReleaseIds || []);
  const [revisions, targets, releases] = await Promise.all([
    revisionIds.length
      ? ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("_id label authorCredits metadata").lean()
      : [],
    targetIds.length
      ? VenueTarget.find({ _id: { $in: targetIds }, lifecycleStatus: "active" }).select("_id venueId subjectId displayLabelOverride inventoryNote").lean()
      : [],
    releaseIds.length
      ? EditorialRelease.find({ _id: { $in: releaseIds } }).select("_id editorialContextId version").lean()
      : [],
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  const targetIdentityById = await venueTargetIdentityMap(targets);
  const venueIds = uniqueIds(targets.map((target) => target.venueId));
  const contextIds = uniqueIds(releases.map((release) => release.editorialContextId));
  const [venues, contexts] = await Promise.all([
    venueIds.length ? Venue.find({ _id: { $in: venueIds } }).select("_id name description").lean() : [],
    contextIds.length ? EditorialContext.find({ _id: { $in: contextIds }, lifecycleStatus: "active" }).select("_id displayName shortDescription description").lean() : [],
  ]);
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const contextById = new Map(contexts.map((context) => [id(context._id), context]));
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  const sourceMetadata = new Map((plan.contextSnapshot?.editorialSources || []).map((entry) => [id(entry.editorialReleaseId), entry]));

  const anchorById = new Map((plan.visitAnchors || []).map((anchor) => [id(anchor._id), anchor]));
  const contentEntries = (plan.contentEntries || []).map((entry, index) => {
    const revision = revisionById.get(id(entry.itemRevisionId));
    const anchor = entry.deliveryAnchorId ? anchorById.get(id(entry.deliveryAnchorId)) : null;
    const target = anchor ? targetById.get(id(anchor.venueTargetId)) : null;
    const venue = target ? venueById.get(id(target.venueId)) : null;
    return {
      position: index + 1,
      title: revision?.label || "Contenuto",
      role: entry.role || "recommended",
      authorCredits: revision?.authorCredits || [],
      license: revision?.metadata?.license || null,
      delivery: target ? {
        targetLabel: targetIdentityById.get(id(target._id))?.label || "Entità della sede",
        venueName: venue?.name || "Sede",
      } : null,
      estimatedContentSeconds: Number(entry.estimatedContentSeconds) || 0,
    };
  });

  const stops = (plan.visitAnchors || []).map((anchor, index) => {
    const target = targetById.get(id(anchor.venueTargetId));
    const venue = target ? venueById.get(id(target.venueId)) : null;
    return {
      position: index + 1,
      label: target ? targetIdentityById.get(id(target._id))?.label || "Tappa" : "Tappa",
      venueName: venue?.name || "Sede",
    };
  });

  const physicalScope = venueIds.map((venueId) => {
    const venue = venueById.get(venueId);
    return { id: venueId, name: venue?.name || "Sede", description: venue?.description || "" };
  });
  const editorialSources = releaseIds.map((releaseId) => {
    const release = releaseById.get(releaseId);
    const context = release ? contextById.get(id(release.editorialContextId)) : null;
    const metadata = sourceMetadata.get(releaseId);
    return {
      name: context?.displayName || "Contesto editoriale",
      version: release?.version || null,
      versionMode: metadata?.versionMode || "pinned",
    };
  });
  const legs = plan.physicalRoute?.legs || [];
  const timing = plan.estimatedTiming || {};
  return {
    id: plan._id,
    status: plan.status,
    createdAt: plan.createdAt,
    acceptedAt: plan.acceptedAt || null,
    materializedVisitId: plan.materializedVisitId || null,
    editorialSources,
    physicalScope,
    contentEntries,
    stops,
    timing: {
      totalSeconds: Number(timing.totalSeconds) || 0,
      contentSeconds: Number(timing.contentSeconds) || 0,
      observationSeconds: Number(timing.observationSeconds) || 0,
      travelSeconds: Number(timing.logisticsSeconds) || 0,
      reservedSeconds: Number(timing.reservedSeconds) || 0,
    },
    routeSummary: {
      stopCount: stops.length,
      legCount: legs.length,
      venueCount: physicalScope.length,
      interVenueLegCount: legs.filter((leg) => leg.type === "inter_venue").length,
    },
    warnings: (plan.explanation?.warnings || []).map(warningProjection),
    operations: operationProjection(plan),
  };
}

module.exports = { projectGeneratedPlanV2 };
