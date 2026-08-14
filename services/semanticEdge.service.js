const mongoose = require("mongoose");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const AppError = require("../utils/AppError");

function normalizeEdgePayload(values) {
  if (!Array.isArray(values)) return values;
  return values.map((edge) => edge && typeof edge === "object" ? {
    relationTypeKey: String(edge.relationTypeKey || "").trim().toLowerCase(),
    targetItemId: edge.targetItemId || null,
    weight: edge.weight === undefined ? 1 : Number(edge.weight),
  } : edge);
}

async function getEdgesForRevision(sourceItemRevisionId) {
  if (!sourceItemRevisionId) return [];
  return SemanticEdge.find({ sourceItemRevisionId }).sort({ createdAt: 1, _id: 1 }).lean();
}

async function replaceEdgesForRevision({ museumId, sourceItemId, sourceItemRevisionId, edges = [] }) {
  const normalized = normalizeEdgePayload(edges) || [];
  await SemanticEdge.deleteMany({ sourceItemRevisionId });
  if (!normalized.length) return [];
  const docs = normalized.map((edge) => ({
    museumId,
    sourceItemId,
    sourceItemRevisionId,
    targetItemId: edge.targetItemId,
    relationTypeKey: edge.relationTypeKey,
    weight: edge.weight,
  }));
  await SemanticEdge.insertMany(docs, { ordered: true });
  return getEdgesForRevision(sourceItemRevisionId);
}

async function cloneEdgesForRevision({ fromRevisionId, toRevisionId, sourceItemId, museumId }) {
  const existing = await getEdgesForRevision(fromRevisionId);
  return replaceEdgesForRevision({
    museumId,
    sourceItemId,
    sourceItemRevisionId: toRevisionId,
    edges: existing.map((edge) => ({ relationTypeKey: edge.relationTypeKey, targetItemId: edge.targetItemId, weight: edge.weight })),
  });
}

async function deleteEdgesForRevision(sourceItemRevisionId) {
  if (!sourceItemRevisionId) return;
  await SemanticEdge.deleteMany({ sourceItemRevisionId });
}

async function deleteEdgesForItem(itemId) {
  await SemanticEdge.deleteMany({ $or: [{ sourceItemId: itemId }, { targetItemId: itemId }] });
}

async function getPublishedOutgoingEdges(item) {
  if (!item?.publishedRevisionId) return [];
  return getEdgesForRevision(item.publishedRevisionId);
}

async function getWorkingOutgoingEdges(item) {
  const revisionId = item?.workingRevisionId || item?.publishedRevisionId;
  return getEdgesForRevision(revisionId);
}

async function edgeDependencyExists(itemId) {
  return Boolean(await SemanticEdge.exists({ targetItemId: itemId }));
}

async function assertEdgeTargetsBelongToMuseum({ museumId, edges }) {
  const ids = [...new Set((edges || []).map((edge) => String(edge.targetItemId || "")).filter(Boolean))];
  if (!ids.length) return;
  if (ids.some((value) => !mongoose.isValidObjectId(value))) throw new AppError("SemanticEdge non valido", 400);
  const targets = await Item.find({ _id: { $in: ids }, museumId, lifecycleStatus: "active" }).select("_id").lean();
  if (targets.length !== ids.length) throw new AppError("Uno o piu target SemanticEdge non appartengono al museo", 400);
}

async function deleteEdgesForItemRevisions(itemId) {
  const revisions = await ItemRevision.find({ itemId }).select("_id").lean();
  await SemanticEdge.deleteMany({ sourceItemRevisionId: { $in: revisions.map((revision) => revision._id) } });
}

module.exports = {
  normalizeEdgePayload,
  getEdgesForRevision,
  replaceEdgesForRevision,
  cloneEdgesForRevision,
  deleteEdgesForRevision,
  deleteEdgesForItem,
  deleteEdgesForItemRevisions,
  getPublishedOutgoingEdges,
  getWorkingOutgoingEdges,
  edgeDependencyExists,
  assertEdgeTargetsBelongToMuseum,
};
