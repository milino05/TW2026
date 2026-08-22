const mongoose = require("mongoose");
const {
  RESOURCE_TYPES,
  CAPABILITIES,
  OFFER_VERSION_POLICIES,
} = require("../config/marketplaceCapabilities");
const { Schema } = mongoose;

const ResourceRefSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const GrantSnapshotSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
  capability: { type: String, enum: CAPABILITIES, required: true },
  versionPolicy: { type: String, enum: OFFER_VERSION_POLICIES, required: true },
  resolvedSnapshotRef: { type: ResourceRefSchema, required: true },
}, { _id: false });

const PricingSnapshotSchema = new Schema({
  type: { type: String, enum: ["free", "paid"], required: true },
  amountMinor: { type: Number, min: 0, default: null },
  currency: { type: String, trim: true, uppercase: true, default: null },
}, { _id: false });

const MarketplaceAcquisitionSchema = new Schema({
  listingId: { type: Schema.Types.ObjectId, ref: "MarketplaceListing", required: true, index: true },
  offerId: { type: Schema.Types.ObjectId, ref: "MarketplaceOffer", required: true, index: true },
  buyerType: { type: String, enum: ["user", "organization"], required: true, index: true },
  buyerId: { type: Schema.Types.ObjectId, required: true, index: true },
  sellerType: { type: String, enum: ["user", "organization"], required: true },
  sellerId: { type: Schema.Types.ObjectId, required: true },
  pricingSnapshot: { type: PricingSnapshotSchema, required: true },
  grantSnapshots: { type: [GrantSnapshotSchema], default: [] },
  acquiredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  acquiredAt: { type: Date, default: Date.now, immutable: true },
}, { timestamps: true, collection: "marketplace_acquisitions" });

MarketplaceAcquisitionSchema.index({ buyerType: 1, buyerId: 1, acquiredAt: -1 });
MarketplaceAcquisitionSchema.index({ offerId: 1, buyerType: 1, buyerId: 1 }, { unique: true });

module.exports = mongoose.model("MarketplaceAcquisition", MarketplaceAcquisitionSchema);
