const mongoose = require("mongoose");
const { Schema } = mongoose;
const ConnectionLearnedProfileSchema = new Schema({ layoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", required: true, index: true }, connectionId: { type: Schema.Types.ObjectId, required: true, index: true }, typicalResidualSeconds: { type: Number, default: 0 }, confidence: { type: Number, min: 0, max: 1, default: 0 }, sampleCount: { type: Number, min: 0, default: 0 }, contributorCount: { type: Number, min: 0, default: 0 }, updatedAt: { type: Date, default: Date.now } }, { timestamps: true });
ConnectionLearnedProfileSchema.index({ layoutRevisionId: 1, connectionId: 1 }, { unique: true });
module.exports = mongoose.model("ConnectionLearnedProfile", ConnectionLearnedProfileSchema);
