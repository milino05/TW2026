const mongoose = require("mongoose");
const PlaceTypeDefinitionSchema = require("../schemas/placeTypeDefinition.schema");
const ConnectionTypeDefinitionSchema = require("../schemas/connectionTypeDefinition.schema");
const PhysicalAttributeDefinitionSchema = require("../schemas/physicalAttributeDefinition.schema");
const RoutingProfileDefinitionSchema = require("../schemas/routingProfileDefinition.schema");
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

const PhysicalVocabularyRevisionSchema = new Schema({
  physicalVocabularyId: { type: Schema.Types.ObjectId, ref: "PhysicalVocabulary", required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  basedOnRevisionId: { type: Schema.Types.ObjectId, ref: "PhysicalVocabularyRevision", default: null },
  placeTypes: { type: [PlaceTypeDefinitionSchema], default: [] },
  connectionTypes: { type: [ConnectionTypeDefinitionSchema], default: [] },
  physicalAttributes: { type: [PhysicalAttributeDefinitionSchema], default: [] },
  routingProfiles: { type: [RoutingProfileDefinitionSchema], default: [] },
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

PhysicalVocabularyRevisionSchema.index({ physicalVocabularyId: 1, version: 1 }, { unique: true });
PhysicalVocabularyRevisionSchema.index({ physicalVocabularyId: 1, status: 1, version: -1 });

module.exports = mongoose.model("PhysicalVocabularyRevision", PhysicalVocabularyRevisionSchema);
