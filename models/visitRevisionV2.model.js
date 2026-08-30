const mongoose = require("mongoose");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

const EditorialSourceSchema = new Schema({
  editorialReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", required: true },
}, { _id: true });

const ContentSourceSchema = new Schema({
  sourceType: { type: String, enum: ["editorial_release", "item_revision"], required: true },
  editorialReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", default: null },
}, { _id: true });

ContentSourceSchema.pre("validate", function validateContentSource(next) {
  if (this.sourceType === "editorial_release" && !this.editorialReleaseId) this.invalidate("editorialReleaseId", "La fonte editoriale richiede una EditorialRelease");
  if (this.sourceType === "item_revision" && !this.itemRevisionId) this.invalidate("itemRevisionId", "La fonte diretta richiede una ItemRevision");
  if (this.sourceType === "editorial_release") this.itemRevisionId = null;
  if (this.sourceType === "item_revision") this.editorialReleaseId = null;
  next();
});

const VisitAnchorSchema = new Schema({
  venueTargetId: { type: Schema.Types.ObjectId, ref: "VenueTarget", required: true },
}, { _id: true });

const ContentEntrySchema = new Schema({
  contentSourceId: { type: Schema.Types.ObjectId, default: null },
  editorialSourceId: { type: Schema.Types.ObjectId, default: null },
  itemId: { type: Schema.Types.ObjectId, ref: "ItemV2", required: true },
  itemEditionId: { type: Schema.Types.ObjectId, ref: "ItemEdition", required: true },
  itemRevisionId: { type: Schema.Types.ObjectId, ref: "ItemRevisionV2", required: true },
  deliveryAnchorId: { type: Schema.Types.ObjectId, default: null },
  role: { type: String, enum: ["core", "recommended", "optional"], default: "recommended" },
}, { _id: true });

const PresentationBaselineSchema = new Schema({
  depthPreference: { type: Number, min: 0, max: 1, default: null },
  languageComplexityPreference: { type: Number, min: 0, max: 1, default: null },
  locale: { type: String, trim: true, default: null },
}, { _id: false });

const RouteHintSchema = new Schema({
  fromAnchorId: { type: Schema.Types.ObjectId, required: true },
  toAnchorId: { type: Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ["indoor", "inter_venue"], required: true },
  instructionOverride: { type: String, trim: true, default: null },
  note: { type: String, trim: true, default: null },
  estimatedTransferSeconds: { type: Number, min: 0, default: null },
}, { _id: true });

const ReviewEventSchema = new Schema({
  action: { type: String, enum: ["review_requested", "review_withdrawn", "changes_requested", "published"], required: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, required: true },
  message: { type: String, trim: true, default: null },
}, { _id: false });
const ReviewSchema = new Schema({
  requestedAt: { type: Date, default: null },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  decision: { type: String, enum: ["pending", "approved", "changes_requested", null], default: null },
  message: { type: String, trim: true, default: null },
  events: { type: [ReviewEventSchema], default: [] },
}, { _id: false });

const VisitRevisionV2Schema = new Schema({
  visitId: { type: Schema.Types.ObjectId, ref: "VisitV2", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "VisitRevisionV2", default: null },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: null },
  contentSources: { type: [ContentSourceSchema], default: [] },
  editorialSources: { type: [EditorialSourceSchema], default: [] },
  contentEntries: { type: [ContentEntrySchema], default: [] },
  visitAnchors: { type: [VisitAnchorSchema], default: [] },
  presentationBaseline: { type: PresentationBaselineSchema, default: null },
  logistics: {
    preVisitNotes: { type: [{ type: String, trim: true }], default: [] },
    routeHints: { type: [RouteHintSchema], default: [] },
  },
  status: { type: String, enum: ["draft", "in_review", "changes_requested", "published", "superseded"], default: "draft", index: true },
  integrity: {
    status: { type: String, enum: ["valid", "needs_review"], default: "needs_review" },
    issues: { type: [IntegrityIssueSchema], default: [] },
    checkedAt: { type: Date, default: null },
    checkedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  review: { type: ReviewSchema, default: () => ({}) },
  publication: {
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, collection: "visit_revisions_v2" });

VisitRevisionV2Schema.index({ visitId: 1, version: 1 }, { unique: true });
VisitRevisionV2Schema.index({ visitId: 1, status: 1, updatedAt: -1 });
VisitRevisionV2Schema.index({ "editorialSources.editorialReleaseId": 1 });
VisitRevisionV2Schema.index({ "contentSources.editorialReleaseId": 1 });
VisitRevisionV2Schema.index({ "contentSources.itemRevisionId": 1 });
VisitRevisionV2Schema.index({ "contentEntries.itemEditionId": 1, "contentEntries.itemRevisionId": 1 });
VisitRevisionV2Schema.index({ "visitAnchors.venueTargetId": 1 });
VisitRevisionV2Schema.index({ title: "text", description: "text" });

module.exports = mongoose.model("VisitRevisionV2", VisitRevisionV2Schema);
