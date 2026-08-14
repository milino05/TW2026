const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Persisted directed edge of the ArtAround semantic graph.
 * The edge set belonging to an ItemRevision is selected atomically through
 * Item.publishedRevisionId / workingRevisionId; inverse and symmetric views
 * are derived by RelationSemantics and are never duplicated in storage.
 */
const SemanticEdgeSchema = new Schema({
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
  sourceItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  sourceItemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", required: true, index: true },
  targetItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  relationTypeKey: { type: String, required: true, trim: true, lowercase: true, index: true },
  weight: { type: Number, min: 0, max: 10, default: 1 },
}, { timestamps: true });

SemanticEdgeSchema.index({ sourceItemRevisionId: 1, targetItemId: 1, relationTypeKey: 1 }, { unique: true });
SemanticEdgeSchema.index({ museumId: 1, sourceItemRevisionId: 1 });
SemanticEdgeSchema.index({ museumId: 1, targetItemId: 1 });
SemanticEdgeSchema.index({ museumId: 1, relationTypeKey: 1 });

module.exports = mongoose.model("SemanticEdge", SemanticEdgeSchema);
