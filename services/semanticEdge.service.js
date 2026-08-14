const SemanticEdge = require("../models/semanticEdge.model");
const ItemRevision = require("../models/itemRevision.model");
const AppError = require("../utils/AppError");

function plain(edge) {
  return edge?.toObject ? edge.toObject() : edge;
}

async function assertRevisionOwnership({ sourceItemId, sourceItemRevisionId }) {
  const revision = await ItemRevision.findOne({ _id: sourceItemRevisionId, itemId: sourceItemId }).select("_id itemId").lean();
  if (!revision) throw new AppError("La revisione sorgente non appartiene all'Item indicato", 409);
  return revision;
}

async function getRevisionSemanticEdges(sourceItemRevisionId) {
  if (!sourceItemRevisionId) return [];
  return SemanticEdge.find({ sourceItemRevisionId }).sort({ relationTypeKey: 1, targetItemId: 1 }).lean();
}

async function replaceRevisionSemanticEdges({ museumId, sourceItemId, sourceItemRevisionId, semanticEdges = [] }) {
  await assertRevisionOwnership({ sourceItemId, sourceItemRevisionId });
  const normalized = semanticEdges.map((edge) => ({
    museumId,
    sourceItemId,
    sourceItemRevisionId,
    targetItemId: edge.targetItemId,
    relationTypeKey: edge.relationTypeKey,
    weight: edge.weight === undefined ? 1 : Number(edge.weight),
  }));

  if (normalized.length) {
    await SemanticEdge.bulkWrite(normalized.map((edge) => ({
      updateOne: {
        filter: {
          sourceItemRevisionId,
          relationTypeKey: edge.relationTypeKey,
          targetItemId: edge.targetItemId,
        },
        update: { $set: edge },
        upsert: true,
      },
    })), { ordered: true });

    const desired = normalized.map((edge) => ({
      relationTypeKey: edge.relationTypeKey,
      targetItemId: edge.targetItemId,
    }));
    await SemanticEdge.deleteMany({ sourceItemRevisionId, $nor: desired });
  } else {
    await SemanticEdge.deleteMany({ sourceItemRevisionId });
  }

  return getRevisionSemanticEdges(sourceItemRevisionId);
}

async function cloneRevisionSemanticEdges({ museumId, sourceItemId, fromRevisionId, toRevisionId }) {
  await assertRevisionOwnership({ sourceItemId, sourceItemRevisionId: toRevisionId });
  const existing = await getRevisionSemanticEdges(fromRevisionId);
  if (!existing.length) return [];
  await SemanticEdge.insertMany(existing.map((edge) => ({
    museumId,
    sourceItemId,
    sourceItemRevisionId: toRevisionId,
    targetItemId: edge.targetItemId,
    relationTypeKey: edge.relationTypeKey,
    weight: edge.weight,
  })), { ordered: true });
  return getRevisionSemanticEdges(toRevisionId);
}

async function deleteRevisionSemanticEdges(sourceItemRevisionId) {
  const result = await SemanticEdge.deleteMany({ sourceItemRevisionId });
  return result.deletedCount || 0;
}

async function deleteSemanticEdgesForSourceItem(sourceItemId) {
  const result = await SemanticEdge.deleteMany({ sourceItemId });
  return result.deletedCount || 0;
}

async function semanticEdgeTargetDependency(targetItemId) {
  return SemanticEdge.exists({ targetItemId });
}

function edgeSnapshot(edge) {
  const value = plain(edge) || {};
  return {
    relationTypeKey: value.relationTypeKey,
    targetItemId: value.targetItemId,
    weight: Number(value.weight) || 0,
  };
}

module.exports = {
  assertRevisionOwnership,
  getRevisionSemanticEdges,
  replaceRevisionSemanticEdges,
  cloneRevisionSemanticEdges,
  deleteRevisionSemanticEdges,
  deleteSemanticEdgesForSourceItem,
  semanticEdgeTargetDependency,
  edgeSnapshot,
};
