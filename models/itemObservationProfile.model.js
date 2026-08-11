const mongoose = require("mongoose");
const { Schema } = mongoose;
const ItemObservationProfileSchema = new Schema({ itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, unique: true, index: true }, observationFactor: { type: Number, min: 0.1, default: 1 }, typicalObservationSeconds: { type: Number, min: 0, default: null }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, distinctUserCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: Date.now } }, { timestamps: true });
module.exports = mongoose.model("ItemObservationProfile", ItemObservationProfileSchema);
