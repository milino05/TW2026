const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Arco persistente e autorevole del knowledge graph ArtAround.
 * La relazione appartiene semanticamente alla revisione sorgente indicata da
 * sourceItemRevisionId: il publishedRevisionId/workingRevisionId dell'Item
 * seleziona quindi in modo atomico sia il payload del nodo sia il suo set di
 * outgoing edge.
 */
const SemanticEdgeSchema = new Schema(
  {
    museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
    sourceItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    sourceItemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", required: true, index: true },
    targetItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    relationTypeKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    weight: { type: Number, min: 0, max: 10, default: 1 },
  },
  { timestamps: true },
);

SemanticEdgeSchema.index(
  { sourceItemRevisionId: 1, relationTypeKey: 1, targetItemId: 1 },
  { unique: true },
);
SemanticEdgeSchema.index({ museumId: 1, sourceItemRevisionId: 1 });
SemanticEdgeSchema.index({ museumId: 1, targetItemId: 1 });
SemanticEdgeSchema.index({ museumId: 1, relationTypeKey: 1 });
SemanticEdgeSchema.index({ sourceItemId: 1, sourceItemRevisionId: 1 });

module.exports = mongoose.model("SemanticEdge", SemanticEdgeSchema);
