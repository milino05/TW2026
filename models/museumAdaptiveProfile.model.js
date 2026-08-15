const mongoose = require("mongoose");
const { Schema } = mongoose;
const EstimateSchema = new Schema({ value: { type: Number, default: null }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, contributorCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: null } }, { _id: false });
const MuseumAdaptiveProfileSchema = new Schema({ museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true, unique: true, index: true }, movementResidualFactor: { type: EstimateSchema, default: () => ({ value: 1 }) }, observationFactor: { type: EstimateSchema, default: () => ({ value: 1 }) }, paceFactors: { calm: { type: EstimateSchema, default: () => ({}) }, normal: { type: EstimateSchema, default: () => ({}) }, fast: { type: EstimateSchema, default: () => ({}) } } }, { timestamps: true });
module.exports = mongoose.model("MuseumAdaptiveProfile", MuseumAdaptiveProfileSchema);
