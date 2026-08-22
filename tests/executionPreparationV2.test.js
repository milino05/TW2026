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

test("start rifiuta una preparation quando il diritto sulla VisitRevision preparata viene revocato", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const Entitlement = require("../models/entitlement.model");
    const {
      createExecutionPreparation,
      startExecutionPreparation,
    } = require("../services/executionPreparationV2.service");

    const [owner, visitor] = await User.create([
      { username: "prep-owner", passwordHash: "test-hash" },
      { username: "prep-visitor", passwordHash: "test-hash" },
    ]);
    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Pinned preparation",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const entitlement = await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: visitor._id,
      resourceType: "visit",
      resourceId: visit._id,
      capability: "visit.execute",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "visit_revision", resourceId: revision._id },
    });
    const preparation = await createExecutionPreparation({ userId: visitor._id, payload: { visitId: visit._id } });
    assert.equal(preparation.source.versionPolicy, "pinned");
    assert.equal(String(preparation.source.visitRevisionId), String(revision._id));

    entitlement.status = "revoked";
    await entitlement.save();

    await assert.rejects(
      () => startExecutionPreparation({
        preparationId: preparation.id,
        userId: visitor._id,
        expectedVersion: preparation.version,
      }),
      (error) => error?.status === 403 && error?.details?.[0]?.code === "PREPARATION_SOURCE_AUTHORIZATION_CHANGED",
    );
  });
});

test("un errore fisico noto produce readiness blocked e impedisce lo start", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const {
      createExecutionPreparation,
      startExecutionPreparation,
    } = require("../services/executionPreparationV2.service");

    const owner = await User.create({ username: "prep-blocked-owner", passwordHash: "test-hash" });
    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const missingVenueTargetId = new mongoose.Types.ObjectId();
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Blocked preparation",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [{ venueTargetId: missingVenueTargetId }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const preparation = await createExecutionPreparation({ userId: owner._id, payload: { visitId: visit._id } });
    assert.equal(preparation.readiness.status, "blocked");
    assert.equal(preparation.readiness.blockers[0].code, "VENUE_TARGET_MISSING_AT_SESSION_START");
    assert.equal(preparation.logisticsPreview.estimatedTotalSeconds, 0);

    await assert.rejects(
      () => startExecutionPreparation({
        preparationId: preparation.id,
        userId: owner._id,
        expectedVersion: preparation.version,
      }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "PREPARATION_NOT_READY",
    );
  });
});
