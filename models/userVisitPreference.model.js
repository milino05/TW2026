const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserVisitPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    visitId: { type: Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
    mode: { type: String, enum: ["default", "custom"], default: "default" },

    /** Usati dalle visite ufficiali, nel vocabolario del museo proprietario. */
    durationKey: { type: String, trim: true, lowercase: true, default: null },
    languageLevelKey: { type: String, trim: true, lowercase: true, default: null },

    /** Usati dalle visite community, indipendenti dai vocabolari locali. */
    depthPreference: { type: Number, min: 0, max: 1, default: null },
    languageComplexityPreference: { type: Number, min: 0, max: 1, default: null },
  },
  { timestamps: true },
);

UserVisitPreferenceSchema.index({ userId: 1, visitId: 1 }, { unique: true });
module.exports = mongoose.model("UserVisitPreference", UserVisitPreferenceSchema);
