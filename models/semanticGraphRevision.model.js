const mongoose = require("mongoose");
const { Schema } = mongoose;

const SemanticGraphRevisionSchema = new Schema({
  semanticGraphId: { type: Schema.Types.ObjectId, ref: "SemanticGraph", required: true, index: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", default: null, immutable: true },
  authoredAgainstNamespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true, index: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "semantic_graph_revisions_v2" });

SemanticGraphRevisionSchema.index({ semanticGraphId: 1, version: 1 }, { unique: true });
SemanticGraphRevisionSchema.index({ semanticGraphId: 1, createdAt: -1 });

module.exports = mongoose.model("SemanticGraphRevision", SemanticGraphRevisionSchema);
