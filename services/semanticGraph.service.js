const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { relationView } = require("./relationSemantics.service");

function id(value) { return String(value?._id || value || ""); }
function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function semanticRefKey(ref) { return `${normalizeKey(ref?.scheme)}::${String(ref?.id || ref?.refId || "").trim()}`; }
function featureKey(feature = {}) {
  if (feature.kind === "item") return `item:${id(feature.itemId)}`;
  if (feature.kind === "canonical") return `canonical:${semanticRefKey(feature)}`;
  return `${feature.kind || "unknown"}:${normalizeKey(feature.key)}`;
}
function relationStrength(strength) { return strength === "strong" ? 1 : strength === "weak" ? 0.4 : 0.7; }
function edgeWeight(edge, type) { return relationStrength(type?.strength) * Math.max(0, Math.min(1, (Number(edge?.weight) || 0) / 10)); }

const graphCache = new Map();
const MAX_CACHED_MUSEUMS = 12;
function cacheSignature(vocabulary, items) {
  return `${id(vocabulary.vocabularyRevisionId)}::${items.map((item) => `${id(item._id)}:${id(item.publishedRevisionId)}`).sort().join("|")}`;
}
function rememberGraph(key, signature, graph) {
  graphCache.delete(key);
  graphCache.set(key, { signature, graph });
  while (graphCache.size > MAX_CACHED_MUSEUMS) graphCache.delete(graphCache.keys().next().value);
}
function clearMuseumSemanticGraphCache(museumId = null) {
  if (museumId == null) graphCache.clear(); else graphCache.delete(id(museumId));
}

async function loadMuseumSemanticGraph(museumId, { bypassCache = false } = {}) {
  const [vocabulary, items] = await Promise.all([
    getMuseumVocabulary(museumId),
    Item.find({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
  ]);
  const signature = cacheSignature(vocabulary, items), cacheKey = id(museumId), cached = graphCache.get(cacheKey);
  if (!bypassCache && cached?.signature === signature) return cached.graph;

  const revisionIds = items.map((item) => item.publishedRevisionId).filter(Boolean);
  const [revisions, persistedEdges] = await Promise.all([
    ItemRevision.find({ _id: { $in: revisionIds }, status: "published", "integrity.status": "valid" }).lean(),
    SemanticEdge.find({ museumId, sourceItemRevisionId: { $in: revisionIds } }).lean(),
  ]);
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemTypeByKey = new Map((vocabulary.itemTypeDefinitions || []).map((entry) => [entry.key, entry]));
  const relationTypeByKey = new Map((vocabulary.relationTypes || []).map((entry) => [entry.key, entry]));
  const nodes = new Map(), canonicalIndex = new Map(), edgesFrom = new Map(), edgesTo = new Map();

  function addCanonical(ref, itemId) {
    if (!ref?.scheme || !(ref.id || ref.refId)) return;
    const key = semanticRefKey(ref);
    if (!canonicalIndex.has(key)) canonicalIndex.set(key, new Set());
    canonicalIndex.get(key).add(id(itemId));
  }
  function addTraversalEdge(edge) {
    const from = id(edge.fromItemId), to = id(edge.toItemId);
    if (!edgesFrom.has(from)) edgesFrom.set(from, []);
    if (!edgesTo.has(to)) edgesTo.set(to, []);
    edgesFrom.get(from).push(edge);
    edgesTo.get(to).push(edge);
  }

  for (const item of items) {
    const revision = revisionById.get(id(item.publishedRevisionId));
    if (!revision) continue;
    const node = { item, revision, itemType: itemTypeByKey.get(item.itemType) || null };
    nodes.set(id(item._id), node);
    for (const ref of revision.semanticRefs || []) addCanonical(ref, item._id);
    for (const ref of node.itemType?.semanticRefs || []) addCanonical(ref, item._id);
  }

  for (const persisted of persistedEdges) {
    const sourceId = id(persisted.sourceItemId), targetId = id(persisted.targetItemId);
    if (!nodes.has(sourceId) || !nodes.has(targetId)) continue;
    const type = relationTypeByKey.get(persisted.relationTypeKey);
    if (!type) continue;
    const directSemantics = relationView(type, "direct");
    const direct = {
      relationId: persisted._id,
      fromItemId: sourceId,
      toItemId: targetId,
      baseRelationTypeKey: type.key,
      viewKey: directSemantics.viewKey,
      direction: directSemantics.direction,
      generated: false,
      strength: type.strength,
      relationWeight: Number(persisted.weight) || 0,
      traversalWeight: edgeWeight(persisted, type),
      semanticRefs: type.semanticRefs || [],
    };
    addTraversalEdge(direct);
    const reverseSemantics = relationView(type, "reverse");
    addTraversalEdge({ ...direct, fromItemId: targetId, toItemId: sourceId, viewKey: reverseSemantics.viewKey, direction: reverseSemantics.direction, generated: true });
  }

  const graph = { museumId, vocabulary, nodes, canonicalIndex, edgesFrom, edgesTo, relationTypeByKey, revisionIds };
  rememberGraph(cacheKey, signature, graph);
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
function neighbors(graph, itemId, { relationTypeKey = null } = {}) { const key = relationTypeKey ? normalizeKey(relationTypeKey) : null; return (graph?.edgesFrom.get(id(itemId)) || []).filter((edge) => !key || edge.viewKey === key || edge.baseRelationTypeKey === key); }
function shortestSemanticPath(graph, { from, to, relationTypeKey = null, maxDepth = 3 } = {}) {
  const starts = resolveFeatureToItemIds(graph, from), goals = new Set(resolveFeatureToItemIds(graph, to));
  if (!starts.length || !goals.size) return null;
  for (const start of starts) if (goals.has(start)) return { itemIds: [start], edges: [], depth: 0, strength: 1 };
  const queue = starts.map((start) => ({ itemId: start, itemIds: [start], edges: [], strength: 1 })), bestDepth = new Map(starts.map((start) => [start, 0]));
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= Math.max(1, Math.min(6, Number(maxDepth) || 3))) continue;
    for (const edge of neighbors(graph, current.itemId, { relationTypeKey })) {
      const nextId = id(edge.toItemId), depth = current.edges.length + 1, next = { itemId: nextId, itemIds: [...current.itemIds, nextId], edges: [...current.edges, edge], strength: current.strength * Math.max(0.05, edge.traversalWeight || 0.05) };
      if (goals.has(nextId)) return { itemIds: next.itemIds, edges: next.edges, depth, strength: next.strength };
      if ((bestDepth.get(nextId) ?? Infinity) <= depth) continue;
      bestDepth.set(nextId, depth); queue.push(next);
    }
  }
  return null;
}
function featureMatchesNode(graph, feature, node) { return Boolean(node && resolveFeatureToItemIds(graph, feature).includes(id(node.item._id))); }

module.exports = { id, semanticRefKey, featureKey, relationStrength, edgeWeight, loadMuseumSemanticGraph, clearMuseumSemanticGraphCache, resolveFeatureToItemIds, neighbors, shortestSemanticPath, featureMatchesNode };
