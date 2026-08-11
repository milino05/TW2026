const mongoose = require("mongoose");
const { Schema } = mongoose;
const RoutingAttributeLearnedProfileSchema = new Schema({ scope: { type: String, enum: ["global", "museum"], required: true, index: true }, museumId: { type: Schema.Types.ObjectId, ref: "Museum", default: null, index: true }, canonicalAttributeKey: { type: String, required: true, trim: true, lowercase: true, index: true }, valueSignature: { type: String, required: true, trim: true }, typicalResidualSeconds: { type: Number, default: 0 }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, contributorCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: Date.now } }, { timestamps: true });
RoutingAttributeLearnedProfileSchema.index({ scope: 1, museumId: 1, canonicalAttributeKey: 1, valueSignature: 1 }, { unique: true });
module.exports = mongoose.model("RoutingAttributeLearnedProfile", RoutingAttributeLearnedProfileSchema);
