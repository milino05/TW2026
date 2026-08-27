const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");

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
    const { ensureWorkingVenueRelease, updateWorkingVenueRelease, checkVenueReleaseConsistency, submitVenueReleaseReview, publishVenueRelease, getVenuePhysicalState } = require("../services/venueRelease.service");
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
    const targetA = await createVenueTarget({ venueId, payload: { subjectId: subjectA._id, label: "Opera A in sala" }, actorUserId: user._id });
    const targetB = await createVenueTarget({ venueId, payload: { subjectId: subjectB._id, label: "Opera B in sala" }, actorUserId: user._id });

    const placeA = new mongoose.Types.ObjectId();
    const placeB = new mongoose.Types.ObjectId();
    await ensureWorkingVenueRelease({ venueId, actorUserId: user._id });
    await updateWorkingVenueRelease({
      venueId,
      actorUserId: user._id,
      payload: {
        targetBindings: [
          { venueTargetId: targetA._id, availability: "active", recognitionMedia: [{ url: "https://example.test/a.jpg", altText: "Opera A" }] },
          { venueTargetId: targetB._id, availability: "active", recognitionMedia: [] },
        ],
        preVisitInformation: ["Ingresso principale accessibile"],
        layout: {
          placeTypes: [{ key: "room", label: "Sala", userIntents: [] }],
          routingAttributes: [],
          routingPresets: [],
          floors: [{ key: "f1", label: "Piano 1", map: { imageUrl: "https://example.test/map.png", width: 1000, height: 800 } }],
          places: [
            { _id: placeA, typeKey: "room", label: "Sala A", floorKey: "f1", position: { x: 0.1, y: 0.2 }, attributes: {} },
            { _id: placeB, typeKey: "room", label: "Sala B", floorKey: "f1", position: { x: 0.8, y: 0.2 }, attributes: {} },
          ],
          venueTargetPlacements: [
            { venueTargetId: targetA._id, primaryPlaceId: placeA, placeIds: [placeA] },
            { venueTargetId: targetB._id, primaryPlaceId: placeB, placeIds: [placeB] },
          ],
          connections: [{ fromPlaceId: placeA, toPlaceId: placeB, directionality: "bidirectional", distanceMeters: 12, additionalDelaySeconds: 0, attributes: {}, instructions: { forward: "Prosegui verso Sala B", backward: "Torna verso Sala A" } }],
        },
      },
    });

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

    const route = routeBetweenVenueTargets({ layoutRevision: publicState.layout, fromVenueTargetId: targetA._id, toVenueTargetId: targetB._id });
    assert.equal(route.reachable, true);
    assert.equal(route.distanceMeters, 12);

    const nextWorking = await ensureWorkingVenueRelease({ venueId, actorUserId: user._id });
    assert.equal(nextWorking.release.version, 2);
    const movedPlaces = nextWorking.layout.places.map((place) => ({
      ...(place.toObject ? place.toObject() : place),
      position: String(place._id) === String(placeA) ? { x: 0.45, y: 0.45 } : place.position,
    }));
    await updateWorkingVenueRelease({ venueId, actorUserId: user._id, payload: { layout: { places: movedPlaces } } });

    const stillPublished = await getVenuePhysicalState({ venueId, view: "published" });
    const publishedPlaceA = stillPublished.layout.places.find((place) => String(place._id) === String(placeA));
    assert.equal(publishedPlaceA.position.x, 0.1);
    const workingState = await getVenuePhysicalState({ venueId, view: "working", actorUserId: user._id });
    const workingPlaceA = workingState.layout.places.find((place) => String(place._id) === String(placeA));
    assert.equal(workingPlaceA.position.x, 0.45);
  });
});
