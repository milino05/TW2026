const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const ContentSpace = require("../models/contentSpace.model");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) {
  return [...new Map((values || []).map((value) => [id(value), value]).filter(([key]) => key)).values()];
}
function emptyUsage() {
  return {
    itemCount: 0,
    availableCount: 0,
    draftCount: 0,
    collectionCount: 0,
    venueCount: 0,
    lastActivityAt: null,
    previewMedia: null,
  };
}

async function projectOrganizationSubjectUsage({ organizationId, subjectIds = [] }) {
  const uniqueSubjectIds = uniqueIds(subjectIds);
  const result = new Map(uniqueSubjectIds.map((subjectId) => [id(subjectId), emptyUsage()]));
  if (!organizationId || !uniqueSubjectIds.length) return result;

  const items = await ItemV2.find({
    ownerType: "organization",
    ownerId: organizationId,
    lifecycleStatus: "active",
    primarySubjectId: { $in: uniqueSubjectIds },
  }).select("_id primarySubjectId recognitionMedia updatedAt").sort({ updatedAt: -1, _id: -1 }).lean();

  const itemToSubjectId = new Map();
  for (const item of items) {
    const subjectId = id(item.primarySubjectId);
    itemToSubjectId.set(id(item._id), subjectId);
    const usage = result.get(subjectId) || emptyUsage();
    usage.itemCount += 1;
    if (!usage.lastActivityAt && item.updatedAt) usage.lastActivityAt = item.updatedAt;
    if (!usage.previewMedia && item.recognitionMedia?.url) usage.previewMedia = item.recognitionMedia;
    result.set(subjectId, usage);
  }

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
  const flagsByItemId = new Map();
  for (const edition of editions) {
    const itemId = id(edition.itemId);
    const flags = flagsByItemId.get(itemId) || { available: false, draft: false };
    if (edition.publishedRevisionId && usablePublishedIds.has(id(edition.publishedRevisionId))) flags.available = true;
    if (edition.workingRevisionId && liveWorkingIds.has(id(edition.workingRevisionId))) flags.draft = true;
    flagsByItemId.set(itemId, flags);
  }
  for (const item of items) {
    const usage = result.get(id(item.primarySubjectId));
    const flags = flagsByItemId.get(id(item._id));
    if (!usage || !flags) continue;
    if (flags.available) usage.availableCount += 1;
    if (flags.draft) usage.draftCount += 1;
  }

  const memberships = await CollectionItemMembership.find({ itemId: { $in: items.map((item) => item._id) } })
    .select("itemId editorialContextId")
    .lean();
  const membershipContextIds = uniqueIds(memberships.map((entry) => entry.editorialContextId));
  const organizationSpaces = await ContentSpace.find({ ownerType: "organization", ownerId: organizationId, lifecycleStatus: "active" })
    .select("_id")
    .lean();
  const organizationSpaceIds = organizationSpaces.map((entry) => entry._id);
  const organizationContexts = membershipContextIds.length && organizationSpaceIds.length
    ? await EditorialContext.find({ _id: { $in: membershipContextIds }, contentSpaceId: { $in: organizationSpaceIds }, lifecycleStatus: "active" })
      .select("_id")
      .lean()
    : [];
  const organizationContextIds = new Set(organizationContexts.map((entry) => id(entry._id)));
  const collectionIdsBySubjectId = new Map();
  for (const membership of memberships) {
    if (!organizationContextIds.has(id(membership.editorialContextId))) continue;
    const subjectId = itemToSubjectId.get(id(membership.itemId));
    if (!subjectId) continue;
    const collectionIds = collectionIdsBySubjectId.get(subjectId) || new Set();
    collectionIds.add(id(membership.editorialContextId));
    collectionIdsBySubjectId.set(subjectId, collectionIds);
  }
  for (const [subjectId, collectionIds] of collectionIdsBySubjectId) {
    const usage = result.get(subjectId);
    if (usage) usage.collectionCount = collectionIds.size;
  }

  const venues = await Venue.find({ ownerOrganizationId: organizationId, lifecycleStatus: "active" }).select("_id").lean();
  const venueTargets = venues.length
    ? await VenueTarget.find({ venueId: { $in: venues.map((entry) => entry._id) }, subjectId: { $in: uniqueSubjectIds }, lifecycleStatus: "active" })
      .select("venueId subjectId")
      .lean()
    : [];
  const venueIdsBySubjectId = new Map();
  for (const target of venueTargets) {
    const subjectId = id(target.subjectId);
    const venueIds = venueIdsBySubjectId.get(subjectId) || new Set();
    venueIds.add(id(target.venueId));
    venueIdsBySubjectId.set(subjectId, venueIds);
  }
  for (const [subjectId, venueIds] of venueIdsBySubjectId) {
    const usage = result.get(subjectId);
    if (usage) usage.venueCount = venueIds.size;
  }

  return result;
}

module.exports = { emptyUsage, projectOrganizationSubjectUsage };
