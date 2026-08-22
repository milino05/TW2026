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

test("paid ItemRevision acquisition preserves commercial snapshot and grants content.consume", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const {
      createListing,
      createOffer,
      acquireOffer,
      listCatalog,
      listAcquisitionHistory,
    } = require("../services/marketplaceV2.service");
    const { resolveCapabilityAccess } = require("../services/capabilityAuthorization.service");

    const [seller, buyer] = await User.create([
      { username: "multiasset-seller", passwordHash: "test-hash" },
      { username: "multiasset-buyer", passwordHash: "test-hash" },
    ]);
    const subject = await Subject.create({ preferredLabel: "Opera commerciale", createdBy: seller._id });
    const namespace = await Namespace.create({
      name: "Namespace commerciale",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [],
      languageLevels: [],
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
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Approfondimento rinascimentale acquistabile",
      authorCredits: ["Autore Marketplace"],
      metadata: { license: "CC BY" },
      presentationVariants: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();

    const listing = await createListing({
      resourceType: "item_revision",
      resourceId: revision._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    assert.equal(listing.status, "published");
    assert.match(listing.title, /rinascimentale/i);

    const offer = await createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: {
        label: "Licenza contenuto",
        pricing: { type: "paid", amountMinor: 499, currency: "eur" },
        grants: [{
          resourceType: "item_revision",
          resourceId: revision._id,
          capability: "content.consume",
          versionPolicy: "pinned",
        }],
      },
    });
    assert.equal(offer.pricing.type, "paid");
    assert.equal(offer.pricing.amountMinor, 499);
    assert.equal(offer.pricing.currency, "EUR");

    const before = await resolveCapabilityAccess({
      actorUserId: buyer._id,
      capability: "content.consume",
      resourceType: "item_revision",
      resourceId: revision._id,
    });
    assert.equal(before.allowed, false);

    const acquired = await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    assert.equal(acquired.alreadyAcquired, false);
    assert.equal(acquired.entitlements[0].resourceType, "item_revision");
    assert.equal(acquired.entitlements[0].versionPolicy, "pinned");

    const acquisition = await MarketplaceAcquisition.findById(acquired.acquisition._id).lean();
    assert.equal(acquisition.pricingSnapshot.type, "paid");
    assert.equal(acquisition.pricingSnapshot.amountMinor, 499);
    assert.equal(acquisition.pricingSnapshot.currency, "EUR");
    assert.equal(acquisition.grantSnapshots[0].resolvedSnapshotRef.resourceType, "item_revision");
    assert.equal(String(acquisition.grantSnapshots[0].resolvedSnapshotRef.resourceId), String(revision._id));

    const entitlement = await Entitlement.findOne({ sourceAcquisitionId: acquisition._id }).lean();
    assert.equal(String(entitlement.resourceId), String(revision._id));
    assert.equal(String(item.ownerId), String(seller._id), "acquisition must not transfer ownership");

    const after = await resolveCapabilityAccess({
      actorUserId: buyer._id,
      capability: "content.consume",
      resourceType: "item_revision",
      resourceId: revision._id,
    });
    assert.equal(after.allowed, true);
    assert.equal(after.basis, "entitlement");

    const catalog = await listCatalog({
      actorUserId: buyer._id,
      queryText: "rinascimentale",
      resourceTypes: ["item_revision"],
    });
    assert.equal(catalog.total, 1);
    assert.equal(catalog.results[0].asset.type, "item_revision");
    assert.equal(catalog.results[0].viewerState.alreadyUsable, true);

    const history = await listAcquisitionHistory({ actorUserId: buyer._id });
    assert.equal(history.total, 1);
    assert.equal(history.results[0].pricing.amountMinor, 499);
    assert.equal(history.results[0].grants[0].capability, "content.consume");
  });
});
