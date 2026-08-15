const mongoose = require("mongoose");
const { Schema } = mongoose;
const VisitTimingProfileSchema = new Schema({ visitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", required: true, unique: true, index: true }, typicalResidualSeconds: { type: Number, default: 0 }, typicalTotalSeconds: { type: Number, min: 0, default: null }, lowerTypicalSeconds: { type: Number, min: 0, default: null }, upperTypicalSeconds: { type: Number, min: 0, default: null }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, contributorCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: Date.now } }, { timestamps: true });
module.exports = mongoose.model("VisitTimingProfile", VisitTimingProfileSchema);
