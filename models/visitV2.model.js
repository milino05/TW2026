const mongoose = require("mongoose");
const { Schema } = mongoose;

const VisitV2Schema = new Schema({
  ownerType: { type: String, enum: ["user", "organization"], required: true, index: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
  copiedFromVisitId: { type: Schema.Types.ObjectId, ref: "VisitV2", default: null, index: true },
  copiedFromVisitRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null },
  materializedFromGeneratedPlanId: { type: Schema.Types.ObjectId, ref: "GeneratedVisitPlanV2", default: null, index: true },
  publishedRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null, index: true },
  workingRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null, index: true },
  lifecycleStatus: { type: String, enum: ["active", "trashed"], default: "active", index: true },
  trashedAt: { type: Date, default: null },
  trashedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "visits_v2" });

VisitV2Schema.index({ ownerType: 1, ownerId: 1, lifecycleStatus: 1, updatedAt: -1 });
VisitV2Schema.index({ copiedFromVisitId: 1, createdAt: -1 });
VisitV2Schema.index({ materializedFromGeneratedPlanId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("VisitV2", VisitV2Schema);
