const mongoose = require("mongoose");
const { Schema } = mongoose;

const SynchronizedVisitMembershipSchema = new Schema({
  synchronizedSessionId: { type: Schema.Types.ObjectId, ref: "SynchronizedVisitSession", required: true, index: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
  role: { type: String, enum: ["host", "participant"], required: true, immutable: true },
  visitSessionId: { type: Schema.Types.ObjectId, ref: "VisitSessionV2", required: true, unique: true, immutable: true },
  status: { type: String, enum: ["active", "removed", "completed"], default: "active", index: true },
  joinedAt: { type: Date, default: Date.now, immutable: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true, collection: "synchronized_visit_memberships" });

SynchronizedVisitMembershipSchema.index({ synchronizedSessionId: 1, userId: 1 }, { unique: true });
SynchronizedVisitMembershipSchema.index({ synchronizedSessionId: 1, status: 1, joinedAt: 1 });

module.exports = mongoose.model("SynchronizedVisitMembership", SynchronizedVisitMembershipSchema);
