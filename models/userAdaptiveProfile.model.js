const mongoose = require("mongoose");
const { Schema } = mongoose;

const EstimateSchema = new Schema({ value: { type: Number, min: 0, default: null }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: null } }, { _id: false });
const UserAdaptiveProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  movement: { estimatedSpeedMps: { type: EstimateSchema, default: () => ({}) } },
  observation: { typicalPostContentObservationSeconds: { type: EstimateSchema, default: () => ({}) } },
  presentation: {
    depthPreference: { type: EstimateSchema, default: () => ({}) },
    languageComplexityPreference: { type: EstimateSchema, default: () => ({}) },
  },
  behavior: {
    depthIncreaseRequestRate: { type: EstimateSchema, default: () => ({}) },
    depthDecreaseRequestRate: { type: EstimateSchema, default: () => ({}) },
    optionalContentEntrySkipRate: { type: EstimateSchema, default: () => ({}) },
    contentCompletionRatio: { type: EstimateSchema, default: () => ({}) },
  },
}, { timestamps: true });
module.exports = mongoose.model("UserAdaptiveProfile", UserAdaptiveProfileSchema);
