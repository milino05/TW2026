const mongoose = require("mongoose");
const { Schema } = mongoose;

const RoutingRequirementSchema = new Schema(
  {
    attributeKey: { type: String, required: true, trim: true, lowercase: true },
    operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
    value: { type: Schema.Types.Mixed, required: true },
    priority: { type: String, enum: ["required", "preferred"], default: "preferred" },
    weight: { type: Number, min: 0, default: 1 },
  },
  { _id: false },
);

const NavigationSchema = new Schema(
  {
    movementPacePreference: { type: Number, min: 0, max: 1, default: null },
    requirements: { type: [RoutingRequirementSchema], default: [] },
  },
  { _id: false },
);

const UserVisitPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
    mode: { type: String, enum: ["default", "custom"], default: "default" },
    durationKey: { type: String, trim: true, lowercase: true, default: null },
    languageLevelKey: { type: String, trim: true, lowercase: true, default: null },
    depthPreference: { type: Number, min: 0, max: 1, default: null },
    languageComplexityPreference: { type: Number, min: 0, max: 1, default: null },
    navigation: { type: NavigationSchema, default: () => ({}) },
  },
  { timestamps: true },
);

UserVisitPreferenceSchema.index({ userId: 1, visitId: 1 }, { unique: true });
module.exports = mongoose.model("UserVisitPreference", UserVisitPreferenceSchema);
