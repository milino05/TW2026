const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const AppError = require("../utils/AppError");
const { projectOrganizationSubjectUsage } = require("./organizationSubjectUsage.service");

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

async function projectVenueSubjectContext({ venueId, subjectIds = [], view = "effective", organizationUsageBySubjectId = null }) {
  const requestedView = normalizeView(view);
  const uniqueSubjectIds = uniqueIds(subjectIds);
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active" })
    .select("_id name ownerOrganizationId workingReleaseId publishedReleaseId")
    .lean();
  if (!venue) throw new AppError("Venue non disponibile", 404);

  const [targets, physicalState, usageBySubjectId] = await Promise.all([
    uniqueSubjectIds.length
      ? VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active", subjectId: { $in: uniqueSubjectIds } })
        .select("_id subjectId")
        .lean()
      : [],
    loadPhysicalProjectionState({ venue, view: requestedView }),
    organizationUsageBySubjectId || projectOrganizationSubjectUsage({ organizationId: venue.ownerOrganizationId, subjectIds: uniqueSubjectIds }),
  ]);
  const targetBySubjectId = new Map(targets.map((target) => [id(target.subjectId), target]));
  const lookups = buildPhysicalLookups(physicalState);
  return {
    venue: { id: venue._id, name: venue.name },
    view: physicalState.resolvedView,
    releaseId: physicalState.release?._id || null,
    subjects: uniqueSubjectIds.map((subjectId) => {
      const usage = usageBySubjectId.get(id(subjectId)) || { itemCount: 0, availableCount: 0, draftCount: 0, collectionCount: 0, previewMedia: null };
      return {
        subjectId,
        inventory: projectInventory(targetBySubjectId.get(id(subjectId)) || null, lookups),
        museumContent: { availableCount: usage.availableCount, draftCount: usage.draftCount },
        organizationUsage: usage,
      };
    }),
  };
}

function venueSubjectContextMap(projection) {
  return new Map((projection?.subjects || []).map((entry) => [id(entry.subjectId), entry]));
}

module.exports = {
  projectVenueSubjectContext,
  venueSubjectContextMap,
};
