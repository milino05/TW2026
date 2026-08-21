const mongoose = require("mongoose");
const { Schema } = mongoose;

const LearningContributionSchema = new Schema(
  {
    contributorHash: { type: String, required: true, index: true, select: false },
    metricType: {
      type: String,
      enum: [
        "population_speed",
        "population_observation",
        "population_depth_preference",
        "population_language_complexity_preference",
        "population_visit_density",
        "museum_movement_factor",
        "museum_observation_factor",
        "pace_factor",
        "connection_residual",
        "routing_attribute_residual",
        "item_observation_factor",
        "item_observation_seconds",
        "venue_target_observation_seconds",
        "visit_timing_residual",
        "visit_total_seconds",
      ],
      required: true,
      index: true,
    },
    scopeKey: { type: String, required: true, index: true },
    value: { type: Number, required: true },
    sampleCount: { type: Number, min: 1, default: 1 },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    firstObservedAt: { type: Date, default: Date.now },
    lastObservedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

LearningContributionSchema.index({ contributorHash: 1, metricType: 1, scopeKey: 1 }, { unique: true });
LearningContributionSchema.index({ metricType: 1, scopeKey: 1, lastObservedAt: -1 });
module.exports = mongoose.model("LearningContribution", LearningContributionSchema);
