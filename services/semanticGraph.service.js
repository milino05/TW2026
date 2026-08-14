const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const {
  relationStrength,
  edgeTraversalWeight,
  materializeDirectEdge,
  materializeReverseEdge,
} = require("./relationSemantics.service");

const MAX_CACHE_ENTRIES = 12;
const graphCache = new Map();

function id(value) { return String(value?._id || value || ""); }
function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function semanticRefKey(ref) { return `${normalizeKey(ref?.scheme)}::${String(ref?.id || ref?.refId || "").trim()}`; }
function featureKey(feature = {}) {
  if (feature.kind === "item") return `item:${id(feature.itemId)}`;
  if (feature.kind === "canonical") return `canonical:${semanticRefKey(feature)}`;
  return `${feature.kind || "unknown"}:${normalizeKey(feature.key)}`;
}
function edgeWeight(edge, type) { return edgeTraversalWeight(edge, type); }
function cacheKey(museumId, view) { return `${id(museumId)}::${view}`; }

function touchCache(key, value) {
  graphCache.delete(key);
  graphCache.set(key, value);
  while (graphCache.size > MAX_CACHE_ENTRIES) graphCache.delete(graphCache.keys().next().value);
}

function invalidateMuseumSemanticGraphCache(museumId, { view = null } = {}) {
  const prefix = `${id(museumId)}::`;
  for (const key of [...graphCache.keys()]) {
    if (key.startsWith(prefix) && (!view || key === cacheKey(museumId, view))) graphCache.delete(key);
  }
}

function selectedRevisionId(item, view) {
  if (view === "working") return item.workingRevisionId || item.publishedRevisionId || null;
  return item.publishedRevisionId || null;
}

function buildSignature({ vocabulary, items, view }) {
  const pointers = items
    .map((item) => `${id(item._id)}:${id(selectedRevisionId(item, view))}`)
    .sort()
    .join("|");
  return `${id(vocabulary.vocabularyRevisionId)}::${view}::${pointers}`;
}

async function loadMuseumSemanticGraph(museumId, { view = "published", bypassCache = false } = {}) {
  if (!["published", "working"].includes(view)) throw new TypeError("view deve essere published o working");
  const [vocabulary, items] = await Promise.all([
    getMuseumVocabulary(museumId),
    Item.find({ museumId, lifecycleStatus: "active", $or: [{ publishedRevisionId: { $ne: null } }, { workingRevisionId: { $ne: null } }] }).lean(),
  ]);
  const signature = buildSignature({ vocabulary, items, view });
  const key = cacheKey(museumId, view);
  const cached = graphCache.get(key);
  if (!bypassCache && cached?.signature === signature) {
    touchCache(key, cached);
    return cached.graph;
  }

  const revisionIds = items.map((item) => selectedRevisionId(item, view)).filter(Boolean);
  const revisionQuery = { _id: { $in: revisionIds } };
  if (view === "published") Object.assign(revisionQuery, { status: "published", "integrity.status": "valid" });
  const [revisions, persistedEdges] = await Promise.all([
    ItemRevision.find(revisionQuery).lean(),
    SemanticEdge.find({ museumId, sourceItemRevisionId: { $in: revisionIds } }).lean(),
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemTypeByKey = new Map((vocabulary.itemTypeDefinitions || []).map((entry) => [entry.key, entry]));
  const relationTypeByKey = new Map((vocabulary.relationTypes || []).map((entry) => [entry.key, entry]));
  const nodes = new Map();
  const canonicalIndex = new Map();
  const edgesFrom = new Map();
  const edgesTo = new Map();

  function addCanonical(ref, itemId) {
    if (!ref?.scheme || !(ref.id || ref.refId)) return;
    const canonicalKey = semanticRefKey(ref);
    if (!canonicalIndex.has(canonicalKey)) canonicalIndex.set(canonicalKey, new Set());
    canonicalIndex.get(canonicalKey).add(id(itemId));
  }
  function addEdge(edge) {
    const from = id(edge.fromItemId), to = id(edge.toItemId);
    if (!edgesFrom.has(from)) edgesFrom.set(from, []);
    if (!edgesTo.has(to)) edgesTo.set(to, []);
    edgesFrom.get(from).push(edge);
    edgesTo.get(to).push(edge);
  }

  for (const item of items) {
    const revisionId = selectedRevisionId(item, view);
    const revision = revisionById.get(id(revisionId));
    if (!revision) continue;
    const node = { item, revision, itemType: itemTypeByKey.get(item.itemType) || null };
    nodes.set(id(item._id), node);
    for (const ref of revision.semanticRefs || []) addCanonical(ref, item._id);
    for (const ref of node.itemType?.semanticRefs || []) addCanonical(ref, item._id);
  }

  const authoritativeEdges = [];
  for (const persisted of persistedEdges) {
    const sourceId = id(persisted.sourceItemId), targetId = id(persisted.targetItemId);
    const sourceNode = nodes.get(sourceId);
    if (!sourceNode || id(sourceNode.revision._id) !== id(persisted.sourceItemRevisionId) || !nodes.has(targetId)) continue;
    const type = relationTypeByKey.get(persisted.relationTypeKey);
    if (!type) continue;
    authoritativeEdges.push(persisted);
    addEdge(materializeDirectEdge(persisted, type));
    addEdge(materializeReverseEdge(persisted, type));
  }

  const graph = {
    museumId,
    view,
    signature,
    vocabulary,
    nodes,
    canonicalIndex,
    edgesFrom,
    edgesTo,
    authoritativeEdges,
    relationTypeByKey,
  };
  touchCache(key, { signature, graph });
  return graph;
}

function resolveFeatureToItemIds(graph, feature = {}) {
  if (!graph || !feature?.kind) return [];
  if (feature.kind === "item") return graph.nodes.has(id(feature.itemId)) ? [id(feature.itemId)] : [];
  if (feature.kind === "canonical") return [...(graph.canonicalIndex.get(semanticRefKey(feature)) || [])];
  const result = [];
  for (const [itemId, node] of graph.nodes) {
    if (feature.kind === "item_type" && node.item.itemType === normalizeKey(feature.key)) result.push(itemId);
    else if (feature.kind === "tag" && (node.revision.tags || []).some((tag) => normalizeKey(tag) === normalizeKey(feature.key))) result.push(itemId);
    else if (feature.kind === "relation_type" && (graph.edgesFrom.get(itemId) || []).some((edge) => edge.viewKey === normalizeKey(feature.key) || edge.baseRelationTypeKey === normalizeKey(feature.key))) result.push(itemId);
    else if (feature.kind === "selection_signal" && (node.revision.selectionSignals || []).some((signal) => signal.key === normalizeKey(feature.key))) result.push(itemId);
  }
  return result;
}

function neighbors(graph, itemId, { relationTypeKey = null } = {}) {
  const key = relationTypeKey ? normalizeKey(relationTypeKey) : null;
  return (graph?.edgesFrom.get(id(itemId)) || []).filter((edge) => !key || edge.viewKey === key || edge.baseRelationTypeKey === key);
}
function outgoingEdges(graph, itemId) { return neighbors(graph, itemId).filter((edge) => !edge.generated); }
function incomingEdges(graph, itemId) { return neighbors(graph, itemId).filter((edge) => edge.generated); }

function shortestSemanticPath(graph, { from, to, relationTypeKey = null, maxDepth = 3 } = {}) {
  const starts = resolveFeatureToItemIds(graph, from);
  const goals = new Set(resolveFeatureToItemIds(graph, to));
  if (!starts.length || !goals.size) return null;
  for (const start of starts) if (goals.has(start)) return { itemIds: [start], edges: [], depth: 0, strength: 1 };
  const queue = starts.map((start) => ({ itemId: start, itemIds: [start], edges: [], strength: 1 }));
  const bestDepth = new Map(starts.map((start) => [start, 0]));
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= Math.max(1, Math.min(6, Number(maxDepth) || 3))) continue;
    for (const edge of neighbors(graph, current.itemId, { relationTypeKey })) {
      const nextId = id(edge.toItemId), depth = current.edges.length + 1;
      const next = { itemId: nextId, itemIds: [...current.itemIds, nextId], edges: [...current.edges, edge], strength: current.strength * Math.max(0.05, edge.traversalWeight || 0.05) };
      if (goals.has(nextId)) return { itemIds: next.itemIds, edges: next.edges, depth, strength: next.strength };
      if ((bestDepth.get(nextId) ?? Infinity) <= depth) continue;
      bestDepth.set(nextId, depth);
      queue.push(next);
    }
  }
  return null;
}

function featureMatchesNode(graph, feature, node) {
  if (!node) return false;
  return resolveFeatureToItemIds(graph, feature).includes(id(node.item._id));
}

module.exports = {
  id,
  semanticRefKey,
  featureKey,
  relationStrength,
  edgeWeight,
  loadMuseumSemanticGraph,
  invalidateMuseumSemanticGraphCache,
  resolveFeatureToItemIds,
  neighbors,
  outgoingEdges,
  incomingEdges,
  shortestSemanticPath,
  featureMatchesNode,
};
