const mongoose = require("mongoose");
const { Schema } = mongoose;

const EstimateSchema = new Schema({ value: { type: Number, min: 0, default: null }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: null } }, { _id: false });
const AffinitySchema = new Schema({
  kind: { type: String, enum: ["item", "item_type", "relation_type", "canonical"], required: true },
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "Item", default: null },
  key: { type: String, trim: true, lowercase: true, default: null },
  scheme: { type: String, trim: true, lowercase: true, default: null },
  refId: { type: String, trim: true, default: null },
  value: { type: Number, min: -1, max: 1, default: 0 }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, lastObservedAt: { type: Date, default: null },
}, { _id: true });
const AspectAffinitySchema = new Schema({
  museumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null }, key: { type: String, required: true, trim: true, lowercase: true }, semanticRefs: { type: [{ scheme: { type: String, trim: true, lowercase: true }, id: { type: String, trim: true } }], default: [] }, value: { type: Number, min: -1, max: 1, default: 0 }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, lastObservedAt: { type: Date, default: null },
}, { _id: true });

const UserAdaptiveProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  movement: { estimatedSpeedMps: { type: EstimateSchema, default: () => ({}) } },
  observation: { typicalPostContentObservationSeconds: { type: EstimateSchema, default: () => ({}) } },
  presentation: { depthPreference: { type: EstimateSchema, default: () => ({}) }, languageComplexityPreference: { type: EstimateSchema, default: () => ({}) } },
  behavior: { depthIncreaseRequestRate: { type: EstimateSchema, default: () => ({}) }, optionalContentEntrySkipRate: { type: EstimateSchema, default: () => ({}) } },
  semanticAffinities: { type: [AffinitySchema], default: [] }, presentationAspectAffinities: { type: [AspectAffinitySchema], default: [] },
}, { timestamps: true });
UserAdaptiveProfileSchema.index({ "semanticAffinities.itemId": 1 });
UserAdaptiveProfileSchema.index({ "semanticAffinities.scheme": 1, "semanticAffinities.refId": 1 });
module.exports = mongoose.model("UserAdaptiveProfile", UserAdaptiveProfileSchema);
