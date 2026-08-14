const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const { getMuseumVocabulary } = require("./museumVocabulary.service");

function id(value) { return String(value?._id || value || ""); }
function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function semanticRefKey(ref) { return `${normalizeKey(ref?.scheme)}::${String(ref?.id || ref?.refId || "").trim()}`; }
function featureKey(feature = {}) {
  if (feature.kind === "item") return `item:${id(feature.itemId)}`;
  if (feature.kind === "canonical") return `canonical:${semanticRefKey(feature)}`;
  return `${feature.kind || "unknown"}:${normalizeKey(feature.key)}`;
}
function relationStrength(strength) { return strength === "strong" ? 1 : strength === "weak" ? 0.4 : 0.7; }
function edgeWeight(relation, type) { return relationStrength(type?.strength) * Math.max(0, Math.min(1, (Number(relation?.weight) || 0) / 10)); }

async function loadMuseumSemanticGraph(museumId) {
  const [vocabulary, items] = await Promise.all([
    getMuseumVocabulary(museumId),
    Item.find({ museumId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
  ]);
  const revisionIds = items.map((item) => item.publishedRevisionId).filter(Boolean);
  const revisions = await ItemRevision.find({ _id: { $in: revisionIds }, status: "published", "integrity.status": "valid" }).lean();
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));
  const itemTypeByKey = new Map((vocabulary.itemTypeDefinitions || []).map((entry) => [entry.key, entry]));
  const relationTypeByKey = new Map((vocabulary.relationTypes || []).map((entry) => [entry.key, entry]));
  const nodes = new Map();
  const canonicalIndex = new Map();
  const edgesFrom = new Map();
  const edgesTo = new Map();

  function addCanonical(ref, itemId) {
    if (!ref?.scheme || !(ref.id || ref.refId)) return;
    const key = semanticRefKey(ref);
    if (!canonicalIndex.has(key)) canonicalIndex.set(key, new Set());
    canonicalIndex.get(key).add(id(itemId));
  }
  function addEdge(edge) {
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

  for (const [sourceId, node] of nodes) {
    for (const relation of node.revision.relations || []) {
      const targetId = id(relation.target);
      if (!nodes.has(targetId)) continue;
      const type = relationTypeByKey.get(relation.relationTypeKey);
      if (!type) continue;
      const direct = {
        relationId: relation._id,
        fromItemId: sourceId,
        toItemId: targetId,
        baseRelationTypeKey: type.key,
        viewKey: type.key,
        direction: type.directionality === "symmetric" ? "symmetric" : "direct",
        generated: false,
        strength: type.strength,
        relationWeight: Number(relation.weight) || 0,
        traversalWeight: edgeWeight(relation, type),
        semanticRefs: type.semanticRefs || [],
      };
      addEdge(direct);
      addEdge({
        ...direct,
        fromItemId: targetId,
        toItemId: sourceId,
        viewKey: type.directionality === "symmetric" ? type.key : `${type.key}:reverse`,
        direction: type.directionality === "symmetric" ? "symmetric" : "reverse",
        generated: true,
      });
    }
  }

  return { museumId, vocabulary, nodes, canonicalIndex, edgesFrom, edgesTo, relationTypeByKey };
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

module.exports = { id, semanticRefKey, featureKey, relationStrength, edgeWeight, loadMuseumSemanticGraph, resolveFeatureToItemIds, neighbors, shortestSemanticPath, featureMatchesNode };
