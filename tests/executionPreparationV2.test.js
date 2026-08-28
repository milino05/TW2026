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

test("una preparation Navigator e blocked se una floor usata non ha asset cartografico", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const { createExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

    const owner = await User.create({ username: "prep-map-owner", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Map readiness org", createdBy: owner._id });
    const subject = await Subject.create({ preferredLabel: "Map subject", createdBy: owner._id });
    const venue = await Venue.create({ name: "Map readiness Venue", ownerOrganizationId: organization._id, createdBy: owner._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, label: "Map target", createdBy: owner._id });
    const physical = await createPublishedPhysicalVocabulary({ userId: owner._id });
    const floorId = new mongoose.Types.ObjectId();
    const placeId = new mongoose.Types.ObjectId();
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: placeId, placeTypeDefinitionId: physical.placeTypeByKey.get("room").definitionId, label: "Sala mappa", floorId, position: { x: 0.5, y: 0.5 } }],
      venueTargetPlacements: [{ venueTargetId: target._id, primaryPlaceId: placeId, placeIds: [placeId] }],
      connections: [],
      status: "published",
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const release = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: [{ venueTargetId: target._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    venue.publishedReleaseId = release._id;
    await venue.save();

    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visit senza asset mappa",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [{ venueTargetId: target._id }],
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
    assert.equal(preparation.readiness.blockers[0].code, "NAVIGATOR_MAP_ASSET_MISSING");
    assert.match(preparation.readiness.blockers[0].message, /Piano terra/);
    assert.equal(preparation.logisticsPreview.routeSummary.stopCount, 1);
  });
});
