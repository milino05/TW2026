const mongoose = require("mongoose");
const { Schema } = mongoose;

const EdgeProvenanceSchema = new Schema({
  origin: { type: String, enum: ["human", "ai_assisted", "ai_generated", "imported", "forked"], default: "human" },
  sourceGraphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", default: null },
  metadata: { type: Schema.Types.Mixed, default: null },
}, { _id: false });

const SemanticEdgeV2Schema = new Schema({
  graphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true, index: true, immutable: true },
  sourceSubjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true, immutable: true },
  targetSubjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true, immutable: true },
  relationTypeDefinitionId: { type: String, required: true, trim: true, index: true, immutable: true },
  weight: { type: Number, min: 0, max: 10, default: 1, immutable: true },
  metadata: { type: Schema.Types.Mixed, default: null, immutable: true },
  provenance: { type: EdgeProvenanceSchema, default: () => ({ origin: "human" }), immutable: true },
}, { timestamps: true, collection: "semantic_edges_v2" });

SemanticEdgeV2Schema.index(
  { graphRevisionId: 1, sourceSubjectId: 1, relationTypeDefinitionId: 1, targetSubjectId: 1 },
  { unique: true },
);
SemanticEdgeV2Schema.index({ graphRevisionId: 1, sourceSubjectId: 1 });
SemanticEdgeV2Schema.index({ graphRevisionId: 1, targetSubjectId: 1 });
SemanticEdgeV2Schema.index({ graphRevisionId: 1, relationTypeDefinitionId: 1 });

module.exports = mongoose.model("SemanticEdgeV2", SemanticEdgeV2Schema);
