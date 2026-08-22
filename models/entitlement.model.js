const mongoose = require("mongoose");
const {
  RESOURCE_TYPES,
  CAPABILITIES,
  ENTITLEMENT_VERSION_POLICIES,
  capabilitySupportsResource,
} = require("../config/marketplaceCapabilities");
const { Schema } = mongoose;

const SnapshotRefSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const EntitlementSchema = new Schema({
  beneficiaryType: { type: String, enum: ["user", "organization"], required: true, index: true },
  beneficiaryId: { type: Schema.Types.ObjectId, required: true, index: true },
  sourceAcquisitionId: { type: Schema.Types.ObjectId, ref: "MarketplaceAcquisition", default: null, index: true },
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true, index: true },
  resourceId: { type: Schema.Types.ObjectId, required: true, index: true },
  capability: { type: String, enum: CAPABILITIES, required: true, index: true },
  versionPolicy: { type: String, enum: ENTITLEMENT_VERSION_POLICIES, required: true },
  baselineSnapshotRef: { type: SnapshotRefSchema, default: null },
  validFrom: { type: Date, default: Date.now },
  validUntil: { type: Date, default: null },
  status: { type: String, enum: ["active", "expired", "revoked"], default: "active", index: true },
}, { timestamps: true, collection: "entitlements" });

EntitlementSchema.pre("validate", function validateEntitlement(next) {
  if (!capabilitySupportsResource(this.capability, this.resourceType)) {
    this.invalidate("capability", "Capability non compatibile con il resourceType");
  }
  if (this.versionPolicy === "pinned" && !this.baselineSnapshotRef) {
    this.invalidate("baselineSnapshotRef", "Un Entitlement pinned richiede baselineSnapshotRef");
  }
  if (this.versionPolicy === "follow_current") this.baselineSnapshotRef = null;
  next();
});

EntitlementSchema.index({ beneficiaryType: 1, beneficiaryId: 1, resourceType: 1, resourceId: 1, capability: 1, status: 1 });
EntitlementSchema.index({ sourceAcquisitionId: 1, capability: 1, resourceType: 1, resourceId: 1 });

module.exports = mongoose.model("Entitlement", EntitlementSchema);
