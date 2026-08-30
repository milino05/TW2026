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

test("Marketplace discovery projects only published Venue state and keeps publisher separate from physical relevance", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Organization = require("../models/organization.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const Subject = require("../models/subject.model");
    const VenueRelease = require("../models/venueRelease.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const {
      organizationDirectory,
      organizationPublicProfile,
      venueDirectory,
      venuePublicProfile,
    } = require("../services/marketplaceDiscoveryV2.service");

    const actorId = oid();
    const organization = await Organization.create({
      name: "Musei Demo",
      description: "Rete culturale",
      createdBy: actorId,
    });
    const [publishedVenue, workingVenue] = await Venue.create([
      { name: "Sede pubblica", description: "Visitabile", ownerOrganizationId: organization._id, createdBy: actorId },
      { name: "Sede in preparazione", description: "Non pubblica", ownerOrganizationId: organization._id, createdBy: actorId },
    ]);
    const [activeSubject, unavailableSubject] = await Subject.create([
      { preferredLabel: "Opera pubblica", description: "Visibile", createdBy: actorId },
      { preferredLabel: "Opera non disponibile", description: "Nascosta", createdBy: actorId },
    ]);
    const [activeTarget, unavailableTarget] = await VenueTarget.create([
      { venueId: publishedVenue._id, subjectId: activeSubject._id, createdBy: actorId },
      { venueId: publishedVenue._id, subjectId: unavailableSubject._id, createdBy: actorId },
    ]);
    const release = await VenueRelease.create({
      venueId: publishedVenue._id,
      version: 1,
      layoutRevisionId: oid(),
      status: "published",
      targetBindings: [
        { venueTargetId: activeTarget._id, exhibitSlotId: oid(), availability: "active", recognitionMedia: [{ url: "https://example.test/opera.jpg", altText: "Opera" }] },
        { venueTargetId: unavailableTarget._id, exhibitSlotId: oid(), availability: "unavailable" },
      ],
      preVisitInformation: ["Presentarsi dieci minuti prima"],
      createdBy: actorId,
      updatedBy: actorId,
    });
    publishedVenue.publishedReleaseId = release._id;
    await publishedVenue.save();

    const organizationListing = await MarketplaceListing.create({
      sellerType: "organization",
      sellerId: organization._id,
      resourceType: "visit",
      resourceId: oid(),
      title: "Visita della rete",
      summary: "Pubblicazione editoriale",
      status: "published",
      createdBy: actorId,
    });
    await MarketplaceOffer.create({
      listingId: organizationListing._id,
      label: "Accesso alla visita",
      pricing: { type: "free" },
      grants: [{ resourceType: "visit", resourceId: organizationListing.resourceId, capability: "visit.execute", versionPolicy: "follow_current" }],
      status: "active",
      createdBy: actorId,
    });
    await MarketplaceListing.create({
      sellerType: "user",
      sellerId: oid(),
      resourceType: "visit",
      resourceId: oid(),
      title: "Visita di un autore esterno",
      summary: "Non è una pubblicazione dell'organizzazione",
      status: "published",
      createdBy: actorId,
    });

    const venues = await venueDirectory();
    assert.equal(venues.total, 1);
    assert.equal(venues.results[0].name, "Sede pubblica");
    assert.equal(venues.results[0].organization.name, "Musei Demo");

    const publicVenue = await venuePublicProfile({ venueId: publishedVenue._id });
    assert.equal(publicVenue.venue.version, 1);
    assert.deepEqual(publicVenue.venue.preVisitInformation, ["Presentarsi dieci minuti prima"]);
    assert.equal(publicVenue.targets.length, 1);
    assert.equal(publicVenue.targets[0].label, "Opera pubblica");
    assert.deepEqual(publicVenue.targets[0].recognitionMedia, [{ url: "https://example.test/opera.jpg", altText: "Opera" }]);
    await assert.rejects(() => venuePublicProfile({ venueId: workingVenue._id }), /Sede pubblica non trovata/);

    const organizations = await organizationDirectory();
    assert.equal(organizations.total, 1);
    assert.deepEqual(organizations.results[0].counts, { venues: 1, publications: 1 });

    const publicOrganization = await organizationPublicProfile({ organizationId: organization._id });
    assert.deepEqual(publicOrganization.venues.map((entry) => entry.name), ["Sede pubblica"]);
    assert.deepEqual(publicOrganization.publications.map((entry) => entry.title), ["Visita della rete"]);
  });
});
