const mongoose = require("mongoose");
const { Schema } = mongoose;

const RuntimePlanProposalSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, ref: "VisitSession", required: true, index: true },
  basePlanRevisionId: { type: Schema.Types.ObjectId, ref: "SessionPlanRevision", required: true, index: true },
  reason: { type: String, required: true },
  fidelity: { type: String, required: true },
  status: { type: String, default: "pending", index: true },
  currentStopIndex: { type: Number, min: 0, required: true },
  adaptationRequest: { type: Schema.Types.Mixed, default: {} },
  currentEstimate: { type: Schema.Types.Mixed, required: true },
  proposedRevision: { type: Schema.Types.Mixed, required: true },
  messageKey: { type: String, required: true },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

RuntimePlanProposalSchema.index({ sessionId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model("PlanChangeProposal", RuntimePlanProposalSchema);
