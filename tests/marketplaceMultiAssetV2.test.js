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
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const Entitlement = require("../models/entitlement.model");
    const {
      createListing,
      createOffer,
      withdrawListing,
      withdrawOffer,
      acquireOffer,
      listCatalog,
      listAcquisitionHistory,
    } = require("../services/marketplaceV2.service");
    const { getCommercialManagement } = require("../services/marketplaceCommercialV2.service");
    const { resolveCapabilityAccess } = require("../services/capabilityAuthorization.service");

    const [seller, buyer, secondBuyer] = await User.create([
      { username: "multiasset-seller", passwordHash: "test-hash" },
      { username: "multiasset-buyer", passwordHash: "test-hash" },
      { username: "multiasset-second-buyer", passwordHash: "test-hash" },
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
      illustrativeMedia: [{
        url: "https://upload.wikimedia.org/marketplace-content.jpg",
        altText: "Dettaglio dell'opera rinascimentale",
        width: 1200,
        height: 900,
      }],
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
    assert.equal(listing.status, "draft");
    assert.equal(listing.publishedAt, null);
    assert.match(listing.title, /rinascimentale/i);
    const catalogBeforeOffer = await listCatalog({ actorUserId: buyer._id, resourceTypes: ["item_revision"] });
    assert.equal(catalogBeforeOffer.total, 0, "a listing without an active Offer must not be visible in the Catalog");

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
    const publishedListing = await MarketplaceListing.findById(listing._id).lean();
    assert.equal(publishedListing.status, "published");
    assert.ok(publishedListing.publishedAt);

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

    await MarketplaceListing.init();
    const catalog = await listCatalog({
      actorUserId: buyer._id,
      queryText: "rinascimentale",
      resourceTypes: ["item_revision"],
    });
    assert.equal(catalog.total, 1);
    assert.equal(catalog.results[0].asset.type, "item_revision");
    assert.deepEqual(catalog.results[0].asset.illustrativeMedia, [{
      url: "https://upload.wikimedia.org/marketplace-content.jpg",
      altText: "Dettaglio dell'opera rinascimentale",
      width: 1200,
      height: 900,
    }]);
    assert.equal(catalog.results[0].viewerState.alreadyUsable, true);

    const history = await listAcquisitionHistory({ actorUserId: buyer._id });
    assert.equal(history.total, 1);
    assert.equal(history.results[0].pricing.amountMinor, 499);
    assert.equal(history.results[0].grants[0].capability, "content.consume");
    assert.equal(history.results[0].grants[0].label, "Fruisci il contenuto");
    assert.equal(history.results[0].asset.title, "Approfondimento rinascimentale acquistabile");
    assert.equal(history.results[0].asset.editorialLicense, "CC BY");
    assert.equal(history.results[0].seller.name, "multiasset-seller");
    assert.equal(history.results[0].offer.label, "Licenza contenuto");

    const commercial = await getCommercialManagement({ actorUserId: seller._id });
    assert.equal(commercial.listings.length, 1);
    assert.equal(commercial.listings[0].asset.editorialLicense, "CC BY");
    assert.equal(commercial.listings[0].offers[0].acquisitionCount, 1);
    assert.deepEqual(
      commercial.listings[0].offerConfiguration.capabilityOptions.map((entry) => entry.code),
      ["content.consume", "content.use_in_editorial_release", "content.fork"],
    );

    const withdrawnOffer = await withdrawOffer({ offerId: offer._id, actorUserId: seller._id });
    assert.equal(withdrawnOffer.status, "withdrawn");
    const unpublishedListing = await MarketplaceListing.findById(listing._id).lean();
    assert.equal(unpublishedListing.status, "draft", "withdrawing the last active Offer must hide the listing");
    assert.equal((await listCatalog({ actorUserId: buyer._id, resourceTypes: ["item_revision"] })).total, 0);
    const preserved = await MarketplaceAcquisition.findById(acquisition._id).lean();
    assert.equal(preserved.pricingSnapshot.amountMinor, 499, "withdrawing an Offer must preserve its Acquisition snapshot");

    const replacementOffer = await createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: {
        label: "Licenza contenuto aggiornata",
        pricing: { type: "paid", amountMinor: 699, currency: "EUR" },
        grants: [{
          resourceType: "item_revision",
          resourceId: revision._id,
          capability: "content.consume",
          versionPolicy: "pinned",
        }],
      },
    });
    assert.equal(replacementOffer.pricing.amountMinor, 699);
    assert.equal((await MarketplaceListing.findById(listing._id).lean()).status, "published");

    const withdrawnListing = await withdrawListing({ listingId: listing._id, actorUserId: seller._id });
    assert.equal(withdrawnListing.status, "withdrawn");
    await assert.rejects(
      () => acquireOffer({ offerId: replacementOffer._id, actorUserId: secondBuyer._id }),
      (error) => error?.status === 409,
    );
  });
});
