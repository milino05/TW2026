const mongoose = require("mongoose");
const { Schema } = mongoose;

const EditorialContextSchema = new Schema({
  contentSpaceId: { type: Schema.Types.ObjectId, ref: "ContentSpace", required: true, index: true },
  namespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", required: true, index: true },
  displayName: { type: String, required: true, trim: true, index: true },
  shortDescription: { type: String, trim: true, default: null },
  description: { type: String, trim: true, default: null },
  workingGraphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", default: null },
  publishedReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

EditorialContextSchema.index({ contentSpaceId: 1, namespaceId: 1 }, { unique: true });
EditorialContextSchema.index({ contentSpaceId: 1, lifecycleStatus: 1, displayName: 1 });
EditorialContextSchema.index({ namespaceId: 1, lifecycleStatus: 1, displayName: 1 });
EditorialContextSchema.index({ publishedReleaseId: 1 });

module.exports = mongoose.model("EditorialContext", EditorialContextSchema);
