const mongoose = require("mongoose");
const { RESOURCE_TYPES } = require("../config/marketplaceCapabilities");
const { Schema } = mongoose;

const ADOPTION_ACTIONS = Object.freeze([
  "content_link",
  "content_visit",
  "content_fork",
  "namespace_use",
  "namespace_fork",
  "physical_vocabulary_fork",
  "context_reference",
  "context_import",
  "context_venue_primary",
  "visit_copy",
]);

const TARGET_RESOURCE_TYPES = Object.freeze([
  "content_space",
  "item",
  "item_edition",
  "editorial_context",
  "semantic_graph",
  "namespace",
  "physical_vocabulary",
  "visit",
  "venue",
]);

const SourceResourceRefSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const TargetResourceRefSchema = new Schema({
  resourceType: { type: String, enum: TARGET_RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const AdoptionSchema = new Schema({
  beneficiaryType: { type: String, enum: ["user", "organization"], required: true, index: true },
  beneficiaryId: { type: Schema.Types.ObjectId, required: true, index: true },
  entitlementId: { type: Schema.Types.ObjectId, ref: "Entitlement", required: true, index: true },
  sourceResourceRef: { type: SourceResourceRefSchema, required: true },
  sourceSnapshotRef: { type: SourceResourceRefSchema, required: true },
  action: { type: String, enum: ADOPTION_ACTIONS, required: true, index: true },
  targetResourceRef: { type: TargetResourceRefSchema, default: null },
  resultResourceRef: { type: TargetResourceRefSchema, default: null },
  adoptedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  adoptedAt: { type: Date, default: Date.now, immutable: true },
}, { timestamps: true, collection: "marketplace_adoptions" });

AdoptionSchema.index({ beneficiaryType: 1, beneficiaryId: 1, adoptedAt: -1 });
AdoptionSchema.index({ entitlementId: 1, action: 1, adoptedAt: -1 });
AdoptionSchema.index({ "sourceResourceRef.resourceType": 1, "sourceResourceRef.resourceId": 1, adoptedAt: -1 });

module.exports = {
  Adoption: mongoose.model("Adoption", AdoptionSchema),
  ADOPTION_ACTIONS,
  TARGET_RESOURCE_TYPES,
};
