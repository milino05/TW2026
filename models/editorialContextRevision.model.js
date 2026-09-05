const mongoose = require("mongoose");
const EditorialItemBindingSchema = require("../schemas/editorialItemBinding.schema");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

const ReviewEventSchema = new Schema({
  action: {
    type: String,
    enum: ["review_requested", "review_withdrawn", "changes_requested", "approved", "published"],
    required: true,
  },
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, required: true },
  message: { type: String, trim: true, maxlength: 2000, default: null },
}, { _id: false });

const ReviewSchema = new Schema({
  requestedAt: { type: Date, required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  decision: { type: String, enum: ["pending", "approved", "changes_requested", "withdrawn"], default: "pending" },
  message: { type: String, trim: true, maxlength: 2000, default: null },
  events: { type: [ReviewEventSchema], default: [] },
}, { _id: false });

const PublicationSchema = new Schema({
  publishedAt: { type: Date, default: null },
  publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  editorialReleaseId: { type: Schema.Types.ObjectId, ref: "EditorialRelease", default: null },
}, { _id: false });

const EditorialContextRevisionSchema = new Schema({
  editorialContextId: { type: Schema.Types.ObjectId, ref: "EditorialContext", required: true, immutable: true, index: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "EditorialContextRevision", default: null, immutable: true },
  sourceWorkingVersion: { type: Number, required: true, min: 0, immutable: true },
  displayName: { type: String, required: true, trim: true, immutable: true },
  shortDescription: { type: String, trim: true, default: null, immutable: true },
  description: { type: String, trim: true, default: null, immutable: true },
  namespaceRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", required: true, immutable: true, index: true },
  graphRevisionId: { type: Schema.Types.ObjectId, ref: "SemanticGraphRevision", required: true, immutable: true, index: true },
  itemBindings: { type: [EditorialItemBindingSchema], default: [], immutable: true },
  integrity: {
    status: { type: String, enum: ["valid"], default: "valid", immutable: true },
    issues: { type: [IntegrityIssueSchema], default: [], immutable: true },
    checkedAt: { type: Date, required: true, immutable: true },
    checkedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  },
  status: {
    type: String,
    enum: ["in_review", "changes_requested", "approved", "published", "withdrawn"],
    default: "in_review",
    index: true,
  },
  review: { type: ReviewSchema, required: true },
  publication: { type: PublicationSchema, default: () => ({}) },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, collection: "editorial_context_revisions_v2" });

EditorialContextRevisionSchema.index({ editorialContextId: 1, version: 1 }, { unique: true });
EditorialContextRevisionSchema.index({ editorialContextId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("EditorialContextRevision", EditorialContextRevisionSchema);
