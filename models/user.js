const mongoose = require("mongoose");
const RoutingRequirementSchema = require("../schemas/routingRequirement.schema");
const { Schema } = mongoose;

const AbstractPreferenceSchema = new Schema({
  depthPreference: { type: Number, min: 0, max: 1, required: true },
  languageComplexityPreference: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const NavigationPreferenceSchema = new Schema({
  movementPacePreference: { type: Number, min: 0, max: 1, default: 0.5 },
  requirements: { type: [RoutingRequirementSchema], default: [] },
}, { _id: false });

const LearningPreferencesSchema = new Schema({
  personalHistory: { type: Boolean, default: null },
  collectiveContribution: { type: Boolean, default: null },
  decidedAt: { type: Date, default: null },
}, { _id: false });

const UserSchema = new Schema({
  username: { type: String, required: true, trim: true, lowercase: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  defaultPresentationPreference: { type: AbstractPreferenceSchema, default: null },
  defaultNavigationPreference: { type: NavigationPreferenceSchema, default: () => ({}) },
  learningPreferences: { type: LearningPreferencesSchema, default: () => ({}) },
  status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);
