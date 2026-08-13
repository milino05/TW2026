const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserGenerationPreferenceSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  interests: { type: [Schema.Types.Mixed], default: [] },
  depthPreference: { type: Number, min: 0, max: 1, default: null },
  languageComplexityPreference: { type: Number, min: 0, max: 1, default: null },
  movementPacePreference: { type: Number, min: 0, max: 1, default: null },
  navigationRequirements: { type: [Schema.Types.Mixed], default: [] },
  observationEmphasis: { type: Number, min: 0, max: 1, default: null },
  visitDensity: { type: Number, min: 0, max: 1, default: null },
  discoveryPreference: { type: Number, min: 0, max: 1, default: null },
  timeRiskTolerance: { type: Number, min: 0, max: 1, default: null },
}, { timestamps: true });

module.exports = mongoose.model("UserGenerationPreference", UserGenerationPreferenceSchema);
