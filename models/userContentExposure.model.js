const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserContentExposureSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  variantKey: { type: String, trim: true, lowercase: true, required: true },
  lastItemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", default: null },
  durationKeys: { type: [{ type: String, trim: true, lowercase: true }], default: [] },
  languageLevelKeys: { type: [{ type: String, trim: true, lowercase: true }], default: [] },
  semanticFeatureKeys: { type: [String], default: [] },
  presentationAspectKeys: { type: [{ type: String, trim: true, lowercase: true }], default: [] },
  exposureCount: { type: Number, min: 0, default: 0 },
  completionEma: { type: Number, min: 0, max: 1, default: 0 },
  lastExposedAt: { type: Date, default: null },
}, { timestamps: true });

UserContentExposureSchema.index({ userId: 1, itemId: 1, variantKey: 1 }, { unique: true });
UserContentExposureSchema.index({ userId: 1, museumId: 1, lastExposedAt: -1 });
module.exports = mongoose.model("UserContentExposure", UserContentExposureSchema);
