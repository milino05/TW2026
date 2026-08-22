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

test("pinned creator rights fork the acquired ItemRevision and record real adoptions", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const { createListing, createOffer, acquireOffer } = require("../services/marketplaceV2.service");
    const { forkItem } = require("../services/itemV2.service");

    const [seller, buyer] = await User.create([
      { username: "creator-seller", passwordHash: "test-hash" },
      { username: "creator-buyer", passwordHash: "test-hash" },
    ]);
    const subject = await Subject.create({ preferredLabel: "Opera fork", createdBy: seller._id });
    const namespace = await Namespace.create({
      name: "Namespace fork",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [],
      languageLevels: [],
      presentationAspects: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: seller._id });
    const revision1 = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Versione acquisita per fork",
      presentationVariants: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    edition.publishedRevisionId = revision1._id;
    await edition.save();

    const listing = await createListing({
      resourceType: "item_edition",
      resourceId: edition._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    const offer = await createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: {
        label: "Fork autorizzato",
        pricing: { type: "free" },
        grants: [
          {
            resourceType: "item_edition",
            resourceId: edition._id,
            capability: "content.fork",
            versionPolicy: "pin_at_acquisition",
          },
          {
            resourceType: "namespace",
            resourceId: namespace._id,
            capability: "namespace.author",
            versionPolicy: "pin_at_acquisition",
          },
        ],
      },
    });
    await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });

    const rights = await Entitlement.find({ beneficiaryId: buyer._id }).sort({ resourceType: 1 }).lean();
    assert.deepEqual(rights.map((entry) => entry.resourceType).sort(), ["item_revision", "namespace_revision"]);
    assert.equal(String(rights.find((entry) => entry.resourceType === "item_revision").resourceId), String(revision1._id));
    assert.equal(String(rights.find((entry) => entry.resourceType === "namespace_revision").resourceId), String(namespaceRevision._id));

    const revision2 = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 2,
      basedOnRevisionId: revision1._id,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Versione nuova del publisher",
      presentationVariants: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    revision1.status = "superseded";
    await revision1.save();
    edition.publishedRevisionId = revision2._id;
    await edition.save();

    const forked = await forkItem({
      sourceItemId: item._id,
      sourceEditionId: edition._id,
      ownerType: "user",
      ownerId: buyer._id,
      actorUserId: buyer._id,
    });

    assert.equal(forked.revision.label, "Versione acquisita per fork");
    assert.equal(String(forked.revision.provenance.sourceRevisionId), String(revision1._id));
    assert.equal(String(forked.revision.authoredAgainstNamespaceRevisionId), String(namespaceRevision._id));
    assert.equal(String(forked.item.ownerId), String(buyer._id));
    assert.equal(String(item.ownerId), String(seller._id), "fork must not mutate source ownership");

    const adoptions = await Adoption.find({ beneficiaryId: buyer._id }).sort({ action: 1 }).lean();
    assert.deepEqual(adoptions.map((entry) => entry.action).sort(), ["content_fork", "namespace_use"]);
    const contentFork = adoptions.find((entry) => entry.action === "content_fork");
    assert.equal(contentFork.sourceResourceRef.resourceType, "item_edition");
    assert.equal(String(contentFork.sourceSnapshotRef.resourceId), String(revision1._id));
    assert.equal(contentFork.resultResourceRef.resourceType, "item");
    const namespaceUse = adoptions.find((entry) => entry.action === "namespace_use");
    assert.equal(String(namespaceUse.sourceSnapshotRef.resourceId), String(namespaceRevision._id));
    assert.equal(namespaceUse.resultResourceRef.resourceType, "item_edition");
  });
});
