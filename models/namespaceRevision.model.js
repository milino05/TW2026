const mongoose = require("mongoose");
const SubjectClassDefinitionSchema = require("../schemas/subjectClassDefinition.schema");
const NamespaceRelationTypeDefinitionSchema = require("../schemas/namespaceRelationTypeDefinition.schema");
const NamespaceDurationTypeSchema = require("../schemas/namespaceDurationType.schema");
const NamespaceLanguageLevelSchema = require("../schemas/namespaceLanguageLevel.schema");
const NamespacePresentationAspectSchema = require("../schemas/namespacePresentationAspect.schema");
const NamespaceSelectionSignalSchema = require("../schemas/namespaceSelectionSignal.schema");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema");
const { Schema } = mongoose;

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

const NamespaceRevisionSchema = new Schema({
  namespaceId: { type: Schema.Types.ObjectId, ref: "Namespace", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "NamespaceRevision", default: null },
  subjectClasses: { type: [SubjectClassDefinitionSchema], default: [] },
  relationTypes: { type: [NamespaceRelationTypeDefinitionSchema], default: [] },
  durationTypes: { type: [NamespaceDurationTypeSchema], default: [] },
  languageLevels: { type: [NamespaceLanguageLevelSchema], default: [] },
  presentationAspects: { type: [NamespacePresentationAspectSchema], default: [] },
  selectionSignals: { type: [NamespaceSelectionSignalSchema], default: [] },
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
}, { timestamps: true });

NamespaceRevisionSchema.index({ namespaceId: 1, version: 1 }, { unique: true });
NamespaceRevisionSchema.index({ namespaceId: 1, status: 1, version: -1 });

module.exports = mongoose.model("NamespaceRevision", NamespaceRevisionSchema);
