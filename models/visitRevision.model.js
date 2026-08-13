const mongoose = require("mongoose");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

const VisitStopSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
}, { _id: true });
const PresentationPolicySchema = new Schema({ durationKey: { type: String, required: true, trim: true, lowercase: true }, languageLevelKey: { type: String, required: true, trim: true, lowercase: true } }, { _id: false });
const LogisticsTransitionSchema = new Schema({ fromStopIndex: { type: Number, min: 0, required: true }, toStopIndex: { type: Number, min: 0, required: true }, type: { type: String, enum: ["indoor", "inter_venue"], required: true }, layoutRevisionId: { type: Schema.Types.ObjectId, ref: "MuseumLayoutRevision", default: null }, plannedPath: { type: [Schema.Types.ObjectId], default: [] }, instructionOverride: { type: String, trim: true, default: null }, communityNote: { type: String, trim: true, default: null }, estimatedTransferSeconds: { type: Number, min: 0, default: null } }, { _id: true });
const ReviewEventSchema = new Schema({ action: { type: String, enum: ["review_requested", "review_withdrawn", "changes_requested", "published"], required: true }, actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true }, message: { type: String, trim: true, default: null } }, { _id: false });
const ReviewSchema = new Schema({ requestedAt: { type: Date, default: null }, requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, reviewedAt: { type: Date, default: null }, reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, decision: { type: String, enum: ["pending", "approved", "changes_requested", null], default: null }, message: { type: String, trim: true, default: null }, events: { type: [ReviewEventSchema], default: [] } }, { _id: false });
const BaselineTimingSchema = new Schema({ estimatedContentSeconds: { type: Number, min: 0, default: 0 }, estimatedObservationSeconds: { type: Number, min: 0, default: 0 }, estimatedLogisticsSeconds: { type: Number, min: 0, default: 0 }, estimatedTotalSeconds: { type: Number, min: 0, default: 0 }, adaptivePolicyVersion: { type: Number, min: 1, default: 1 }, computedAt: { type: Date, default: null } }, { _id: false });

const VisitRevisionSchema = new Schema({
  visitId: { type: Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevision", default: null },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  defaultPresentationPolicy: { type: PresentationPolicySchema, default: null },
  stops: { type: [VisitStopSchema], default: [] },
  museumIds: { type: [{ type: Schema.Types.ObjectId, ref: "Museum" }], default: [], index: true },
  baselineTiming: { type: BaselineTimingSchema, default: () => ({}) },
  logistics: { preVisitNotes: { type: [{ type: String, trim: true }], default: [] }, transitions: { type: [LogisticsTransitionSchema], default: [] } },
  status: { type: String, enum: ["draft", "in_review", "changes_requested", "published", "superseded"], default: "draft", index: true },
  integrity: { status: { type: String, enum: ["valid", "needs_review"], default: "needs_review" }, issues: { type: [IntegrityIssueSchema], default: [] }, checkedAt: { type: Date, default: null }, checkedBy: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  review: { type: ReviewSchema, default: () => ({}) },
  publication: { publishedAt: { type: Date, default: null }, publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
VisitRevisionSchema.index({ visitId: 1, version: 1 }, { unique: true });
VisitRevisionSchema.index({ visitId: 1, status: 1, updatedAt: -1 });
VisitRevisionSchema.index({ museumIds: 1, status: 1 });
VisitRevisionSchema.index({ title: "text", description: "text" });
module.exports = mongoose.model("VisitRevision", VisitRevisionSchema);
