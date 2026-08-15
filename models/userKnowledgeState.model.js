const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserKnowledgeStateSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  featureKey: { type: String, required: true },
  kind: { type: String, enum: ["item", "item_type", "relation_type", "canonical", "tag"], required: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null, index: true },
  key: { type: String, trim: true, lowercase: true, default: null },
  scheme: { type: String, trim: true, lowercase: true, default: null },
  refId: { type: String, trim: true, default: null },
  level: { type: Number, min: 0, max: 1, required: true },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
  source: { type: String, enum: ["explicit", "interaction"], default: "explicit" },
}, { timestamps: true });

UserKnowledgeStateSchema.index({ userId: 1, featureKey: 1 }, { unique: true });
module.exports = mongoose.model("UserKnowledgeState", UserKnowledgeStateSchema);
