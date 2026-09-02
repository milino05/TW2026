const mongoose = require("mongoose");
const { Schema } = mongoose;

const SemanticGraphSchema = new Schema({
  namespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", required: true, index: true, immutable: true },
  displayName: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true, default: null },
  ownerType: { type: String, enum: ["user", "organization"], required: true, index: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true, immutable: true },
  workingRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", default: null },
  workingVersion: { type: Number, min: 0, default: 0 },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "semantic_graphs_v2" });

SemanticGraphSchema.index({ ownerType: 1, ownerId: 1, lifecycleStatus: 1, displayName: 1 });
SemanticGraphSchema.index({ namespaceId: 1, lifecycleStatus: 1, displayName: 1 });
SemanticGraphSchema.index({ workingRevisionId: 1 });

module.exports = mongoose.model("SemanticGraph", SemanticGraphSchema);
