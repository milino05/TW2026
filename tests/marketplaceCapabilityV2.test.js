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

async function createPublishedVisit({ VisitV2, VisitRevisionV2, ownerType, ownerId, actorUserId, title }) {
  const visit = await VisitV2.create({ ownerType, ownerId, createdBy: actorUserId });
  const revision = await VisitRevisionV2.create({
    visitId: visit._id,
    version: 1,
    title,
    editorialSources: [],
    contentEntries: [],
    visitAnchors: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: actorUserId },
    publication: { publishedAt: new Date(), publishedBy: actorUserId },
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  visit.publishedRevisionId = revision._id;
  await visit.save();
  return visit;
}

test("capability registry mantiene capability e resource type coerenti", () => {
  assert.equal(capabilitySupportsResource("visit.execute", "visit"), true);
  assert.equal(capabilitySupportsResource("visit.execute", "item_revision"), false);
  assert.equal(capabilitySupportsResource("content.fork", "item_revision"), true);
});

test("free acquisition concede visit.execute senza trasferire ownership", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
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
    const visit = await createPublishedVisit({
      VisitV2,
      VisitRevisionV2,
      ownerType: "user",
      ownerId: seller._id,
      actorUserId: seller._id,
      title: "Visita acquistabile",
    });

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

    const organization = await Organization.create({ name: "Organization test", createdBy: seller._id });
    buyer.organizationMemberships = [{ organizationId: organization._id, role: "operator", assignedBy: seller._id }];
    await buyer.save();
    const organizationVisit = await createPublishedVisit({
      VisitV2,
      VisitRevisionV2,
      ownerType: "organization",
      ownerId: organization._id,
      actorUserId: seller._id,
      title: "Visita organizzativa",
    });
    const organizationAccess = await resolveCapabilityAccess({
      actorUserId: buyer._id,
      capability: "visit.execute",
      resourceType: "visit",
      resourceId: organizationVisit._id,
    });
    assert.equal(organizationAccess.allowed, true);
    assert.equal(organizationAccess.basis, "principal_authority");

    const library = await listNavigatorLibrary({ userId: buyer._id });
    assert.deepEqual(library.visits.map((entry) => entry.title), ["Visita acquistabile"]);

    const duplicate = await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    assert.equal(duplicate.alreadyAcquired, true);
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceId: visit._id }), 1);
  });
});
