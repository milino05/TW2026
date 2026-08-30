const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_venue_lifecycle_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);
function oid() { return new mongoose.Types.ObjectId(); }

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    loadAllModels();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

async function createFixture(prefix) {
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const Subject = require("../models/subject.model");
  const { createVenue } = require("../services/venue.service");
  const user = await User.create({ username: `${prefix}-user`, passwordHash: "test-hash" });
  const organization = await Organization.create({ name: `${prefix} Foundation`, createdBy: user._id });
  await assignStarterRole({ organization, user, starterKey: "administrator" });
  const venue = await createVenue({ payload: { name: `${prefix} Venue`, ownerOrganizationId: organization._id }, actorUserId: user._id });
  const subjects = await Subject.create([
    { preferredLabel: `${prefix} working`, createdBy: user._id },
    { preferredLabel: `${prefix} published`, createdBy: user._id },
    { preferredLabel: `${prefix} visit`, createdBy: user._id },
  ]);
  return { user, organization, venue, subjects };
}

async function createPublishedVisitReference({ userId, venueTargetId, title }) {
  const VisitV2 = require("../models/visitV2.model");
  const VisitRevisionV2 = require("../models/visitRevisionV2.model");
  const visit = await VisitV2.create({ ownerType: "user", ownerId: userId, createdBy: userId });
  const revision = await VisitRevisionV2.create({
    visitId: visit._id,
    version: 1,
    title,
    visitAnchors: [{ venueTargetId }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  visit.publishedRevisionId = revision._id;
  await visit.save();
  return { visit, revision };
}

test("Venue trash/restore preserves physical children and reports only current published Visit impact", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const VenueTarget = require("../models/venueTarget.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const venueService = require("../services/venue.service");
    const { user, venue, subjects } = await createFixture("venue-lifecycle");
    const target = await VenueTarget.create({ venueId: venue.id, subjectId: subjects[0]._id, displayLabelOverride: "Target preservato", createdBy: user._id });
    const current = await createPublishedVisitReference({ userId: user._id, venueTargetId: target._id, title: "Visit corrente" });
    await VisitRevisionV2.create({
      visitId: current.visit._id,
      version: 2,
      title: "Snapshot storico non puntato",
      visitAnchors: [{ venueTargetId: target._id }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });

    const impact = await venueService.getVenueLifecycleImpact({ venueId: venue.id });
    assert.deepEqual(impact, { venueTargetCount: 1, publishedVisitCount: 1 });

    const trashed = await venueService.trashVenue({ venueId: venue.id, actorUserId: user._id });
    assert.equal(trashed.venue.lifecycleStatus, "trashed");
    assert.deepEqual(trashed.impact, impact);
    assert.equal((await VenueTarget.findById(target._id).lean()).lifecycleStatus, "active");
    await assert.rejects(() => venueService.getVenue({ venueId: venue.id }), (error) => error?.status === 404);

    const restored = await venueService.restoreVenue({ venueId: venue.id, actorUserId: user._id });
    assert.equal(restored.venue.lifecycleStatus, "active");
    assert.equal(restored.venue.id.toString(), venue.id.toString());
    assert.equal((await VenueTarget.findById(target._id).lean()).lifecycleStatus, "active");
  });
});

test("VenueTarget trash enforces working, published and current-Visit references and returns committed results", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const { createVenueTarget, trashVenueTarget } = require("../services/venueTarget.service");
    const { detachVenueTargetFromWorkingConfiguration } = require("../services/venueTargetConfigurationCommand.service");
    const { user, organization, venue, subjects } = await createFixture("target-lifecycle");
    const physical = await createPublishedPhysicalVocabulary({ userId: user._id, ownerType: "organization", ownerId: organization._id });
    const placeTypeDefinitionId = physical.placeTypeByKey.get("room").definitionId;

    const [workingTarget, publishedTarget, visitTarget] = await Promise.all(subjects.map((subject, index) => createVenueTarget({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { subjectId: subject._id, displayLabelOverride: ["Working target", "Published target", "Visit target"][index] },
    })));
    const [workingSlot, publishedSlot] = await ExhibitSlot.create([
      { venueId: venue.id, createdBy: user._id },
      { venueId: venue.id, createdBy: user._id },
    ]);

    const publishedFloorId = oid();
    const publishedPlaceId = oid();
    const publishedLayout = await LayoutRevision.create({
      venueId: venue.id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{ _id: publishedFloorId, label: "Pubblicato" }],
      places: [{ _id: publishedPlaceId, floorId: publishedFloorId, placeTypeDefinitionId, label: "Sala pubblicata", position: { x: 0.3, y: 0.3 }, attributeValues: [] }],
      exhibitSlots: [{ exhibitSlotId: publishedSlot._id, placeId: publishedPlaceId, label: "Slot pubblicato" }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const publishedRelease = await VenueRelease.create({
      venueId: venue.id,
      version: 1,
      layoutRevisionId: publishedLayout._id,
      targetBindings: [{ venueTargetId: publishedTarget._id, exhibitSlotId: publishedSlot._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });

    const workingFloorId = oid();
    const workingPlaceId = oid();
    const workingLayout = await LayoutRevision.create({
      venueId: venue.id,
      version: 2,
      basedOnRevisionId: publishedLayout._id,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{ _id: workingFloorId, label: "Bozza" }],
      places: [{ _id: workingPlaceId, floorId: workingFloorId, placeTypeDefinitionId, label: "Sala bozza", position: { x: 0.4, y: 0.4 }, attributeValues: [] }],
      exhibitSlots: [{ exhibitSlotId: workingSlot._id, placeId: workingPlaceId, label: "Slot bozza" }],
      status: "draft",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const mediaUrl = "https://example.test/working-target.jpg";
    const workingRelease = await VenueRelease.create({
      venueId: venue.id,
      version: 2,
      basedOnReleaseId: publishedRelease._id,
      layoutRevisionId: workingLayout._id,
      targetBindings: [{ venueTargetId: workingTarget._id, exhibitSlotId: workingSlot._id, availability: "active", recognitionMedia: [{ url: mediaUrl, altText: "Riconoscimento" }] }],
      status: "draft",
      createdBy: user._id,
      updatedBy: user._id,
    });
    await Venue.updateOne({ _id: venue.id }, { $set: { publishedReleaseId: publishedRelease._id, workingReleaseId: workingRelease._id } });

    await assert.rejects(
      () => trashVenueTarget({ venueId: venue.id, venueTargetId: workingTarget._id, actorUserId: user._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "TARGET_IN_WORKING_RELEASE"),
    );
    const detached = await detachVenueTargetFromWorkingConfiguration({ venueId: venue.id, venueTargetId: workingTarget._id, actorUserId: user._id });
    assert.equal(detached.detached, true);
    assert.equal(detached.removedBinding, true);
    assert.equal(detached.removedPlacement, undefined);
    assert.deepEqual(detached.recognitionMediaUrls, [mediaUrl]);
    const trashedWorkingTarget = await trashVenueTarget({ venueId: venue.id, venueTargetId: workingTarget._id, actorUserId: user._id });
    assert.equal(trashedWorkingTarget.lifecycleStatus, "trashed");

    await assert.rejects(
      () => trashVenueTarget({ venueId: venue.id, venueTargetId: publishedTarget._id, actorUserId: user._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "TARGET_IN_PUBLISHED_RELEASE"),
    );

    await createPublishedVisitReference({ userId: user._id, venueTargetId: visitTarget._id, title: "Visit che conserva il target" });
    await assert.rejects(
      () => trashVenueTarget({ venueId: venue.id, venueTargetId: visitTarget._id, actorUserId: user._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "TARGET_IN_PUBLISHED_VISIT"),
    );

    const refreshedWorkingRelease = await VenueRelease.findById(workingRelease._id).lean();
    const refreshedWorkingLayout = await LayoutRevision.findById(workingLayout._id).lean();
    assert.equal(refreshedWorkingRelease.targetBindings.some((entry) => entry.venueTargetId.equals(workingTarget._id)), false);
    assert.equal(refreshedWorkingLayout.exhibitSlots.some((entry) => entry.exhibitSlotId.equals(workingSlot._id)), true);
    assert.equal(await VenueTarget.countDocuments({ venueId: venue.id }), 3);
  });
});
