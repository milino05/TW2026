const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

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

test("public Venue profile projects only the published layout and active exposed targets", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const { venuePublicProfile } = require("../services/marketplaceDiscoveryV2.service");

    const owner = await User.create({ username: "public-map-owner", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Museo mappa pubblica", createdBy: owner._id });
    const venue = await Venue.create({ name: "Sede con mappa", ownerOrganizationId: organization._id, createdBy: owner._id });
    const [visibleSubject, unavailableSubject] = await Subject.create([
      { preferredLabel: "Opera pubblica", description: "Visibile al pubblico", createdBy: owner._id },
      { preferredLabel: "Opera non disponibile", description: "Temporaneamente assente", createdBy: owner._id },
    ]);
    const [visibleTarget, unavailableTarget] = await VenueTarget.create([
      { venueId: venue._id, subjectId: visibleSubject._id, createdBy: owner._id },
      { venueId: venue._id, subjectId: unavailableSubject._id, createdBy: owner._id },
    ]);
    const [visibleSlot, unavailableSlot] = await ExhibitSlot.create([
      { venueId: venue._id, createdBy: owner._id },
      { venueId: venue._id, createdBy: owner._id },
    ]);

    const publishedFloorId = oid();
    const publishedPlaceId = oid();
    const publishedLayout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: oid(),
      floors: [{
        _id: publishedFloorId,
        label: "Piano pubblico",
        mapAsset: { url: "https://example.test/public-map.png", mimeType: "image/png", width: 1200, height: 800 },
      }],
      places: [{
        _id: publishedPlaceId,
        floorId: publishedFloorId,
        placeTypeDefinitionId: "gallery",
        label: "Sala pubblica",
        position: { x: 0.25, y: 0.35 },
      }],
      connections: [],
      exhibitSlots: [
        { exhibitSlotId: visibleSlot._id, placeId: publishedPlaceId, label: "Parete pubblica", order: 0 },
        { exhibitSlotId: unavailableSlot._id, placeId: publishedPlaceId, label: "Vetrina temporaneamente vuota", order: 1 },
      ],
      status: "published",
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const publishedRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: publishedLayout._id,
      targetBindings: [
        {
          venueTargetId: visibleTarget._id,
          exhibitSlotId: visibleSlot._id,
          availability: "active",
          recognitionMedia: [{ url: "https://example.test/visible.jpg", altText: "Opera pubblica" }],
        },
        {
          venueTargetId: unavailableTarget._id,
          exhibitSlotId: unavailableSlot._id,
          availability: "unavailable",
          recognitionMedia: [{ url: "https://example.test/unavailable.jpg", altText: "Opera non disponibile" }],
        },
      ],
      preVisitInformation: ["Ingresso dal cortile."],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });

    const workingFloorId = oid();
    const workingPlaceId = oid();
    const workingLayout = await LayoutRevision.create({
      venueId: venue._id,
      version: 2,
      authoredAgainstPhysicalVocabularyRevisionId: oid(),
      floors: [{ _id: workingFloorId, label: "BOZZA RISERVATA" }],
      places: [{
        _id: workingPlaceId,
        floorId: workingFloorId,
        placeTypeDefinitionId: "gallery",
        label: "Sala non pubblicata",
        position: { x: 0.8, y: 0.8 },
      }],
      connections: [],
      exhibitSlots: [],
      status: "draft",
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const workingRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 2,
      layoutRevisionId: workingLayout._id,
      targetBindings: [],
      preVisitInformation: ["TESTO BOZZA RISERVATO"],
      status: "draft",
      createdBy: owner._id,
      updatedBy: owner._id,
    });

    venue.publishedReleaseId = publishedRelease._id;
    venue.workingReleaseId = workingRelease._id;
    await venue.save();

    const projection = await venuePublicProfile({ venueId: venue._id });
    assert.equal(projection.venue.name, "Sede con mappa");
    assert.equal(projection.venue.version, 1);
    assert.deepEqual(projection.venue.preVisitInformation, ["Ingresso dal cortile."]);
    assert.equal(String(projection.map.layoutRevisionId), String(publishedLayout._id));
    assert.equal(projection.map.version, 1);
    assert.deepEqual(projection.map.floors.map((floor) => floor.label), ["Piano pubblico"]);
    assert.deepEqual(projection.map.places.map((place) => place.label), ["Sala pubblica"]);
    assert.equal(projection.map.floors.some((floor) => floor.label === "BOZZA RISERVATA"), false);
    assert.equal(projection.map.places.some((place) => place.label === "Sala non pubblicata"), false);
    assert.equal(projection.venue.preVisitInformation.includes("TESTO BOZZA RISERVATO"), false);

    assert.equal(projection.targets.length, 1, "solo i target esposti e disponibili sono pubblici");
    assert.equal(String(projection.targets[0].id), String(visibleTarget._id));
    assert.equal(projection.targets[0].label, "Opera pubblica");
    assert.equal(projection.targets[0].recognitionMedia.length, 1);
    assert.equal(String(projection.targets[0].exhibitSlotId), String(visibleSlot._id));

    const publicVisibleSlot = projection.map.exhibitSlots.find((slot) => String(slot.id) === String(visibleSlot._id));
    const publicUnavailableSlot = projection.map.exhibitSlots.find((slot) => String(slot.id) === String(unavailableSlot._id));
    assert.equal(String(publicVisibleSlot.assignedVenueTargetId), String(visibleTarget._id));
    assert.equal(publicUnavailableSlot.assignedVenueTargetId, null, "un target non disponibile non deve essere esposto sulla mappa pubblica");
  });
});