const mongoose = require("mongoose");
const { Schema } = mongoose;

const NamespaceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: null },
  ownerType: { type: String, enum: ["user", "organization"], required: true, index: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  forkedFromNamespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", default: null, index: true },
  forkedFromNamespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", default: null },
  publishedRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", default: null, index: true },
  workingRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", default: null, index: true },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

NamespaceSchema.index({ ownerType: 1, ownerId: 1, lifecycleStatus: 1, name: 1 });

module.exports = mongoose.model("Namespace", NamespaceSchema);
