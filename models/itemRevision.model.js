const mongoose = require("mongoose");
const PresentationVariantSchema = require("../schemas/presentationVariant.schema");
const SemanticRefSchema = require("../schemas/semanticRef.schema");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

const SelectionSignalUseSchema = new Schema({ key: { type: String, required: true, trim: true, lowercase: true }, weight: { type: Number, min: 0, max: 1, default: 1 } }, { _id: false });
const ReviewEventSchema = new Schema({ action: { type: String, enum: ["review_requested", "review_withdrawn", "changes_requested", "published"], required: true }, actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true }, message: { type: String, trim: true, default: null } }, { _id: false });
const ReviewSchema = new Schema({ requestedAt: { type: Date, default: null }, requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, reviewedAt: { type: Date, default: null }, reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, decision: { type: String, enum: ["pending", "approved", "changes_requested", null], default: null }, message: { type: String, trim: true, default: null }, events: { type: [ReviewEventSchema], default: [] } }, { _id: false });
const DefaultPresentationSchema = new Schema({ variantKey: { type: String, required: true, trim: true, lowercase: true }, durationKey: { type: String, required: true, trim: true, lowercase: true }, languageLevelKey: { type: String, required: true, trim: true, lowercase: true } }, { _id: false });

/** Versioned node/content payload. Graph topology is persisted in SemanticEdge. */
const ItemRevisionSchema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevision", default: null },
  label: { type: String, required: true, trim: true },
  recognitionImage: { url: { type: String, trim: true }, altText: { type: String, trim: true } },
  tags: [{ type: String, trim: true }],
  metadata: { license: { type: String, trim: true } },
  semanticRefs: { type: [SemanticRefSchema], default: [] },
  selectionSignals: { type: [SelectionSignalUseSchema], default: [] },
  presentationVariants: { type: [PresentationVariantSchema], default: [] },
  defaultPresentation: { type: DefaultPresentationSchema, default: null },
  jsonld: { type: Schema.Types.Mixed },
  status: { type: String, enum: ["draft", "in_review", "changes_requested", "published", "superseded"], default: "draft", index: true },
  integrity: { status: { type: String, enum: ["valid", "needs_review"], default: "needs_review" }, issues: { type: [IntegrityIssueSchema], default: [] }, checkedAt: { type: Date, default: null }, checkedBy: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  review: { type: ReviewSchema, default: () => ({}) },
  publication: { publishedAt: { type: Date, default: null }, publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

ItemRevisionSchema.index({ itemId: 1, version: 1 }, { unique: true });
ItemRevisionSchema.index({ itemId: 1, status: 1, updatedAt: -1 });
ItemRevisionSchema.index({ label: "text", tags: "text" });
ItemRevisionSchema.index({ "presentationVariants.key": 1 });
ItemRevisionSchema.index({ "presentationVariants.representations.languageLevelKey": 1, "presentationVariants.representations.durationKey": 1 });
ItemRevisionSchema.index({ "semanticRefs.scheme": 1, "semanticRefs.id": 1 });
ItemRevisionSchema.index({ "selectionSignals.key": 1 });
module.exports = mongoose.model("ItemRevision", ItemRevisionSchema);
