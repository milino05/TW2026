const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

test("seller projection compone vendita e adozione con dati user-facing", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const { getCommercialManagement } = require("../services/marketplaceCommercialV2.service");

    const [seller, buyer] = await User.create([
      { username: "seller-projection", passwordHash: "test-hash" },
      { username: "buyer-projection", passwordHash: "test-hash" },
    ]);
    const visitId = new mongoose.Types.ObjectId();
    const visitRevisionId = new mongoose.Types.ObjectId();
    const listing = await MarketplaceListing.create({
      sellerType: "user",
      sellerId: seller._id,
      resourceType: "visit",
      resourceId: visitId,
      title: "Visita venduta",
      summary: "Visita usata per verificare la projection seller",
      status: "published",
      createdBy: seller._id,
    });
    const offer = await MarketplaceOffer.create({
      listingId: listing._id,
      label: "Accesso visita",
      pricing: { type: "paid", amountMinor: 500, currency: "EUR" },
      grants: [{
        resourceType: "visit",
        resourceId: visitId,
        capability: "visit.execute",
        versionPolicy: "follow_current",
      }],
      createdBy: seller._id,
    });
    await MarketplaceOffer.create({
      listingId: listing._id,
      label: "Offerta ritirata",
      pricing: { type: "free" },
      grants: [{
        resourceType: "visit",
        resourceId: visitId,
        capability: "visit.execute",
        versionPolicy: "follow_current",
      }],
      status: "withdrawn",
      withdrawnAt: new Date(),
      withdrawnBy: seller._id,
      createdBy: seller._id,
    });
    const acquisition = await MarketplaceAcquisition.create({
      listingId: listing._id,
      offerId: offer._id,
      buyerType: "user",
      buyerId: buyer._id,
      sellerType: "user",
      sellerId: seller._id,
      pricingSnapshot: { type: "paid", amountMinor: 500, currency: "EUR" },
      grantSnapshots: [{
        resourceType: "visit",
        resourceId: visitId,
        capability: "visit.execute",
        versionPolicy: "follow_current",
        resolvedSnapshotRef: { resourceType: "visit_revision", resourceId: visitRevisionId },
      }],
      acquiredBy: buyer._id,
    });
    const entitlement = await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
      sourceAcquisitionId: acquisition._id,
      resourceType: "visit",
      resourceId: visitId,
      capability: "visit.execute",
      versionPolicy: "follow_current",
      baselineSnapshotRef: { resourceType: "visit_revision", resourceId: visitRevisionId },
    });
    await Adoption.create({
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
      entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "visit", resourceId: visitId },
      sourceSnapshotRef: { resourceType: "visit_revision", resourceId: visitRevisionId },
      action: "visit_copy",
      adoptedBy: buyer._id,
    });

    const projection = await getCommercialManagement({ actorUserId: seller._id });
    assert.equal(projection.listings.length, 1);
    assert.equal(projection.listings[0].offers.length, 1);
    assert.equal(projection.listings[0].offers.some((entry) => entry.status === "withdrawn"), false);
    assert.equal(projection.listings[0].offers[0].grants[0].versionBehaviour.label, "Include gli aggiornamenti futuri");
    assert.equal(projection.distribution.summary.salesCount, 1);
    assert.equal(projection.distribution.summary.adoptionCount, 1);
    assert.equal(projection.distribution.recentSales[0].asset.title, "Visita venduta");
    assert.equal(projection.distribution.recentSales[0].buyer.name, "buyer-projection");
    assert.equal(projection.distribution.recentAdoptions[0].beneficiary.name, "buyer-projection");
    assert.equal(projection.distribution.recentAdoptions[0].actionLabel, "Visita riutilizzata come copia indipendente");
  });
});
