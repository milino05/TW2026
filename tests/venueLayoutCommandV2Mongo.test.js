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
  parsed.pathname = `/${dbName}_venue_layout_commands`;
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

async function fixture(prefix) {
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const { createVenue } = require("../services/venue.service");
  const user = await User.create({ username: `${prefix}-user`, passwordHash: "test-hash" });
  const organization = await Organization.create({ name: `${prefix} Foundation`, createdBy: user._id });
  await assignStarterRole({ organization, user, starterKey: "administrator" });
  const venue = await createVenue({ payload: { name: `${prefix} Venue`, ownerOrganizationId: organization._id }, actorUserId: user._id });
  return { user, organization, venue };
}

test("first Venue onboarding can create the starter PhysicalVocabulary and pin it to the Layout", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const PhysicalVocabulary = require("../models/physicalVocabulary.model");
    const { getVenuePhysicalOnboarding, initializeVenuePhysicalConfiguration } = require("../services/venuePhysicalOnboarding.service");
    const { user, organization, venue } = await fixture("onboarding");

    const projection = await getVenuePhysicalOnboarding({ venueId: venue.id, actorUserId: user._id });
    assert.equal(projection.required, true);
    assert.equal(projection.canCreate, true);
    assert.equal(projection.recommendedMode, "starter");
    assert.equal(projection.choices.length, 0);

    await assert.rejects(
      () => initializeVenuePhysicalConfiguration({
        venueId: venue.id,
        actorUserId: user._id,
        payload: { mode: "starter", unexpected: true },
      }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "UNKNOWN_FIELD" && detail.field === "unexpected"),
    );

    const initialized = await initializeVenuePhysicalConfiguration({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { mode: "starter", name: "Vocabolario fisico onboarding" },
    });
    assert.equal(initialized.release.status, "draft");
    assert.ok(initialized.layout.authoredAgainstPhysicalVocabularyRevisionId);
    assert.equal(String(initialized.onboarding.createdPhysicalVocabularyRevisionId), String(initialized.layout.authoredAgainstPhysicalVocabularyRevisionId));

    const vocabulary = await PhysicalVocabulary.findById(initialized.onboarding.createdPhysicalVocabularyId).lean();
    assert.equal(vocabulary.ownerType, "organization");
    assert.equal(String(vocabulary.ownerId), String(organization._id));
  });
});

test("Venue layout commands preserve ids, pinned vocabulary semantics and metric recalculation", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const Subject = require("../models/subject.model");
    const { createVenueTarget } = require("../services/venueTarget.service");
    const { ensureWorkingVenueRelease, getVenuePhysicalState } = require("../services/venueRelease.service");
    const commands = require("../services/venueLayoutCommand.service");
    const { user, organization, venue } = await fixture("commands");
    const physical = await createPublishedPhysicalVocabulary({ userId: user._id, ownerType: "organization", ownerId: organization._id });
    const roomType = physical.placeTypeByKey.get("room");
    const passageType = physical.connectionTypeByKey.get("corridor") || physical.revision.connectionTypes[0];
    await ensureWorkingVenueRelease({ venueId: venue.id, physicalVocabularyRevisionId: physical.revision._id, actorUserId: user._id });

    await assert.rejects(
      () => commands.addFloor({ venueId: venue.id, actorUserId: user._id, payload: { label: "Non valida", legacySnapshot: {} } }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "UNKNOWN_FIELD" && detail.field === "legacySnapshot"),
    );
    await assert.rejects(
      () => commands.setManagedFloorPlan({
        venueId: venue.id,
        floorId: new mongoose.Types.ObjectId(),
        actorUserId: user._id,
        mapAsset: { url: "https://example.test/map.png", mimeType: "image/png", width: 1000, height: 1000, rawPath: "/tmp/map" },
      }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "UNKNOWN_FIELD" && detail.field === "mapAsset.rawPath"),
    );

    const floorResult = await commands.addFloor({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { label: "Piano terra" },
    });
    const floorId = floorResult.result.floorId;
    await commands.setManagedFloorPlan({
      venueId: venue.id,
      floorId,
      actorUserId: user._id,
      mapAsset: { url: "https://example.test/map.png", mimeType: "image/png", width: 1000, height: 1000 },
    });
    await commands.calibrateFloor({
      venueId: venue.id,
      floorId,
      actorUserId: user._id,
      payload: { method: "line", distanceMeters: 80, line: { from: { x: 0.1, y: 0.1 }, to: { x: 0.9, y: 0.1 } } },
    });

    const first = await commands.createPlace({ venueId: venue.id, actorUserId: user._id, payload: { floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala A", position: { x: 0.1, y: 0.5 } } });
    const second = await commands.createPlace({ venueId: venue.id, actorUserId: user._id, payload: { floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala B", position: { x: 0.9, y: 0.5 } } });
    const placeA = first.result.placeId;
    const placeB = second.result.placeId;

    await assert.rejects(
      () => commands.createConnection({
        venueId: venue.id,
        actorUserId: user._id,
        payload: { fromPlaceId: placeA, toPlaceId: placeB, metricMode: "manual_override", distanceMeters: 10, additionalDelaySeconds: -1 },
      }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "INVALID_DELAY"),
    );

    const connected = await commands.createConnection({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { fromPlaceId: placeA, toPlaceId: placeB, connectionTypeDefinitionId: passageType?.definitionId || null, metricMode: "geometry_derived", directionality: "bidirectional" },
    });
    const connectionId = connected.result.connectionId;
    let connection = connected.layout.connections.find((entry) => String(entry._id) === String(connectionId));
    assert.ok(Math.abs(connection.distanceMeters - 80) < 0.001);

    const moved = await commands.movePlace({ venueId: venue.id, placeId: placeB, actorUserId: user._id, payload: { position: { x: 0.5, y: 0.5 } } });
    connection = moved.layout.connections.find((entry) => String(entry._id) === String(connectionId));
    assert.ok(Math.abs(connection.distanceMeters - 40) < 0.001);
    assert.equal(connection.geometry.points.at(-1).x, 0.5);

    const subject = await Subject.create({ preferredLabel: "Opera command", createdBy: user._id });
    const target = await createVenueTarget({ venueId: venue.id, actorUserId: user._id, payload: { subjectId: subject._id, label: "Opera command" } });
    const bindingCommands = require("../services/venueTargetBindingCommand.service");
    await assert.rejects(
      () => bindingCommands.setAvailability({ venueId: venue.id, venueTargetId: target._id, actorUserId: user._id, payload: { availability: "active", legacy: true } }),
      (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "UNKNOWN_FIELD" && detail.field === "legacy"),
    );
    await commands.setVenueTargetPlacement({ venueId: venue.id, venueTargetId: target._id, actorUserId: user._id, payload: { primaryPlaceId: placeA } });
    await commands.setPreVisitInformation({ venueId: venue.id, actorUserId: user._id, payload: { items: ["Ingresso dal cortile"] } });

    const state = await getVenuePhysicalState({ venueId: venue.id, view: "working", actorUserId: user._id });
    assert.equal(state.release.preVisitInformation[0], "Ingresso dal cortile");
    assert.equal(state.release.targetBindings.length, 1);
    assert.equal(state.layout.venueTargetPlacements.length, 1);
    assert.equal(state.release.integrity.status, "needs_review");
    assert.equal(String(state.layout.authoredAgainstPhysicalVocabularyRevisionId), String(physical.revision._id));

    await assert.rejects(
      commands.removePlace({ venueId: venue.id, placeId: placeA, actorUserId: user._id }),
      (error) => error.status === 409 && error.details?.some((detail) => detail.code === "PLACE_HAS_CONNECTIONS"),
    );
  });
});

test("a Venue può iniziare da una revisione fisica pinned anche dopo il trash della risorsa live", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Entitlement = require("../models/entitlement.model");
    const physicalVocabularyService = require("../services/physicalVocabulary.service");
    const { getVenuePhysicalOnboarding, initializeVenuePhysicalConfiguration } = require("../services/venuePhysicalOnboarding.service");
    const sourceOwner = await User.create({ username: "licensed-physical-source", passwordHash: "test-hash" });
    const { user, organization, venue } = await fixture("licensed-physical-target");
    const physical = await createPublishedPhysicalVocabulary({ userId: sourceOwner._id });
    await Entitlement.create({
      beneficiaryType: "organization",
      beneficiaryId: organization._id,
      resourceType: "physical_vocabulary",
      resourceId: physical.physicalVocabulary._id,
      capability: "physical_vocabulary.author",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "physical_vocabulary_revision", resourceId: physical.revision._id },
    });
    await physicalVocabularyService.trashPhysicalVocabulary({
      physicalVocabularyId: physical.physicalVocabulary._id,
      actorUserId: sourceOwner._id,
    });

    const onboarding = await getVenuePhysicalOnboarding({ venueId: venue.id, actorUserId: user._id });
    assert.equal(onboarding.choices.length, 1);
    assert.equal(onboarding.choices[0].basis, "license");
    assert.equal(String(onboarding.choices[0].physicalVocabularyRevisionId), String(physical.revision._id));

    const initialized = await initializeVenuePhysicalConfiguration({
      venueId: venue.id,
      actorUserId: user._id,
      payload: { mode: "existing", physicalVocabularyRevisionId: physical.revision._id },
    });
    assert.equal(String(initialized.layout.authoredAgainstPhysicalVocabularyRevisionId), String(physical.revision._id));
  });
});

test("richieste concorrenti riusano una sola working VenueRelease atomica", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const Venue = require("../models/venue.model");
    const VenueRelease = require("../models/venueRelease.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const { ensureWorkingVenueRelease } = require("../services/venueRelease.service");
    const { user, organization, venue } = await fixture("working-release-race");
    const physical = await createPublishedPhysicalVocabulary({
      userId: user._id,
      ownerType: "organization",
      ownerId: organization._id,
    });

    const results = await Promise.all(Array.from({ length: 4 }, () => ensureWorkingVenueRelease({
      venueId: venue.id,
      physicalVocabularyRevisionId: physical.revision._id,
      actorUserId: user._id,
    })));

    assert.equal(new Set(results.map((entry) => String(entry.release._id))).size, 1);
    assert.equal(new Set(results.map((entry) => String(entry.layout._id))).size, 1);
    assert.equal(await VenueRelease.countDocuments({ venueId: venue.id }), 1);
    assert.equal(await LayoutRevision.countDocuments({ venueId: venue.id }), 1);
    const persistedVenue = await Venue.findById(venue.id).lean();
    assert.equal(String(persistedVenue.workingReleaseId), String(results[0].release._id));
  });
});
