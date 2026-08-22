const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { capabilitySupportsResource } = require("../config/marketplaceCapabilities");

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

test("capability registry mantiene capability e resource type coerenti", () => {
  assert.equal(capabilitySupportsResource("visit.execute", "visit"), true);
  assert.equal(capabilitySupportsResource("visit.execute", "item_revision"), false);
  assert.equal(capabilitySupportsResource("content.fork", "item_revision"), true);
});

test("free acquisition concede visit.execute senza trasferire ownership", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const Entitlement = require("../models/entitlement.model");
    const { createVisitListing, createVisitExecuteOffer, acquireOffer } = require("../services/marketplaceVisitV2.service");
    const { resolveCapabilityAccess } = require("../services/capabilityAuthorization.service");
    const { listNavigatorLibrary } = require("../services/navigatorVisitV2.service");

    const [seller, buyer] = await User.create([
      { username: "seller-capability", passwordHash: "test-hash" },
      { username: "buyer-capability", passwordHash: "test-hash" },
    ]);
    const visit = await VisitV2.create({ ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visita acquistabile",
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

    const before = await resolveCapabilityAccess({
      actorUserId: buyer._id,
      capability: "visit.execute",
      resourceType: "visit",
      resourceId: visit._id,
    });
    assert.equal(before.allowed, false);

    const listing = await createVisitListing({
      visitId: visit._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    const offer = await createVisitExecuteOffer({ listingId: listing._id, actorUserId: seller._id, payload: {} });
    const acquisition = await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });

    assert.equal(acquisition.alreadyAcquired, false);
    assert.equal(acquisition.entitlements.length, 1);
    assert.equal(acquisition.entitlements[0].capability, "visit.execute");
    assert.equal(String(visit.ownerId), String(seller._id));
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceId: visit._id }), 1);

    const after = await resolveCapabilityAccess({
      actorUserId: buyer._id,
      capability: "visit.execute",
      resourceType: "visit",
      resourceId: visit._id,
    });
    assert.equal(after.allowed, true);
    assert.equal(after.basis, "entitlement");

    const library = await listNavigatorLibrary({ userId: buyer._id });
    assert.deepEqual(library.visits.map((entry) => entry.title), ["Visita acquistabile"]);

    const duplicate = await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    assert.equal(duplicate.alreadyAcquired, true);
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceId: visit._id }), 1);
  });
});
