const SemanticEdge = require("../models/semanticEdge.model");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const AppError = require("../utils/AppError");

function plain(edge) { return edge?.toObject ? edge.toObject() : edge; }

async function assertRevisionOwnership({ museumId = null, sourceItemId, sourceItemRevisionId }) {
  const revision = await ItemRevision.findOne({ _id: sourceItemRevisionId, itemId: sourceItemId }).select("_id itemId").lean();
  if (!revision) throw new AppError("La revisione sorgente non appartiene all'Item indicato", 409);
  const item = await Item.findById(sourceItemId).select("_id museumId").lean();
  if (!item) throw new AppError("Item sorgente non trovato", 404);
  if (museumId && String(item.museumId) !== String(museumId)) throw new AppError("museumId non coincide con il museo dell'Item sorgente", 409);
  return { revision, item };
}

async function getRevisionSemanticEdges(sourceItemRevisionId) {
  if (!sourceItemRevisionId) return [];
  return SemanticEdge.find({ sourceItemRevisionId }).sort({ relationTypeKey: 1, targetItemId: 1 }).lean();
}

async function getRevisionSemanticEdgesMap(sourceItemRevisionIds = []) {
  const ids = [...new Set(sourceItemRevisionIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const edges = await SemanticEdge.find({ sourceItemRevisionId: { $in: ids } }).sort({ relationTypeKey: 1, targetItemId: 1 }).lean();
  const grouped = new Map(ids.map((revisionId) => [revisionId, []]));
  for (const edge of edges) {
    const key = String(edge.sourceItemRevisionId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(edge);
  }
  return grouped;
}

async function replaceRevisionSemanticEdges({ museumId, sourceItemId, sourceItemRevisionId, semanticEdges = [] }) {
  await assertRevisionOwnership({ museumId, sourceItemId, sourceItemRevisionId });
  const normalized = semanticEdges.map((edge) => ({
    museumId,
    sourceItemId,
    sourceItemRevisionId,
    targetItemId: edge.targetItemId,
    relationTypeKey: edge.relationTypeKey,
    weight: edge.weight === undefined ? 1 : Number(edge.weight),
  }));
  if (normalized.length) {
    await SemanticEdge.bulkWrite(normalized.map((edge) => ({ updateOne: { filter: { sourceItemRevisionId, relationTypeKey: edge.relationTypeKey, targetItemId: edge.targetItemId }, update: { $set: edge }, upsert: true } })), { ordered: true });
    const desired = normalized.map((edge) => ({ relationTypeKey: edge.relationTypeKey, targetItemId: edge.targetItemId }));
    await SemanticEdge.deleteMany({ sourceItemRevisionId, $nor: desired });
  } else {
    await SemanticEdge.deleteMany({ sourceItemRevisionId });
  }
  return getRevisionSemanticEdges(sourceItemRevisionId);
}

async function cloneRevisionSemanticEdges({ museumId, sourceItemId, fromRevisionId, toRevisionId }) {
  await assertRevisionOwnership({ museumId, sourceItemId, sourceItemRevisionId: toRevisionId });
  await assertRevisionOwnership({ museumId, sourceItemId, sourceItemRevisionId: fromRevisionId });
  const existing = await getRevisionSemanticEdges(fromRevisionId);
  if (!existing.length) return [];
  await SemanticEdge.insertMany(existing.map((edge) => ({ museumId, sourceItemId, sourceItemRevisionId: toRevisionId, targetItemId: edge.targetItemId, relationTypeKey: edge.relationTypeKey, weight: edge.weight })), { ordered: true });
  return getRevisionSemanticEdges(toRevisionId);
}

async function deleteRevisionSemanticEdges(sourceItemRevisionId) { const result = await SemanticEdge.deleteMany({ sourceItemRevisionId }); return result.deletedCount || 0; }
async function deleteSemanticEdgesForSourceItem(sourceItemId) { const result = await SemanticEdge.deleteMany({ sourceItemId }); return result.deletedCount || 0; }
async function semanticEdgeTargetDependency(targetItemId) { return SemanticEdge.exists({ targetItemId }); }
function edgeSnapshot(edge) { const value = plain(edge) || {}; return { relationTypeKey: value.relationTypeKey, targetItemId: value.targetItemId, weight: Number(value.weight) || 0 }; }

module.exports = {
  assertRevisionOwnership,
  getRevisionSemanticEdges,
  getRevisionSemanticEdgesMap,
  replaceRevisionSemanticEdges,
  cloneRevisionSemanticEdges,
  deleteRevisionSemanticEdges,
  deleteSemanticEdgesForSourceItem,
  semanticEdgeTargetDependency,
  edgeSnapshot,
};
