const mongoose = require("mongoose");
const { Schema } = mongoose;

const EditorialGraphEdgeSuppressionSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, index: true, immutable: true },
  targetSemanticGraphId: { type: Schema.Types.ObjectId, ref: "SemanticGraph", required: true, index: true, immutable: true },
  edgeKey: { type: String, required: true, trim: true, immutable: true },
  sourceSubjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true },
  targetSubjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, immutable: true },
  relationTypeDefinitionId: { type: String, required: true, trim: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "editorial_graph_edge_suppressions" });

EditorialGraphEdgeSuppressionSchema.index(
  { editorialContextId: 1, edgeKey: 1 },
  { unique: true },
);
EditorialGraphEdgeSuppressionSchema.index({ targetSemanticGraphId: 1, createdAt: -1 });

module.exports = mongoose.model("EditorialGraphEdgeSuppression", EditorialGraphEdgeSuppressionSchema);
