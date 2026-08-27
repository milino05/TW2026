const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");

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

async function createPublishedVisit({ VisitV2, VisitRevisionV2, seller, title }) {
  const visit = await VisitV2.create({ ownerType: "user", ownerId: seller._id, createdBy: seller._id });
  const revision = await VisitRevisionV2.create({
    visitId: visit._id,
    version: 1,
    title,
    editorialSources: [],
    contentEntries: [],
    visitAnchors: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
    publication: { publishedAt: new Date(), publishedBy: seller._id },
    createdBy: seller._id,
    updatedBy: seller._id,
  });
  visit.publishedRevisionId = revision._id;
  await visit.save();
  return visit;
}

test("consumer projection separa beneficiario personale e organizzazione e mantiene i diritti dopo il withdrawal", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const marketplace = require("../services/marketplaceV2.service");
    const catalog = require("../services/marketplaceCatalogV2.service");
    const consumer = require("../services/marketplaceConsumerProjectionV2.service");

    const [seller, buyer] = await User.create([
      { username: "consumer-seller", passwordHash: "test-hash" },
      { username: "consumer-buyer", passwordHash: "test-hash" },
    ]);
    const organization = await Organization.create({ name: "Consumer organization", createdBy: buyer._id });
    await assignStarterRole({ organization, user: buyer, starterKey: "marketplace_manager" });

    const visit = await createPublishedVisit({ VisitV2, VisitRevisionV2, seller, title: "Visita consumer" });
    const listing = await marketplace.createListing({
      resourceType: "visit",
      resourceId: visit._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    const offer = await marketplace.createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: {
        label: "Esecuzione visita",
        pricing: { type: "free" },
        grants: [{
          resourceType: "visit",
          resourceId: visit._id,
          capability: "visit.execute",
          versionPolicy: "follow_current",
        }],
      },
    });

    const before = await catalog.getListingDetail({ listingId: listing._id, actorUserId: buyer._id });
    assert.equal(before.acquisitionContext.selectedBeneficiary.type, "user");
    assert.equal(before.acquisitionContext.availableBeneficiaries.length, 2);
    assert.equal(before.offers[0].fullyAvailable, false);

    await marketplace.acquireOffer({
      offerId: offer._id,
      actorUserId: buyer._id,
      beneficiaryType: "organization",
      beneficiaryId: organization._id,
    });

    const personal = await catalog.getListingDetail({
      listingId: listing._id,
      actorUserId: buyer._id,
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
    });
    assert.equal(personal.offers[0].fullyAvailable, false, "organization entitlement must not leak into personal context");

    const organizational = await catalog.getListingDetail({
      listingId: listing._id,
      actorUserId: buyer._id,
      beneficiaryType: "organization",
      beneficiaryId: organization._id,
    });
    assert.equal(organizational.offers[0].fullyAvailable, true);
    assert.equal(organizational.offers[0].uses[0].available, true);

    await marketplace.acquireOffer({
      offerId: offer._id,
      actorUserId: buyer._id,
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
    });
    const baseHistory = await marketplace.listAcquisitionHistory({ actorUserId: buyer._id });
    const history = await consumer.enrichAcquisitionHistory({ actorUserId: buyer._id, history: baseHistory });
    assert.equal(history.beneficiary.name, "consumer-buyer");
    assert.equal(history.availableBeneficiaries.some((entry) => entry.name === "Consumer organization"), true);
    assert.equal(history.results[0].currentRights.length, 1);
    assert.equal(history.results[0].currentRights[0].capability, "visit.execute");
    assert.equal(history.results[0].currentRights[0].active, true);
    assert.equal(history.results[0].listingStatus, "published");

    await marketplace.withdrawListing({ listingId: listing._id, actorUserId: seller._id });
    const withdrawnBase = await marketplace.listAcquisitionHistory({ actorUserId: buyer._id });
    const withdrawnHistory = await consumer.enrichAcquisitionHistory({ actorUserId: buyer._id, history: withdrawnBase });
    assert.equal(withdrawnHistory.results[0].listingStatus, "withdrawn");
    assert.equal(withdrawnHistory.results[0].currentRights[0].active, true, "listing withdrawal must not revoke an acquired entitlement");
  });
});
