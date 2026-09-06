const fs = require("fs");
const path = require("path");
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
  parsed.pathname = `/${dbName}_exhibit_slot_lifecycle_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

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

async function fixture() {
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const { createVenue } = require("../services/venue.service");
  const user = await User.create({ username: "slot-lifecycle-user", passwordHash: "test-hash" });
  const organization = await Organization.create({ name: "Slot lifecycle org", createdBy: user._id });
  await assignStarterRole({ organization, user, starterKey: "administrator" });
  const venue = await createVenue({ payload: { name: "Slot lifecycle Venue", ownerOrganizationId: organization._id }, actorUserId: user._id });
  return { user, organization, venue };
}

test("uno slot rimosso dalla working release resta attivo finché la release pubblicata corrente lo usa", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const { createVenueTarget } = require("../services/venueTarget.service");
    const venueReleaseService = require("../services/venueRelease.service");
    const commands = require("../services/venueLayoutCommand.service");
    const { resolveCurrentPublishedPublicCode } = require("../services/sessionPublicLocationV2.service");

    const { user, organization, venue } = await fixture();
    const physical = await createPublishedPhysicalVocabulary({
      userId: user._id,
      ownerType: "organization",
      ownerId: organization._id,
    });
    const roomType = physical.placeTypeByKey.get("room");

    await venueReleaseService.ensureWorkingVenueRelease({
      venueId: venue.id,
      physicalVocabularyRevisionId: physical.revision._id,
      actorUserId: user._id,
    });
    const floor = await commands.addFloor({ venueId: venue.id, actorUserId: user._id, payload: { label: "Piano terra" } });
    const place = await commands.createPlace({
      venueId: venue.id,
      actorUserId: user._id,
      payload: {
        floorId: floor.result.floorId,
        placeTypeDefinitionId: roomType.definitionId,
        label: "Sala A",
        position: { x: 0.5, y: 0.5 },
      },
    });
    const subject = await Subject.create({ preferredLabel: "Opera lifecycle", createdBy: user._id });
    const target = await createVenueTarget({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { subjectId: subject._id, displayLabelOverride: "Opera lifecycle" },
    });
    const createdSlot = await commands.createExhibitSlot({
      venueId: venue.id,
      actorUserId: user._id,
      payload: {
        placeId: place.result.placeId,
        label: "Parete nord",
        approachGuidance: { defaultInstruction: "Guarda la parete nord", overrides: [] },
      },
    });
    const exhibitSlotId = createdSlot.result.exhibitSlotId;
    const publicCode = createdSlot.result.publicCode;
    await commands.assignVenueTargetToExhibitSlot({
      venueId: venue.id,
      venueTargetId: target._id,
      exhibitSlotId,
      actorUserId: user._id,
    });

    await venueReleaseService.submitVenueReleaseReview({ venueId: venue.id, actorUserId: user._id });
    const firstPublication = await venueReleaseService.publishVenueRelease({ venueId: venue.id, actorUserId: user._id });
    const initialLocation = await resolveCurrentPublishedPublicCode({ publicCode });
    assert.equal(initialLocation.location.exhibitSlotId, String(exhibitSlotId));
    assert.equal(initialLocation.location.venueTargetId, String(target._id));

    await venueReleaseService.ensureWorkingVenueRelease({ venueId: venue.id, actorUserId: user._id });
    const beforeRemoval = await Venue.findById(venue.id).lean();
    assert.equal(String(beforeRemoval.publishedReleaseId), String(firstPublication.release._id));
    assert.ok(beforeRemoval.workingReleaseId);

    const removed = await commands.removeExhibitSlot({ venueId: venue.id, exhibitSlotId, actorUserId: user._id });
    assert.equal(removed.layout.exhibitSlots.some((entry) => String(entry.exhibitSlotId) === String(exhibitSlotId)), false);
    const protectedSlot = await ExhibitSlot.findById(exhibitSlotId).lean();
    assert.equal(protectedSlot.lifecycleStatus, "active");
    assert.equal(protectedSlot.trashedAt, null);

    const stillPublished = await resolveCurrentPublishedPublicCode({ publicCode });
    assert.equal(stillPublished.location.exhibitSlotId, String(exhibitSlotId));
    assert.equal(stillPublished.location.venueTargetId, String(target._id));

    await venueReleaseService.submitVenueReleaseReview({ venueId: venue.id, actorUserId: user._id });
    await venueReleaseService.publishVenueRelease({ venueId: venue.id, actorUserId: user._id });

    const retiredSlot = await ExhibitSlot.findById(exhibitSlotId).lean();
    assert.equal(retiredSlot.lifecycleStatus, "trashed");
    assert.ok(retiredSlot.trashedAt);
    assert.equal(String(retiredSlot.trashedBy), String(user._id));
    await assert.rejects(
      () => resolveCurrentPublishedPublicCode({ publicCode }),
      (error) => error?.status === 404 && error?.details?.some((detail) => detail.code === "PUBLIC_LOCATION_NOT_FOUND"),
    );
  });
});
