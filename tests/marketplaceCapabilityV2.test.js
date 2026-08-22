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
    assert.equal(acquisition.entitlements[0].resourceType, "visit");
    assert.equal(acquisition.entitlements[0].versionPolicy, "follow_current");
    assert.equal(acquisition.entitlements[0].baselineSnapshotRef.resourceType, "visit_revision");
    assert.equal(String(visit.ownerId), String(seller._id));
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceType: "visit", resourceId: visit._id }), 1);

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
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceType: "visit", resourceId: visit._id }), 1);
  });
});

test("pin_at_acquisition produce un diritto VisitRevision pinned e resta eseguibile dopo una nuova publication", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const Entitlement = require("../models/entitlement.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const { createVisitListing, createVisitExecuteOffer, acquireOffer } = require("../services/marketplaceVisitV2.service");
    const { resolveExecutableVisitRevisionV2 } = require("../services/visitExecutionAccessV2.service");
    const { createExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { listNavigatorLibrary } = require("../services/navigatorVisitV2.service");

    const [seller, buyer] = await User.create([
      { username: "seller-pinned", passwordHash: "test-hash" },
      { username: "buyer-pinned", passwordHash: "test-hash" },
    ]);
    const visit = await createPublishedVisit({
      VisitV2,
      VisitRevisionV2,
      ownerType: "user",
      ownerId: seller._id,
      actorUserId: seller._id,
      title: "Versione acquisita",
    });
    const revision1Id = visit.publishedRevisionId;
    const listing = await createVisitListing({
      visitId: visit._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    const offer = await createVisitExecuteOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: { versionPolicy: "pin_at_acquisition" },
    });
    const acquired = await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });

    const entitlement = await Entitlement.findOne({
      beneficiaryId: buyer._id,
      resourceType: "visit_revision",
      resourceId: revision1Id,
      capability: "visit.execute",
    }).lean();
    assert.ok(entitlement);
    assert.equal(entitlement.versionPolicy, "pinned");
    assert.equal(entitlement.baselineSnapshotRef.resourceType, "visit_revision");
    assert.equal(String(entitlement.baselineSnapshotRef.resourceId), String(revision1Id));
    assert.equal(await Entitlement.countDocuments({ beneficiaryId: buyer._id, resourceType: "visit", resourceId: visit._id }), 0);

    const acquisition = await MarketplaceAcquisition.findById(acquired.acquisition._id).lean();
    assert.equal(acquisition.grantSnapshots[0].resourceType, "visit");
    assert.equal(acquisition.grantSnapshots[0].versionPolicy, "pin_at_acquisition");
    assert.equal(acquisition.grantSnapshots[0].resolvedSnapshotRef.resourceType, "visit_revision");
    assert.equal(String(acquisition.grantSnapshots[0].resolvedSnapshotRef.resourceId), String(revision1Id));

    const libraryBeforeRepublish = await listNavigatorLibrary({ userId: buyer._id });
    assert.deepEqual(libraryBeforeRepublish.visits.map((entry) => entry.title), ["Versione acquisita"]);

    const revision2 = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 2,
      basedOnRevisionId: revision1Id,
      title: "Versione nuova",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    await VisitRevisionV2.updateOne({ _id: revision1Id }, { $set: { status: "superseded" } });
    visit.publishedRevisionId = revision2._id;
    await visit.save();

    const refreshedVisit = await VisitV2.findById(visit._id).lean();
    const resolved = await resolveExecutableVisitRevisionV2({ visit: refreshedVisit, userId: buyer._id });
    assert.equal(String(resolved.revision._id), String(revision1Id));

    const preparation = await createExecutionPreparation({ userId: buyer._id, payload: { visitId: visit._id } });
    assert.equal(preparation.source.versionPolicy, "pinned");
    assert.equal(String(preparation.source.visitRevisionId), String(revision1Id));
  });
});
