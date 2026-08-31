const mongoose = require("mongoose");
const { Schema } = mongoose;

const QuizAnswerSchema = new Schema({
  questionId: { type: Schema.Types.ObjectId, required: true },
  selectedOptionIndex: { type: Number, min: 0, required: true },
  correct: { type: Boolean, required: true },
  pointsAwarded: { type: Number, min: 0, required: true },
  answeredAt: { type: Date, default: Date.now },
}, { _id: false });

const SynchronizedVisitQuizAttemptSchema = new Schema({
  synchronizedSessionId: { type: Schema.Types.ObjectId, ref: "SynchronizedVisitSession", required: true, index: true, immutable: true },
  membershipId: { type: Schema.Types.ObjectId, ref: "SynchronizedVisitMembership", required: true, index: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
  attemptNumber: { type: Number, min: 1, default: 1, required: true, immutable: true },
  status: { type: String, enum: ["submitted"], default: "submitted", required: true },
  answers: { type: [QuizAnswerSchema], default: [] },
  score: { type: Number, min: 0, required: true },
  maxScore: { type: Number, min: 0, required: true },
  submittedAt: { type: Date, default: Date.now },
  evaluation: {
    confirmedByHost: { type: Boolean, default: false },
    value: { type: String, trim: true, default: null },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
}, { timestamps: true, collection: "synchronized_visit_quiz_attempts" });

SynchronizedVisitQuizAttemptSchema.index({ synchronizedSessionId: 1, userId: 1, attemptNumber: 1 }, { unique: true });
SynchronizedVisitQuizAttemptSchema.index({ synchronizedSessionId: 1, status: 1, submittedAt: 1 });

module.exports = mongoose.model("SynchronizedVisitQuizAttempt", SynchronizedVisitQuizAttemptSchema);
