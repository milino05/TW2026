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
  parsed.pathname = `/${dbName}_venue_creation`;
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
  const user = await User.create({ username: `${prefix}-user`, passwordHash: "test-hash" });
  const organization = await Organization.create({ name: `${prefix} Foundation`, createdBy: user._id });
  await assignStarterRole({ organization, user, starterKey: "administrator" });
  return { user, organization };
}

test("configured Venue creation requires and pins an existing PhysicalVocabulary revision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const Venue = require("../models/venue.model");
    const VenueRelease = require("../models/venueRelease.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const { getVenueCreationPreflight, createConfiguredVenue } = require("../services/venueCreation.service");
    const { user, organization } = await fixture("configured");
    const physical = await createPublishedPhysicalVocabulary({
      userId: user._id,
      ownerType: "organization",
      ownerId: organization._id,
      name: "Vocabolario fisico disponibile",
    });

    const preflight = await getVenueCreationPreflight({ organizationId: organization._id, actorUserId: user._id });
    assert.equal(preflight.allowed, true);
    assert.equal(preflight.choices.length, 1);
    assert.equal(String(preflight.choices[0].physicalVocabularyRevisionId), String(physical.revision._id));

    const created = await createConfiguredVenue({
      actorUserId: user._id,
      payload: {
        ownerOrganizationId: organization._id,
        name: "Museo configurato",
        description: "Sede creata dal nuovo task applicativo.",
        physicalVocabularyRevisionId: physical.revision._id,
      },
    });

    const venue = await Venue.findById(created.venue.id).lean();
    assert.ok(venue);
    assert.ok(venue.workingReleaseId);
    const release = await VenueRelease.findById(venue.workingReleaseId).lean();
    assert.ok(release);
    const layout = await LayoutRevision.findById(release.layoutRevisionId).lean();
    assert.ok(layout);
    assert.equal(String(layout.authoredAgainstPhysicalVocabularyRevisionId), String(physical.revision._id));
    assert.equal(String(created.physicalVocabularyRevisionId), String(physical.revision._id));
  });
});

test("Venue creation preflight blocks creation when no PhysicalVocabulary is usable", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const Venue = require("../models/venue.model");
    const { getVenueCreationPreflight, createConfiguredVenue } = require("../services/venueCreation.service");
    const { user, organization } = await fixture("blocked");

    const preflight = await getVenueCreationPreflight({ organizationId: organization._id, actorUserId: user._id });
    assert.equal(preflight.allowed, false);
    assert.equal(preflight.choices.length, 0);
    assert.ok(preflight.blockers.some((blocker) => blocker.code === "PHYSICAL_VOCABULARY_REQUIRED"));

    await assert.rejects(
      () => createConfiguredVenue({
        actorUserId: user._id,
        payload: {
          ownerOrganizationId: organization._id,
          name: "Sede da bloccare",
          physicalVocabularyRevisionId: new mongoose.Types.ObjectId(),
        },
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "PHYSICAL_VOCABULARY_REQUIRED"),
    );
    assert.equal(await Venue.countDocuments({ ownerOrganizationId: organization._id }), 0);
  });
});

test("configured Venue creation rejects a revision outside the usable choices without leaving a Venue", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Venue = require("../models/venue.model");
    const { createConfiguredVenue } = require("../services/venueCreation.service");
    const { user, organization } = await fixture("selection");
    await createPublishedPhysicalVocabulary({ userId: user._id, ownerType: "organization", ownerId: organization._id, name: "Consentito" });

    const outsider = await User.create({ username: "selection-outsider", passwordHash: "test-hash" });
    const unavailable = await createPublishedPhysicalVocabulary({ userId: outsider._id, ownerType: "user", ownerId: outsider._id, name: "Non disponibile" });

    await assert.rejects(
      () => createConfiguredVenue({
        actorUserId: user._id,
        payload: {
          ownerOrganizationId: organization._id,
          name: "Sede con scelta non valida",
          physicalVocabularyRevisionId: unavailable.revision._id,
        },
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "PHYSICAL_VOCABULARY_NOT_USABLE"),
    );
    assert.equal(await Venue.countDocuments({ ownerOrganizationId: organization._id }), 0);
  });
});
