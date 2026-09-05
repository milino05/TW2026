const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const SemanticGraph = require("../models/semanticGraph.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
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
    if (!existing) {
      byKey.set(key, { ...pin, subjectIds: uniqueIds(pin.subjectIds || []) });
      continue;
    }
    const merged = {
      ...existing,
      subjectIds: uniqueIds([...(existing.subjectIds || []), ...(pin.subjectIds || [])]),
    };
    if (pin.sourceType === "editorial_release" && existing.sourceType !== "editorial_release") {
      merged.sourceType = "editorial_release";
      merged.sourceEditorialReleaseId = pin.sourceEditorialReleaseId;
      merged.editorialContextId = pin.editorialContextId;
    }
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

function contentPinKey(pin) {
  return `${id(pin.itemId)}:${id(pin.itemEditionId)}:${id(pin.itemRevisionId)}`;
}

function deduplicateContentPins(pins = []) {
  const byKey = new Map();
  for (const pin of pins) {
    const key = contentPinKey(pin);
    if (!key.replaceAll(":", "")) continue;
    if (!byKey.has(key)) byKey.set(key, pin);
  }
  return [...byKey.values()];
}

async function subjectIdsByGraphRevision(graphRevisionIds = []) {
  const ids = uniqueIds(graphRevisionIds);
  const result = new Map(ids.map((graphRevisionId) => [graphRevisionId, new Set()]));
  if (!ids.length) return result;
  const bindings = await GraphSubjectBinding.find({ graphRevisionId: { $in: ids } }).select("graphRevisionId subjectId").lean();
  for (const binding of bindings) result.get(id(binding.graphRevisionId))?.add(id(binding.subjectId));
  return result;
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
  const subjectsByRevision = await subjectIdsByGraphRevision(releases.map((release) => release.graphRevisionId));
  return ids.map((releaseId) => {
    const release = releaseById.get(releaseId);
    return {
      sourceType: "editorial_release",
      sourceEditorialReleaseId: release._id,
      editorialContextId: release.editorialContextId,
      graphRevisionId: release.graphRevisionId,
      namespaceRevisionId: release.namespaceRevisionId,
      subjectIds: [...(subjectsByRevision.get(id(release.graphRevisionId)) || new Set())],
    };
  });
}

async function directSemanticContext({ source, contentEntries }) {
  const principal = source?.principal;
  if (!principal?.type || !principal?.id) return { pins: [], contexts: [] };

  const directEntries = (contentEntries || []).filter((entry) => !(entry.sourceEditorialReleaseIds || []).length);
  if (!directEntries.length) return { pins: [], contexts: [] };

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
  if (!items.length || !editions.length) return { pins: [], contexts: [] };

  const ownedItemIds = new Set(items.map((item) => id(item._id)));
  const namespaceIdByItemId = new Map(
    editions
      .filter((edition) => ownedItemIds.has(id(edition.itemId)))
      .map((edition) => [id(edition.itemId), id(edition.namespaceId)]),
  );
  const memberships = await ContentSpaceItemMembership.find({ itemId: { $in: [...ownedItemIds] } }).lean();
  if (!memberships.length) return { pins: [], contexts: [] };

  const contentSpaceIds = uniqueIds(memberships.map((membership) => membership.contentSpaceId));
  const contentSpaces = await ContentSpace.find({
    _id: { $in: contentSpaceIds },
    ownerType: principal.type,
    ownerId: principal.id,
    lifecycleStatus: "active",
  }).select("_id").lean();
  const ownedSpaceIds = new Set(contentSpaces.map((space) => id(space._id)));
  if (!ownedSpaceIds.size) return { pins: [], contexts: [] };

  const applicablePairs = new Set();
  for (const membership of memberships) {
    const itemId = id(membership.itemId);
    const spaceId = id(membership.contentSpaceId);
    const namespaceId = namespaceIdByItemId.get(itemId);
    if (namespaceId && ownedSpaceIds.has(spaceId)) applicablePairs.add(`${spaceId}:${namespaceId}`);
  }
  if (!applicablePairs.size) return { pins: [], contexts: [] };

  const contexts = await EditorialContext.find({
    contentSpaceId: { $in: [...ownedSpaceIds] },
    lifecycleStatus: "active",
  }).lean();
  const applicableContexts = contexts.filter((context) =>
    applicablePairs.has(`${id(context.contentSpaceId)}:${id(context.namespaceId)}`));
  if (!applicableContexts.length) return { pins: [], contexts: [] };

  const [publishedReleases, semanticGraphs] = await Promise.all([
    EditorialRelease.find({ _id: { $in: uniqueIds(applicableContexts.map((context) => context.publishedReleaseId)) } }).lean(),
    SemanticGraph.find({ _id: { $in: uniqueIds(applicableContexts.map((context) => context.semanticGraphId)) }, lifecycleStatus: "active" }).lean(),
  ]);
  const releaseById = new Map(publishedReleases.map((release) => [id(release._id), release]));
  const graphById = new Map(semanticGraphs.map((graph) => [id(graph._id), graph]));

  const selectedGraphRevisionIds = uniqueIds(applicableContexts.map((context) => {
    const semanticGraph = graphById.get(id(context.semanticGraphId));
    return semanticGraph?.workingRevisionId || releaseById.get(id(context.publishedReleaseId))?.graphRevisionId || null;
  }));
  if (!selectedGraphRevisionIds.length) return { pins: [], contexts: [] };

  const [graphRevisions, subjectsByRevision] = await Promise.all([
    SemanticGraphRevision.find({ _id: { $in: selectedGraphRevisionIds } }).lean(),
    subjectIdsByGraphRevision(selectedGraphRevisionIds),
  ]);
  const graphRevisionById = new Map(graphRevisions.map((revision) => [id(revision._id), revision]));
  const pins = [];
  const resolvedContexts = [];
  for (const context of applicableContexts) {
    const semanticGraph = graphById.get(id(context.semanticGraphId));
    const release = releaseById.get(id(context.publishedReleaseId));
    const graphRevisionId = semanticGraph?.workingRevisionId || release?.graphRevisionId || null;
    const graphRevision = graphRevisionById.get(id(graphRevisionId));
    if (!graphRevision) continue;
    if (semanticGraph && id(graphRevision.semanticGraphId) !== id(semanticGraph._id)) continue;
    const subjectIds = [...(subjectsByRevision.get(id(graphRevision._id)) || new Set())];
    pins.push({
      sourceType: "direct_item",
      sourceEditorialReleaseId: null,
      editorialContextId: context._id,
      graphRevisionId: graphRevision._id,
      namespaceRevisionId: graphRevision.authoredAgainstNamespaceRevisionId,
      subjectIds,
    });
    resolvedContexts.push({
      context,
      semanticGraph,
      graphRevision,
      namespaceId: context.namespaceId,
      subjectIds: new Set(subjectIds),
    });
  }
  return { pins, contexts: resolvedContexts };
}

async function directSemanticContentPins({ source, contexts }) {
  const principal = source?.principal;
  if (!principal?.type || !principal?.id || !(contexts || []).length) return [];

  const graphRevisionIds = uniqueIds(contexts.map((entry) => entry.graphRevision._id));
  const [bindings, edges] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId: { $in: graphRevisionIds } }).select("graphRevisionId subjectId").lean(),
    SemanticEdgeV2.find({ graphRevisionId: { $in: graphRevisionIds } }).select("graphRevisionId sourceSubjectId targetSubjectId").lean(),
  ]);
  const subjectIdsByGraph = new Map(graphRevisionIds.map((graphRevisionId) => [graphRevisionId, new Set()]));
  for (const binding of bindings) subjectIdsByGraph.get(id(binding.graphRevisionId))?.add(id(binding.subjectId));
  for (const edge of edges) {
    subjectIdsByGraph.get(id(edge.graphRevisionId))?.add(id(edge.sourceSubjectId));
    subjectIdsByGraph.get(id(edge.graphRevisionId))?.add(id(edge.targetSubjectId));
  }
  const allSubjectIds = [...new Set([...subjectIdsByGraph.values()].flatMap((set) => [...set]))];
  if (!allSubjectIds.length) return [];

  const items = await ItemV2.find({
    ownerType: principal.type,
    ownerId: principal.id,
    lifecycleStatus: "active",
    primarySubjectId: { $in: allSubjectIds },
  }).select("_id primarySubjectId").lean();
  if (!items.length) return [];
  const itemById = new Map(items.map((item) => [id(item._id), item]));

  const namespaceIds = uniqueIds(contexts.map((entry) => entry.namespaceId));
  const editions = await ItemEdition.find({
    itemId: { $in: items.map((item) => item._id) },
    namespaceId: { $in: namespaceIds },
    publishedRevisionId: { $ne: null },
  }).select("_id itemId namespaceId publishedRevisionId").lean();
  if (!editions.length) return [];
  const publishedRevisionIds = uniqueIds(editions.map((edition) => edition.publishedRevisionId));
  const revisions = await ItemRevisionV2.find({
    _id: { $in: publishedRevisionIds },
    status: { $in: ["published", "superseded"] },
  }).select("_id itemEditionId authoredAgainstNamespaceRevisionId").lean();
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));

  const pins = [];
  for (const edition of editions) {
    const item = itemById.get(id(edition.itemId));
    const revision = revisionById.get(id(edition.publishedRevisionId));
    if (!item || !revision || id(revision.itemEditionId) !== id(edition._id)) continue;
    const relevantContext = contexts.find((entry) =>
      id(entry.namespaceId) === id(edition.namespaceId)
      && entry.subjectIds.has(id(item.primarySubjectId))
      && subjectIdsByGraph.get(id(entry.graphRevision._id))?.has(id(item.primarySubjectId)));
    if (!relevantContext) continue;
    pins.push({
      sourceType: "direct_item",
      itemId: item._id,
      itemEditionId: edition._id,
      itemRevisionId: revision._id,
      namespaceRevisionId: revision.authoredAgainstNamespaceRevisionId,
      subjectId: item.primarySubjectId,
    });
  }
  return deduplicateContentPins(pins);
}

async function resolveSessionSemanticScope({ source, contentEntries }) {
  const [releasePins, directContext] = await Promise.all([
    releaseSemanticPins(source?.sourceEditorialReleaseIds || []),
    directSemanticContext({ source, contentEntries }),
  ]);
  const semanticGraphPins = deduplicatePins([...releasePins, ...directContext.pins]);
  const semanticContentPins = await directSemanticContentPins({ source, contexts: directContext.contexts });
  return { semanticGraphPins, semanticContentPins };
}

module.exports = {
  resolveSessionSemanticScope,
};