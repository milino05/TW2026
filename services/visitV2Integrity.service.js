const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const VenueTarget = require("../models/venueTarget.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");

function id(value) { return String(value?._id || value || ""); }
function issue(field, code, message, severity = "error", context = undefined) {
  return { field, code, message, severity, ...(context === undefined ? {} : { context }) };
}

async function computeVisitV2Integrity(revision) {
  const issues = [];
  const sourceById = new Map((revision.editorialSources || []).map((source) => [id(source._id), source]));
  const releaseIds = [...new Set((revision.editorialSources || []).map((source) => id(source.editorialReleaseId)).filter(Boolean))];
  const releases = await EditorialRelease.find({ _id: { $in: releaseIds } }).lean();
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));

  if (!(revision.contentEntries || []).length) issues.push(issue("contentEntries", "EMPTY_VISIT_CONTENT", "Una Visit pubblicabile deve contenere almeno una ContentEntry"));
  if (!(revision.visitAnchors || []).length) issues.push(issue("visitAnchors", "EMPTY_PHYSICAL_ITINERARY", "Una Visit pubblicabile deve contenere almeno un VisitAnchor"));

  const seenReleaseIds = new Set();
  (revision.editorialSources || []).forEach((source, index) => {
    const field = `editorialSources[${index}].editorialReleaseId`;
    const releaseId = id(source.editorialReleaseId);
    if (!releaseById.has(releaseId)) issues.push(issue(field, "EDITORIAL_RELEASE_NOT_FOUND", "EditorialRelease non disponibile"));
    if (seenReleaseIds.has(releaseId)) issues.push(issue(field, "DUPLICATE_EDITORIAL_SOURCE", "La stessa EditorialRelease non deve essere dichiarata due volte"));
    seenReleaseIds.add(releaseId);
  });

  const editionIds = [...new Set((revision.contentEntries || []).map((entry) => id(entry.itemEditionId)).filter(Boolean))];
  const revisionIds = [...new Set((revision.contentEntries || []).map((entry) => id(entry.itemRevisionId)).filter(Boolean))];
  const editions = await ItemEdition.find({ _id: { $in: editionIds } }).lean();
  const itemRevisions = await ItemRevisionV2.find({ _id: { $in: revisionIds } }).lean();
  const editionById = new Map(editions.map((entry) => [id(entry._id), entry]));
  const itemRevisionById = new Map(itemRevisions.map((entry) => [id(entry._id), entry]));
  const itemIds = [...new Set(editions.map((entry) => id(entry.itemId)))];
  const activeItems = await ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("_id").lean();
  const activeItemIds = new Set(activeItems.map((entry) => id(entry._id)));

  const anchorById = new Map((revision.visitAnchors || []).map((anchor) => [id(anchor._id), anchor]));
  const anchorUseCount = new Map([...anchorById.keys()].map((key) => [key, 0]));

  (revision.contentEntries || []).forEach((entry, index) => {
    const base = `contentEntries[${index}]`;
    const source = sourceById.get(id(entry.editorialSourceId));
    if (!source) {
      issues.push(issue(`${base}.editorialSourceId`, "UNKNOWN_EDITORIAL_SOURCE", "ContentEntry riferisce un EditorialSource non presente nella revisione"));
      return;
    }
    const release = releaseById.get(id(source.editorialReleaseId));
    if (!release) return;
    const edition = editionById.get(id(entry.itemEditionId));
    const itemRevision = itemRevisionById.get(id(entry.itemRevisionId));
    if (!edition) issues.push(issue(`${base}.itemEditionId`, "ITEM_EDITION_NOT_FOUND", "ItemEdition non trovata"));
    if (!itemRevision) issues.push(issue(`${base}.itemRevisionId`, "ITEM_REVISION_NOT_FOUND", "ItemRevision non trovata"));
    if (edition && id(edition.itemId) !== id(entry.itemId)) issues.push(issue(`${base}.itemId`, "ITEM_EDITION_MISMATCH", "itemId non appartiene alla ItemEdition indicata"));
    if (edition && !activeItemIds.has(id(edition.itemId))) issues.push(issue(`${base}.itemId`, "ITEM_NOT_ACTIVE", "Item non disponibile"));
    if (itemRevision && id(itemRevision.itemEditionId) !== id(entry.itemEditionId)) issues.push(issue(`${base}.itemRevisionId`, "ITEM_REVISION_MISMATCH", "ItemRevision non appartiene alla ItemEdition indicata"));
    const releasedBinding = (release.itemBindings || []).find((binding) => id(binding.itemEditionId) === id(entry.itemEditionId) && id(binding.itemRevisionId) === id(entry.itemRevisionId));
    if (!releasedBinding) issues.push(issue(base, "CONTENT_NOT_IN_EDITORIAL_RELEASE", "La ItemEdition/ItemRevision non e inclusa nella EditorialRelease dichiarata"));
    if (entry.deliveryAnchorId) {
      const anchorId = id(entry.deliveryAnchorId);
      if (!anchorById.has(anchorId)) issues.push(issue(`${base}.deliveryAnchorId`, "UNKNOWN_VISIT_ANCHOR", "deliveryAnchorId non appartiene alla VisitRevision"));
      else anchorUseCount.set(anchorId, (anchorUseCount.get(anchorId) || 0) + 1);
    }
  });

  const targetIds = [...new Set((revision.visitAnchors || []).map((anchor) => id(anchor.venueTargetId)).filter(Boolean))];
  const targets = await VenueTarget.find({ _id: { $in: targetIds }, lifecycleStatus: "active" }).lean();
  const targetById = new Map(targets.map((target) => [id(target._id), target]));
  const venueIds = [...new Set(targets.map((target) => id(target.venueId)))];
  const venues = await Venue.find({ _id: { $in: venueIds }, lifecycleStatus: "active" }).lean();
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));
  const releaseIdByVenue = new Map(venues.filter((venue) => venue.publishedReleaseId).map((venue) => [id(venue._id), id(venue.publishedReleaseId)]));
  const venueReleases = await VenueRelease.find({ _id: { $in: [...releaseIdByVenue.values()] }, status: "published" }).lean();
  const venueReleaseById = new Map(venueReleases.map((release) => [id(release._id), release]));

  const anchorVenueId = new Map();
  (revision.visitAnchors || []).forEach((anchor, index) => {
    const base = `visitAnchors[${index}]`;
    const target = targetById.get(id(anchor.venueTargetId));
    if (!target) {
      issues.push(issue(`${base}.venueTargetId`, "VENUE_TARGET_NOT_ACTIVE", "VenueTarget non disponibile"));
      return;
    }
    const venue = venueById.get(id(target.venueId));
    if (!venue) {
      issues.push(issue(`${base}.venueTargetId`, "VENUE_NOT_ACTIVE", "Venue del target non disponibile"));
      return;
    }
    anchorVenueId.set(id(anchor._id), id(venue._id));
    const publishedRelease = venueReleaseById.get(releaseIdByVenue.get(id(venue._id)));
    const binding = (publishedRelease?.targetBindings || []).find((entry) => id(entry.venueTargetId) === id(target._id) && entry.availability === "active");
    if (!binding) issues.push(issue(`${base}.venueTargetId`, "TARGET_NOT_IN_PUBLISHED_VENUE_RELEASE", "VenueTarget non attivo nella VenueRelease pubblicata corrente"));
    if ((anchorUseCount.get(id(anchor._id)) || 0) === 0) issues.push(issue(base, "ANCHOR_WITHOUT_CONTENT", "VisitAnchor senza ContentEntry associata", "warning"));
  });

  (revision.logistics?.routeHints || []).forEach((hint, index) => {
    const base = `logistics.routeHints[${index}]`;
    const fromAnchor = anchorById.get(id(hint.fromAnchorId));
    const toAnchor = anchorById.get(id(hint.toAnchorId));
    if (!fromAnchor) issues.push(issue(`${base}.fromAnchorId`, "UNKNOWN_VISIT_ANCHOR", "fromAnchorId non appartiene alla VisitRevision"));
    if (!toAnchor) issues.push(issue(`${base}.toAnchorId`, "UNKNOWN_VISIT_ANCHOR", "toAnchorId non appartiene alla VisitRevision"));
    if (!fromAnchor || !toAnchor) return;
    const fromVenue = anchorVenueId.get(id(fromAnchor._id));
    const toVenue = anchorVenueId.get(id(toAnchor._id));
    if (!fromVenue || !toVenue) return;
    if (hint.type === "indoor" && fromVenue !== toVenue) issues.push(issue(`${base}.type`, "INDOOR_ROUTE_CROSSES_VENUES", "Un RouteHint indoor deve restare nella stessa Venue"));
    if (hint.type === "inter_venue" && fromVenue === toVenue) issues.push(issue(`${base}.type`, "INTER_VENUE_ROUTE_SAME_VENUE", "Un RouteHint inter_venue deve collegare Venue diverse"));
    if (hint.type === "inter_venue" && !(Number(hint.estimatedTransferSeconds) > 0)) issues.push(issue(`${base}.estimatedTransferSeconds`, "INTER_VENUE_ESTIMATE_REQUIRED", "Finche non esiste un provider inter-Venue e richiesta una stima di trasferimento positiva"));
  });

  return {
    issues,
    editorialReleaseIds: releaseIds,
    venueIds,
    venueTargetIds: targetIds,
  };
}

module.exports = { computeVisitV2Integrity };
