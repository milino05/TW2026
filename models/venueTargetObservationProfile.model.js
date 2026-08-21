const mongoose = require("mongoose");
const { Schema } = mongoose;

const VenueTargetObservationProfileSchema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true, unique: true, index: true },
  observationFactor: { type: Number, min: 0.1, default: 1 },
  typicalObservationSeconds: { type: Number, min: 0, default: null },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  contributorCount: { type: Number, min: 0, default: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: "venue_target_observation_profiles_v2" });

module.exports = mongoose.model("VenueTargetObservationProfile", VenueTargetObservationProfileSchema);
