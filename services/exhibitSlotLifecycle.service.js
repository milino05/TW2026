const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const ExhibitSlot = require("../models/exhibitSlot.model");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function layoutExhibitSlotIds(layout) {
  return uniqueIds((layout?.exhibitSlots || []).map((entry) => entry.exhibitSlotId));
}

async function publishedExhibitSlotIdsForVenue({ venueId, session = null }) {
  let venueQuery = Venue.findOne({ _id: venueId, lifecycleStatus: "active" }).select("publishedReleaseId");
  if (session) venueQuery = venueQuery.session(session);
  const venue = await venueQuery.lean();
  if (!venue?.publishedReleaseId) return [];

  let releaseQuery = VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId }).select("layoutRevisionId");
  if (session) releaseQuery = releaseQuery.session(session);
  const release = await releaseQuery.lean();
  if (!release?.layoutRevisionId) return [];

  let layoutQuery = LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId }).select("exhibitSlots.exhibitSlotId");
  if (session) layoutQuery = layoutQuery.session(session);
  const layout = await layoutQuery.lean();
  return layoutExhibitSlotIds(layout);
}

async function restoreExhibitSlots({ venueId, exhibitSlotIds = [], session = null }) {
  const ids = uniqueIds(exhibitSlotIds);
  if (!ids.length) return [];
  await ExhibitSlot.updateMany(
    { _id: { $in: ids }, venueId, lifecycleStatus: "trashed" },
    { $set: { lifecycleStatus: "active", trashedAt: null, trashedBy: null } },
    session ? { session } : {},
  );
  return ids;
}

async function retireExhibitSlots({ venueId, exhibitSlotIds = [], actorUserId, session = null }) {
  const ids = uniqueIds(exhibitSlotIds);
  if (!ids.length) return [];
  await ExhibitSlot.updateMany(
    { _id: { $in: ids }, venueId, lifecycleStatus: "active" },
    { $set: { lifecycleStatus: "trashed", trashedAt: new Date(), trashedBy: actorUserId } },
    session ? { session } : {},
  );
  return ids;
}

async function retireWorkingRemovedExhibitSlots({ venueId, exhibitSlotIds = [], actorUserId, session = null }) {
  const removedIds = uniqueIds(exhibitSlotIds);
  if (!removedIds.length) {
    return { retiredExhibitSlotIds: [], protectedPublishedExhibitSlotIds: [] };
  }
  const publishedIds = new Set(await publishedExhibitSlotIdsForVenue({ venueId, session }));
  const protectedPublishedExhibitSlotIds = removedIds.filter((slotId) => publishedIds.has(slotId));
  const retiredExhibitSlotIds = removedIds.filter((slotId) => !publishedIds.has(slotId));
  // Some layout commands predate publication-aware lifecycle and may have marked every
  // removed slot as trashed inside the same transaction. Restore current-publication
  // identities before commit, then retire only draft-only slots.
  await restoreExhibitSlots({ venueId, exhibitSlotIds: protectedPublishedExhibitSlotIds, session });
  await retireExhibitSlots({ venueId, exhibitSlotIds: retiredExhibitSlotIds, actorUserId, session });
  return { retiredExhibitSlotIds, protectedPublishedExhibitSlotIds };
}

function removedExhibitSlotIds(previousLayout, currentLayout) {
  const currentIds = new Set(layoutExhibitSlotIds(currentLayout));
  return layoutExhibitSlotIds(previousLayout).filter((slotId) => !currentIds.has(slotId));
}

module.exports = {
  layoutExhibitSlotIds,
  publishedExhibitSlotIdsForVenue,
  restoreExhibitSlots,
  retireExhibitSlots,
  retireWorkingRemovedExhibitSlots,
  removedExhibitSlotIds,
};
