const mongoose = require("mongoose");
const { Schema } = mongoose;

const MuseumMembershipSchema = new Schema(
  {
    museumId: { type: Schema.Types.ObjectId, ref: "Museum", required: true },
    role: { type: String, enum: ["operator", "manager"], required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const AbstractPreferenceSchema = new Schema(
  {
    depthPreference: { type: Number, min: 0, max: 1, required: true },
    languageComplexityPreference: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    memberships: { type: [MuseumMembershipSchema], default: [] },
    defaultPresentationPreference: { type: AbstractPreferenceSchema, default: null },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

UserSchema.pre("validate", function validateUniqueMuseumMemberships(next) {
  const seen = new Set();
  for (const membership of this.memberships || []) {
    const museumId = String(membership.museumId || "");
    if (!museumId) continue;
    if (seen.has(museumId)) {
      this.invalidate("memberships", "Uno stesso museo puo comparire una sola volta nelle memberships");
      break;
    }
    seen.add(museumId);
  }
  next();
});

UserSchema.index({ "memberships.museumId": 1, "memberships.role": 1, status: 1 });
module.exports = mongoose.model("User", UserSchema);
