const mongoose = require("mongoose");
const { Schema } = mongoose;

const GraphSubjectBindingSchema = new Schema({
  graphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true, index: true, immutable: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true, immutable: true },
  subjectClassDefinitionIds: { type: [{ type: String, trim: true }], default: [], immutable: true },
}, { timestamps: true, collection: "graph_subject_bindings_v2" });

GraphSubjectBindingSchema.index({ graphRevisionId: 1, subjectId: 1 }, { unique: true });
GraphSubjectBindingSchema.index({ graphRevisionId: 1, subjectClassDefinitionIds: 1 });

module.exports = mongoose.model("GraphSubjectBinding", GraphSubjectBindingSchema);
