const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSemanticAffinitySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  featureKey: { type: String, required: true },
  kind: { type: String, enum: ["item", "item_type", "relation_type", "canonical", "presentation_aspect", "selection_signal", "tag"], required: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null, index: true },
  key: { type: String, trim: true, lowercase: true, default: null },
  scheme: { type: String, trim: true, lowercase: true, default: null },
  refId: { type: String, trim: true, default: null },
  value: { type: Number, min: -1, max: 1, default: 0 },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
}, { timestamps: true });

UserSemanticAffinitySchema.index({ userId: 1, featureKey: 1 }, { unique: true });
UserSemanticAffinitySchema.index({ userId: 1, museumId: 1, lastObservedAt: -1 });
module.exports = mongoose.model("UserSemanticAffinity", UserSemanticAffinitySchema);
