const mongoose = require("mongoose");
const {
  RESOURCE_TYPES,
  CAPABILITIES,
  OFFER_VERSION_POLICIES,
  capabilitySupportsResource,
} = require("../config/marketplaceCapabilities");
const { Schema } = mongoose;

const OfferGrantSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
  capability: { type: String, enum: CAPABILITIES, required: true },
  versionPolicy: { type: String, enum: OFFER_VERSION_POLICIES, required: true },
}, { _id: false });

const PricingSchema = new Schema({
  type: { type: String, enum: ["free", "paid"], required: true },
  amountMinor: { type: Number, min: 0, default: null },
  currency: { type: String, trim: true, uppercase: true, default: null },
}, { _id: false });

const DependencyRefSchema = new Schema({
  resourceType: { type: String, enum: RESOURCE_TYPES, required: true },
  resourceId: { type: Schema.Types.ObjectId, required: true },
  ownerType: { type: String, enum: ["user", "organization"], required: true },
  ownerId: { type: Schema.Types.ObjectId, required: true },
}, { _id: false });

const MarketplaceOfferSchema = new Schema({
  listingId: { type: Schema.Types.ObjectId, ref: "MarketplaceListing", required: true, index: true },
  label: { type: String, trim: true, default: "" },
  pricing: { type: PricingSchema, required: true },
  grants: { type: [OfferGrantSchema], default: [] },
  dependencyIntegrity: {
    status: { type: String, enum: ["unchecked", "self_contained", "external_requirements"], default: "unchecked" },
    selfContainedDependencies: { type: [DependencyRefSchema], default: [] },
    externalRequirements: { type: [DependencyRefSchema], default: [] },
    checkedAt: { type: Date, default: null },
  },
  status: { type: String, enum: ["active", "withdrawn"], default: "active", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  withdrawnAt: { type: Date, default: null },
  withdrawnBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true, collection: "marketplace_offers" });

MarketplaceOfferSchema.pre("validate", function validateOffer(next) {
  if (this.pricing?.type === "free") {
    this.pricing.amountMinor = 0;
    this.pricing.currency = null;
  } else if (this.pricing?.type === "paid") {
    if (!Number.isInteger(this.pricing.amountMinor) || this.pricing.amountMinor < 0) {
      this.invalidate("pricing.amountMinor", "amountMinor deve essere un intero >= 0");
    }
    if (!this.pricing.currency) this.invalidate("pricing.currency", "currency e obbligatoria per un'offerta a pagamento");
  }
  if (!(this.grants || []).length) this.invalidate("grants", "Un'offerta richiede almeno un grant");
  for (const [index, grant] of (this.grants || []).entries()) {
    if (!capabilitySupportsResource(grant.capability, grant.resourceType)) {
      this.invalidate(`grants.${index}.capability`, "Capability non compatibile con il resourceType");
    }
  }
  next();
});

MarketplaceOfferSchema.index({ listingId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("MarketplaceOffer", MarketplaceOfferSchema);
