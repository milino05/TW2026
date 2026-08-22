const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSubjectAffinitySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
  value: { type: Number, min: -1, max: 1, default: 0 },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
}, { timestamps: true, collection: "user_subject_affinities_v2" });

UserSubjectAffinitySchema.index({ userId: 1, subjectId: 1 }, { unique: true });
UserSubjectAffinitySchema.index({ userId: 1, lastObservedAt: -1 });

module.exports = mongoose.model("UserSubjectAffinity", UserSubjectAffinitySchema);
