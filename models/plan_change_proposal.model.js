const mongoose = require("mongoose");
const { Schema } = mongoose;

const PlanChangeProposalSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSession", required: true, index: true },
  basePlanRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevision", required: true, index: true },
  reason: { type: String, enum: ["ahead_of_schedule", "behind_schedule", "manual_request", "refocus_future", "extend_visit", "parameter_change"], required: true },
  fidelity: { type: String, enum: ["preserve", "adapt", "regenerate"], required: true },
  status: { type: String, enum: ["pending", "accepted", "rejected", "stale"], default: "pending", index: true },
  currentStopIndex: { type: Number, min: 0, required: true },
  adaptationRequest: { type: Schema.Types.Mixed, default: {} },
  currentEstimate: { type: Schema.Types.Mixed, required: true },
  proposedRevision: { type: Schema.Types.Mixed, required: true },
  messageKey: { type: String, required: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

PlanChangeProposalSchema.index({ sessionId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("PlanChangeProposal", PlanChangeProposalSchema);
