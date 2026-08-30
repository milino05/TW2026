const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) {
  return [...new Map((values || []).map((value) => [id(value), value]).filter(([key]) => key)).values()];
}

function normalizeView(view) {
  const value = String(view || "effective").trim();
  if (!["effective", "working", "published"].includes(value)) {
    throw new AppError("view deve essere effective, working o published", 400, [{ field: "view", code: "INVALID_VIEW" }]);
  }
  return value;
}

function selectReleaseId(venue, view) {
  if (view === "working") return venue.workingReleaseId || null;
  if (view === "published") return venue.publishedReleaseId || null;
  return venue.workingReleaseId || venue.publishedReleaseId || null;
}

function resolvedViewFor(venue, requestedView) {
  if (requestedView !== "effective") return requestedView;
  return venue.workingReleaseId ? "working" : "published";
}

async function loadPhysicalProjectionState({ venue, view }) {
  const releaseId = selectReleaseId(venue, view);
  if (!releaseId) return { release: null, layout: null, resolvedView: resolvedViewFor(venue, view) };
  const release = await VenueRelease.findOne({ _id: releaseId, venueId: venue._id })
    .select("_id venueId layoutRevisionId targetBindings")
    .lean();
  if (!release) {
    throw new AppError("VenueRelease della projection Subject/Venue non disponibile", 409, [{
      code: "VENUE_SUBJECT_RELEASE_UNAVAILABLE",
      context: { venueId: venue._id, releaseId },
    }]);
  }
  const layout = await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: venue._id })
    .select("_id floors places exhibitSlots")
    .lean();
  if (!layout) {
    throw new AppError("LayoutRevision della projection Subject/Venue non disponibile", 409, [{
      code: "VENUE_SUBJECT_LAYOUT_UNAVAILABLE",
      context: { venueId: venue._id, layoutRevisionId: release.layoutRevisionId },
    }]);
  }
  return { release, layout, resolvedView: resolvedViewFor(venue, view) };
}

function buildPhysicalLookups({ release, layout }) {
  const bindingByTargetId = new Map((release?.targetBindings || []).map((binding) => [id(binding.venueTargetId), binding]));
  const slotEntryById = new Map((layout?.exhibitSlots || []).map((slot) => [id(slot.exhibitSlotId), slot]));
  const placeById = new Map((layout?.places || []).map((place) => [id(place._id), place]));
  const floorById = new Map((layout?.floors || []).map((floor) => [id(floor._id), floor]));
  return { bindingByTargetId, slotEntryById, placeById, floorById };
}

function projectInventory(target, lookups) {
  if (!target) return null;
  const binding = lookups.bindingByTargetId.get(id(target._id)) || null;
  const slotEntry = binding?.exhibitSlotId ? lookups.slotEntryById.get(id(binding.exhibitSlotId)) || null : null;
  const place = slotEntry ? lookups.placeById.get(id(slotEntry.placeId)) || null : null;
  const floor = place ? lookups.floorById.get(id(place.floorId)) || null : null;
  let status = "unplaced";
  if (binding?.availability === "unavailable") status = "unavailable";
  else if (binding?.availability === "active" && slotEntry && place) status = "exposed";
  return {
    venueTargetId: target._id,
    status,
    availability: binding?.availability || null,
    slot: slotEntry ? {
      id: slotEntry.exhibitSlotId,
      label: slotEntry.label,
      order: slotEntry.order ?? null,
    } : null,
    place: place ? {
      id: place._id,
      label: place.label || null,
      floorId: place.floorId,
      floorLabel: floor?.label || null,
    } : null,
  };
}

async function projectMuseumContent({ ownerOrganizationId, subjectIds }) {
  const result = new Map(subjectIds.map((subjectId) => [id(subjectId), { availableCount: 0, draftCount: 0 }]));
  if (!subjectIds.length) return result;
  const items = await ItemV2.find({
    ownerType: "organization",
    ownerId: ownerOrganizationId,
    lifecycleStatus: "active",
    primarySubjectId: { $in: subjectIds },
  }).select("_id primarySubjectId").lean();
  if (!items.length) return result;

  const editions = await ItemEdition.find({ itemId: { $in: items.map((item) => item._id) } })
    .select("itemId publishedRevisionId workingRevisionId")
    .lean();
  const publishedRevisionIds = uniqueIds(editions.map((edition) => edition.publishedRevisionId));
  const workingRevisionIds = uniqueIds(editions.map((edition) => edition.workingRevisionId));
  const [publishedRevisions, workingRevisions] = await Promise.all([
    publishedRevisionIds.length
      ? ItemRevisionV2.find({ _id: { $in: publishedRevisionIds }, status: { $in: ["published", "superseded"] } }).select("_id").lean()
      : [],
    workingRevisionIds.length
      ? ItemRevisionV2.find({ _id: { $in: workingRevisionIds }, status: { $in: ["draft", "in_review", "changes_requested"] } }).select("_id").lean()
      : [],
  ]);
  const usablePublishedIds = new Set(publishedRevisions.map((revision) => id(revision._id)));
  const liveWorkingIds = new Set(workingRevisions.map((revision) => id(revision._id)));
  const editionFlagsByItemId = new Map();
  for (const edition of editions) {
    const itemId = id(edition.itemId);
    const flags = editionFlagsByItemId.get(itemId) || { available: false, draft: false };
    if (edition.publishedRevisionId && usablePublishedIds.has(id(edition.publishedRevisionId))) flags.available = true;
    if (edition.workingRevisionId && liveWorkingIds.has(id(edition.workingRevisionId))) flags.draft = true;
    editionFlagsByItemId.set(itemId, flags);
  }
  for (const item of items) {
    const counts = result.get(id(item.primarySubjectId));
    const flags = editionFlagsByItemId.get(id(item._id));
    if (!counts || !flags) continue;
    if (flags.available) counts.availableCount += 1;
    if (flags.draft) counts.draftCount += 1;
  }
  return result;
}

async function projectVenueSubjectContext({ venueId, subjectIds = [], view = "effective" }) {
  const requestedView = normalizeView(view);
  const uniqueSubjectIds = uniqueIds(subjectIds);
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" })
    .select("_id name ownerOrganizationId workingReleaseId publishedReleaseId")
    .lean();
  if (!venue) throw new AppError("Venue non disponibile", 404);

  const [targets, physicalState, museumContentBySubjectId] = await Promise.all([
    uniqueSubjectIds.length
      ? VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active", subjectId: { $in: uniqueSubjectIds } })
        .select("_id subjectId")
        .lean()
      : [],
    loadPhysicalProjectionState({ venue, view: requestedView }),
    projectMuseumContent({ ownerOrganizationId: venue.ownerOrganizationId, subjectIds: uniqueSubjectIds }),
  ]);
  const targetBySubjectId = new Map(targets.map((target) => [id(target.subjectId), target]));
  const lookups = buildPhysicalLookups(physicalState);
  return {
    venue: { id: venue._id, name: venue.name },
    view: physicalState.resolvedView,
    releaseId: physicalState.release?._id || null,
    subjects: uniqueSubjectIds.map((subjectId) => ({
      subjectId,
      inventory: projectInventory(targetBySubjectId.get(id(subjectId)) || null, lookups),
      museumContent: museumContentBySubjectId.get(id(subjectId)) || { availableCount: 0, draftCount: 0 },
    })),
  };
}

function venueSubjectContextMap(projection) {
  return new Map((projection?.subjects || []).map((entry) => [id(entry.subjectId), entry]));
}

module.exports = {
  projectVenueSubjectContext,
  venueSubjectContextMap,
};
