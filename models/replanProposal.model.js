const mongoose = require("mongoose");
const { Schema } = mongoose;

const ReplanProposalSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSession", required: true, index: true },
  generatedVisitPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlan", required: true, index: true },
  reason: { type: String, enum: ["ahead_of_schedule", "behind_schedule", "manual_request"], required: true },
  status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending", index: true },
  currentStopIndex: { type: Number, min: 0, required: true },
  currentEstimate: { type: Schema.Types.Mixed, required: true },
  proposedTail: { type: Schema.Types.Mixed, required: true },
  messageKey: { type: String, required: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("ReplanProposal", ReplanProposalSchema);
