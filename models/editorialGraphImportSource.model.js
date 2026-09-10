const mongoose = require("mongoose");
const { Schema } = mongoose;

const EditorialGraphImportSourceSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, index: true, immutable: true },
  targetSemanticGraphId: { type: Schema.Types.ObjectId, ref: "SemanticGraph", required: true, index: true, immutable: true },
  sourceSemanticGraphId: { type: Schema.Types.ObjectId, ref: "SemanticGraph", required: true, index: true, immutable: true },
  sourceGraphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true, index: true, immutable: true },
  suppressedEdgeKeys: { type: [String], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "editorial_graph_import_sources" });

EditorialGraphImportSourceSchema.index(
  { editorialContextId: 1, sourceGraphRevisionId: 1 },
  { unique: true },
);
EditorialGraphImportSourceSchema.index({ targetSemanticGraphId: 1, createdAt: -1 });

module.exports = mongoose.model("EditorialGraphImportSource", EditorialGraphImportSourceSchema);
