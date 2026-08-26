const mongoose = require("mongoose");
const { RESOURCE_TYPES } = require("../config/marketplaceCapabilities");
const { Schema } = mongoose;

const MarketplaceListingSchema = new Schema({
  sellerType: { type: String, enum: ["user", "organization"], required: true, index: true },
  sellerId: { type: Schema.Types.ObjectId, required: true, index: true },
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true, index: true },
  resourceId: { type: Schema.Types.ObjectId, required: true, index: true },
  title: { type: String, trim: true, default: "" },
  summary: { type: String, trim: true, default: "" },
  catalogMetadata: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: ["draft", "published", "withdrawn"], default: "draft", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  publishedAt: { type: Date, default: null },
  withdrawnAt: { type: Date, default: null },
  withdrawnBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true, collection: "marketplace_listings" });

MarketplaceListingSchema.index({ resourceType: 1, resourceId: 1, status: 1 });
MarketplaceListingSchema.index({ sellerType: 1, sellerId: 1, status: 1, updatedAt: -1 });
MarketplaceListingSchema.index({ title: "text", summary: "text" });

module.exports = mongoose.model("MarketplaceListing", MarketplaceListingSchema);
