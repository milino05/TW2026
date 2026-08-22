const mongoose = require("mongoose");
const { Schema } = mongoose;

const OrganizationMembershipSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
  role: { type: String, enum: ["operator", "manager"], required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assignedAt: { type: Date, default: Date.now },
}, { _id: false });

const AbstractPreferenceSchema = new Schema({
  depthPreference: { type: Number, min: 0, max: 1, required: true },
  languageComplexityPreference: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const RoutingRequirementSchema = new Schema({
  attributeKey: { type: String, required: true, trim: true, lowercase: true },
  operator: { type: String, enum: ["eq", "neq", "gte", "lte", "gt", "lt", "in"], default: "eq" },
  value: { type: Schema.Types.Mixed, required: true },
  priority: { type: String, enum: ["required", "preferred"], default: "preferred" },
  weight: { type: Number, min: 0, default: 1 },
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
  organizationMemberships: { type: [OrganizationMembershipSchema], default: [] },
  defaultPresentationPreference: { type: AbstractPreferenceSchema, default: null },
  defaultNavigationPreference: { type: NavigationPreferenceSchema, default: () => ({}) },
  learningPreferences: { type: LearningPreferencesSchema, default: () => ({}) },
  status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
}, { timestamps: true });

UserSchema.pre("validate", function validateOrganizationMemberships(next) {
  const seen = new Set();
  for (const membership of this.organizationMemberships || []) {
    const organizationId = String(membership?.organizationId || "");
    if (!organizationId) continue;
    if (seen.has(organizationId)) {
      this.invalidate(
        "organizationMemberships",
        "Una stessa organizzazione puo comparire una sola volta nelle organizationMemberships",
      );
      break;
    }
    seen.add(organizationId);
  }
  next();
});

UserSchema.index({ "organizationMemberships.organizationId": 1, "organizationMemberships.role": 1, status: 1 });

module.exports = mongoose.model("User", UserSchema);
