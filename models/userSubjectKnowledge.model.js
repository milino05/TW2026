const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSubjectKnowledgeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
  level: { type: Number, min: 0, max: 1, required: true },
  confidence: { type: Number, min: 0, max: 1, default: 0 },
  sampleCount: { type: Number, min: 0, default: 0 },
  lastObservedAt: { type: Date, default: null },
  source: { type: String, enum: ["explicit", "interaction"], default: "interaction" },
}, { timestamps: true, collection: "user_subject_knowledge_v2" });

UserSubjectKnowledgeSchema.index({ userId: 1, subjectId: 1 }, { unique: true });

module.exports = mongoose.model("UserSubjectKnowledge", UserSubjectKnowledgeSchema);
