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

test("live Visit relevance follows only its current published revision while historical VisitRevision remains independently discoverable", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const { listCatalog } = require("../services/marketplaceCatalogV2.service");

    const user = await User.create({ username: "visit-version-relevance", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Rete versioni", createdBy: user._id });
    const [subjectA, subjectB] = await Subject.create([
      { preferredLabel: "Opera A", createdBy: user._id },
      { preferredLabel: "Opera B", createdBy: user._id },
    ]);
    const [venueA, venueB] = await Venue.create([
      { name: "Venue A", ownerOrganizationId: organization._id, createdBy: user._id },
      { name: "Venue B", ownerOrganizationId: organization._id, createdBy: user._id },
    ]);
    const [targetA, targetB] = await VenueTarget.create([
      { venueId: venueA._id, subjectId: subjectA._id, displayLabelOverride: "Target A", createdBy: user._id },
      { venueId: venueB._id, subjectId: subjectB._id, displayLabelOverride: "Target B", createdBy: user._id },
    ]);

    const visit = await VisitV2.create({ ownerType: "user", ownerId: user._id, createdBy: user._id });
    const revisionA = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Versione storica A",
      visitAnchors: [{ venueTargetId: targetA._id }],
      status: "superseded",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const revisionB = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 2,
      basedOnRevisionId: revisionA._id,
      title: "Versione corrente B",
      visitAnchors: [{ venueTargetId: targetB._id }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    visit.publishedRevisionId = revisionB._id;
    await visit.save();

    const listings = await MarketplaceListing.create([
      {
        sellerType: "user",
        sellerId: user._id,
        resourceType: "visit",
        resourceId: visit._id,
        title: "Visit live",
        status: "published",
        createdBy: user._id,
      },
      {
        sellerType: "user",
        sellerId: user._id,
        resourceType: "visit_revision",
        resourceId: revisionA._id,
        title: "Visit snapshot A",
        status: "published",
        createdBy: user._id,
      },
    ]);
    await MarketplaceOffer.create(listings.map((listing) => ({
      listingId: listing._id,
      label: "Accesso alla visita",
      pricing: { type: "free" },
      grants: [{ resourceType: listing.resourceType, resourceId: listing.resourceId, capability: "visit.execute", versionPolicy: listing.resourceType === "visit" ? "follow_current" : "pinned" }],
      status: "active",
      createdBy: user._id,
    })));

    const liveAtA = await listCatalog({
      actorUserId: user._id,
      selectedVenueIds: [venueA._id],
      resourceTypes: ["visit"],
    });
    assert.equal(liveAtA.results.length, 0);

    const snapshotAtA = await listCatalog({
      actorUserId: user._id,
      selectedVenueIds: [venueA._id],
      resourceTypes: ["visit_revision"],
    });
    assert.equal(snapshotAtA.results.length, 1);
    assert.equal(snapshotAtA.results[0].asset.title, "Visit snapshot A");
    assert.deepEqual(snapshotAtA.results[0].asset.physicalScope.map((venue) => venue.name), ["Venue A"]);

    const liveAtB = await listCatalog({
      actorUserId: user._id,
      selectedVenueIds: [venueB._id],
      resourceTypes: ["visit"],
    });
    assert.equal(liveAtB.results.length, 1);
    assert.equal(liveAtB.results[0].asset.title, "Visit live");
    assert.deepEqual(liveAtB.results[0].asset.physicalScope.map((venue) => venue.name), ["Venue B"]);
  });
});
