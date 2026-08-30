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
  parsed.pathname = `/${dbName}_venue_v2`;
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

test("VenueRelease publishes immutable physical state around VenueTarget", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const { createVenue } = require("../services/venue.service");
    const { createVenueTarget, listVenueTargets } = require("../services/venueTarget.service");
    const { ensureWorkingVenueRelease, checkVenueReleaseConsistency, submitVenueReleaseReview, publishVenueRelease, getVenuePhysicalState } = require("../services/venueRelease.service");
    const layoutCommands = require("../services/venueLayoutCommand.service");
    const bindingCommands = require("../services/venueTargetBindingCommand.service");
    const { routeBetweenVenueTargets } = require("../services/venueRouting.service");

    const user = await User.create({ username: "venue-v2-test", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Museum Foundation", createdBy: user._id });
    await assignStarterRole({ organization, user, starterKey: "administrator" });
    const [subjectA, subjectB] = await Subject.create([
      { preferredLabel: "Opera A", createdBy: user._id },
      { preferredLabel: "Opera B", createdBy: user._id },
    ]);

    const venue = await createVenue({ payload: { name: "Venue test", ownerOrganizationId: organization._id }, actorUserId: user._id });
    const venueId = venue.id;
    const physical = await createPublishedPhysicalVocabulary({ userId: user._id, ownerType: "organization", ownerId: organization._id });
    const roomType = physical.placeTypeByKey.get("room");
    const targetA = await createVenueTarget({ venueId, payload: { subjectId: subjectA._id, displayLabelOverride: "Opera A in sala" }, actorUserId: user._id });
    const targetB = await createVenueTarget({ venueId, payload: { subjectId: subjectB._id, displayLabelOverride: "Opera B in sala" }, actorUserId: user._id });

    await ensureWorkingVenueRelease({ venueId, physicalVocabularyRevisionId: physical.revision._id, actorUserId: user._id });
    const floorResult = await layoutCommands.addFloor({
      venueId,
      actorUserId: user._id,
      payload: { label: "Piano 1" },
    });
    const floorId = floorResult.result.floorId;
    await layoutCommands.setManagedFloorPlan({
      venueId,
      floorId,
      actorUserId: user._id,
      mapAsset: { url: "https://example.test/map.png", mimeType: "image/png", width: 1000, height: 800 },
    });
    const placeAResult = await layoutCommands.createPlace({
      venueId,
      actorUserId: user._id,
      payload: { floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala A", position: { x: 0.1, y: 0.2 } },
    });
    const placeBResult = await layoutCommands.createPlace({
      venueId,
      actorUserId: user._id,
      payload: { floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala B", position: { x: 0.8, y: 0.2 } },
    });
    const placeA = placeAResult.result.placeId;
    const placeB = placeBResult.result.placeId;
    await layoutCommands.createConnection({
      venueId,
      actorUserId: user._id,
      payload: {
        fromPlaceId: placeA,
        toPlaceId: placeB,
        directionality: "bidirectional",
        metricMode: "manual_override",
        distanceMeters: 12,
        instructions: { forward: "Prosegui verso Sala B", backward: "Torna verso Sala A" },
      },
    });
    await bindingCommands.setAvailability({ venueId, venueTargetId: targetA._id, actorUserId: user._id, payload: { availability: "active" } });
    await bindingCommands.setAvailability({ venueId, venueTargetId: targetB._id, actorUserId: user._id, payload: { availability: "active" } });
    await bindingCommands.addRecognitionMedia({ venueId, venueTargetId: targetA._id, actorUserId: user._id, payload: { url: "https://example.test/a.jpg", altText: "Opera A" } });
    const slotA = await layoutCommands.createExhibitSlot({ venueId, actorUserId: user._id, payload: { placeId: placeA, label: "Slot A" } });
    const slotB = await layoutCommands.createExhibitSlot({ venueId, actorUserId: user._id, payload: { placeId: placeB, label: "Slot B" } });
    await layoutCommands.assignVenueTargetToExhibitSlot({ venueId, venueTargetId: targetA._id, exhibitSlotId: slotA.result.exhibitSlotId, actorUserId: user._id });
    await layoutCommands.assignVenueTargetToExhibitSlot({ venueId, venueTargetId: targetB._id, exhibitSlotId: slotB.result.exhibitSlotId, actorUserId: user._id });
    await layoutCommands.setPreVisitInformation({ venueId, actorUserId: user._id, payload: { items: ["Ingresso principale accessibile"] } });

    const checked = await checkVenueReleaseConsistency({ venueId, actorUserId: user._id });
    assert.equal(checked.release.integrity.status, "valid");
    await submitVenueReleaseReview({ venueId, actorUserId: user._id });
    const published = await publishVenueRelease({ venueId, actorUserId: user._id });
    assert.equal(published.release.status, "published");
    assert.equal(published.layout.status, "published");

    const publicState = await getVenuePhysicalState({ venueId, view: "published" });
    assert.equal(publicState.venue.workingReleaseId, undefined);
    assert.equal(publicState.release.targetBindings.length, 2);
    assert.equal(publicState.release.targetBindings[0].recognitionMedia[0].url, "https://example.test/a.jpg");
    const publicTargets = await listVenueTargets({ venueId });
    assert.equal(publicTargets.length, 2);

    const route = routeBetweenVenueTargets({ layoutRevision: publicState.layout, venueRelease: publicState.release, fromVenueTargetId: targetA._id, toVenueTargetId: targetB._id });
    assert.equal(route.reachable, true);
    assert.equal(route.distanceMeters, 12);

    const nextWorking = await ensureWorkingVenueRelease({ venueId, actorUserId: user._id });
    assert.equal(nextWorking.release.version, 2);
    await layoutCommands.movePlace({ venueId, placeId: placeA, actorUserId: user._id, payload: { position: { x: 0.45, y: 0.45 } } });

    const stillPublished = await getVenuePhysicalState({ venueId, view: "published" });
    const publishedPlaceA = stillPublished.layout.places.find((place) => String(place._id) === String(placeA));
    assert.equal(publishedPlaceA.position.x, 0.1);
    const workingState = await getVenuePhysicalState({ venueId, view: "working", actorUserId: user._id });
    const workingPlaceA = workingState.layout.places.find((place) => String(place._id) === String(placeA));
    assert.equal(workingPlaceA.position.x, 0.45);
  });
});
