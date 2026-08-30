const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemV2 = require("../models/itemV2.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }

function pinKey(pin) {
  return `${id(pin.graphRevisionId)}:${id(pin.namespaceRevisionId)}`;
}

function deduplicatePins(pins = []) {
  const byKey = new Map();
  for (const pin of pins) {
    const key = pinKey(pin);
    if (!key.replace(":", "")) continue;
    const existing = byKey.get(key);
    if (!existing || pin.sourceType === "editorial_release") byKey.set(key, pin);
  }
  return [...byKey.values()];
}

async function releaseSemanticPins(releaseIds = []) {
  const ids = uniqueIds(releaseIds);
  if (!ids.length) return [];
  const releases = await EditorialRelease.find({ _id: { $in: ids } }).lean();
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));
  for (const releaseId of ids) {
    if (!releaseById.has(releaseId)) {
      throw new AppError("EditorialRelease pinzata dalla Session non disponibile", 409, [{ code: "SESSION_EDITORIAL_SCOPE_UNAVAILABLE" }]);
    }
  }
  return ids.map((releaseId) => {
    const release = releaseById.get(releaseId);
    return {
      sourceType: "editorial_release",
      sourceEditorialReleaseId: release._id,
      editorialContextId: release.editorialContextId,
      graphRevisionId: release.graphRevisionId,
      namespaceRevisionId: release.namespaceRevisionId,
    };
  });
}

async function directSemanticPins({ source, contentEntries }) {
  const principal = source?.principal;
  if (!principal?.type || !principal?.id) return [];

  const directEntries = (contentEntries || []).filter((entry) => !(entry.sourceEditorialReleaseIds || []).length);
  if (!directEntries.length) return [];

  const itemIds = uniqueIds(directEntries.map((entry) => entry.itemId));
  const editionIds = uniqueIds(directEntries.map((entry) => entry.itemEditionId));
  const [items, editions] = await Promise.all([
    ItemV2.find({
      _id: { $in: itemIds },
      ownerType: principal.type,
      ownerId: principal.id,
      lifecycleStatus: "active",
    }).select("_id primarySubjectId").lean(),
    ItemEdition.find({ _id: { $in: editionIds } }).select("_id itemId namespaceId").lean(),
  ]);
  if (!items.length || !editions.length) return [];

  const ownedItemIds = new Set(items.map((item) => id(item._id)));
  const namespaceIdByItemId = new Map(
    editions
      .filter((edition) => ownedItemIds.has(id(edition.itemId)))
      .map((edition) => [id(edition.itemId), id(edition.namespaceId)]),
  );
  const memberships = await ContentSpaceMembership.find({ itemId: { $in: [...ownedItemIds] } }).lean();
  if (!memberships.length) return [];

  const contentSpaceIds = uniqueIds(memberships.map((membership) => membership.contentSpaceId));
  const contentSpaces = await ContentSpace.find({
    _id: { $in: contentSpaceIds },
    ownerType: principal.type,
    ownerId: principal.id,
    lifecycleStatus: "active",
  }).select("_id").lean();
  const ownedSpaceIds = new Set(contentSpaces.map((space) => id(space._id)));
  if (!ownedSpaceIds.size) return [];

  const applicablePairs = new Set();
  for (const membership of memberships) {
    const itemId = id(membership.itemId);
    const spaceId = id(membership.contentSpaceId);
    const namespaceId = namespaceIdByItemId.get(itemId);
    if (namespaceId && ownedSpaceIds.has(spaceId)) applicablePairs.add(`${spaceId}:${namespaceId}`);
  }
  if (!applicablePairs.size) return [];

  const contexts = await EditorialContext.find({
    contentSpaceId: { $in: [...ownedSpaceIds] },
    lifecycleStatus: "active",
  }).lean();
  const applicableContexts = contexts.filter((context) =>
    applicablePairs.has(`${id(context.contentSpaceId)}:${id(context.namespaceId)}`));
  if (!applicableContexts.length) return [];

  const publishedReleaseIds = uniqueIds(applicableContexts.map((context) => context.publishedReleaseId));
  const publishedReleases = publishedReleaseIds.length
    ? await EditorialRelease.find({ _id: { $in: publishedReleaseIds } }).lean()
    : [];
  const releaseById = new Map(publishedReleases.map((release) => [id(release._id), release]));

  const selectedGraphIds = uniqueIds(applicableContexts.map((context) => {
    if (context.workingGraphRevisionId) return context.workingGraphRevisionId;
    return releaseById.get(id(context.publishedReleaseId))?.graphRevisionId || null;
  }));
  if (!selectedGraphIds.length) return [];

  const graphRevisions = await SemanticGraphRevision.find({ _id: { $in: selectedGraphIds } }).lean();
  const graphById = new Map(graphRevisions.map((graph) => [id(graph._id), graph]));
  const pins = [];
  for (const context of applicableContexts) {
    const release = releaseById.get(id(context.publishedReleaseId));
    const graphRevisionId = context.workingGraphRevisionId || release?.graphRevisionId || null;
    const graphRevision = graphById.get(id(graphRevisionId));
    if (!graphRevision) continue;
    pins.push({
      sourceType: "direct_item",
      sourceEditorialReleaseId: null,
      editorialContextId: context._id,
      graphRevisionId: graphRevision._id,
      namespaceRevisionId: graphRevision.authoredAgainstNamespaceRevisionId,
    });
  }
  return pins;
}

async function resolveSessionSemanticGraphPins({ source, contentEntries }) {
  const [releasePins, directPins] = await Promise.all([
    releaseSemanticPins(source?.sourceEditorialReleaseIds || []),
    directSemanticPins({ source, contentEntries }),
  ]);
  return deduplicatePins([...releasePins, ...directPins]);
}

module.exports = {
  resolveSessionSemanticGraphPins,
};
