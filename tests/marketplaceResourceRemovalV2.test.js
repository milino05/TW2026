const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

async function users(User, suffix) {
  return User.create([
    { username: `removal-owner-${suffix}`, passwordHash: "test-hash" },
    { username: `removal-buyer-${suffix}`, passwordHash: "test-hash" },
  ]);
}

async function publishedNamespace({ Namespace, NamespaceRevision, owner, name }) {
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration:medium", key: "medium", label: "Media", targetSeconds: 120 }],
    languageLevels: [{ definitionId: "language:simple", key: "simple", label: "Semplice" }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  namespace.publishedRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

async function publishedListingWithOffer({ MarketplaceListing, MarketplaceOffer, owner, resourceType, resourceId, capability, versionPolicy = "pin_at_acquisition" }) {
  const listing = await MarketplaceListing.create({
    sellerType: "user",
    sellerId: owner._id,
    resourceType,
    resourceId,
    title: `Listing ${resourceType}`,
    status: "published",
    publishedAt: new Date(),
    createdBy: owner._id,
  });
  const offer = await MarketplaceOffer.create({
    listingId: listing._id,
    label: "Offerta da rimuovere",
    pricing: { type: "free" },
    grants: [{ resourceType, resourceId, capability, versionPolicy }],
    status: "active",
    createdBy: owner._id,
  });
  return { listing, offer };
}

test("rimuovere un contenuto lo archivia e preserva storico, diritti, adozioni e snapshot", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { listCreatorWorkspaceResources } = require("../services/marketplaceWorkspaceResourcesV2.service");
    const { resolveCapabilitySource } = require("../services/capabilityAuthorization.service");

    const [owner, buyer] = await users(User, "content");
    const { namespace, revision: namespaceRevision } = await publishedNamespace({ Namespace, NamespaceRevision, owner, name: "Regole per il contenuto" });
    const subject = await Subject.create({ preferredLabel: "Soggetto rimozione", createdBy: owner._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto da eliminare",
      authorCredits: [owner.username],
      metadata: { license: "CC BY 4.0" },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();
    const { listing, offer } = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "item_edition", resourceId: edition._id, capability: "content.consume",
    });
    const snapshotPublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "item_revision", resourceId: revision._id, capability: "content.consume", versionPolicy: "pinned",
    });
    const acquired = await marketplace.acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "item_edition", resourceId: edition._id },
      sourceSnapshotRef: { resourceType: "item_revision", resourceId: revision._id },
      action: "content_link", adoptedBy: buyer._id,
    });

    const result = await removeOwnedWorkspaceResource({
      actorUserId: owner._id, resourceType: "item_edition", resourceId: edition._id,
    });
    assert.equal(result.lifecycleStatus, "trashed");
    assert.equal(result.withdrawnListingCount, 2);
    assert.equal(result.inactiveOfferCount, 2);
    assert.equal((await ItemV2.findById(item._id).lean()).lifecycleStatus, "trashed");
    assert.equal((await MarketplaceListing.findById(listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(offer._id).lean()).status, "inactive");
    assert.equal((await MarketplaceListing.findById(snapshotPublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(snapshotPublication.offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);

    const owned = await listCreatorWorkspaceResources({ actorUserId: owner._id, ownership: "owned", resourceTypes: ["item_edition"] });
    assert.equal(owned.total, 0);
    const licensed = await listCreatorWorkspaceResources({ actorUserId: buyer._id, ownership: "licensed" });
    assert.equal(licensed.results.length, 1);
    assert.equal(licensed.results[0].resourceType, "item_revision");
    assert.equal(licensed.results[0].title, "Contenuto da eliminare");
    const access = await resolveCapabilitySource({
      actorUserId: buyer._id, capability: "content.consume", resourceType: "item_revision", resourceId: revision._id,
    });
    assert.equal(access.allowed, true);
    assert.equal(String(access.resolvedSnapshotRef.resourceId), String(revision._id));
  });
});

test("rimuovere regole editoriali mantiene utilizzabile la revisione già acquisita", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { getMarketplaceAuthoringPreflight } = require("../services/marketplaceAuthoringPreflightV2.service");

    const [owner, buyer] = await users(User, "namespace");
    const { namespace, revision } = await publishedNamespace({ Namespace, NamespaceRevision, owner, name: "Regole da eliminare" });
    const { listing, offer } = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "namespace", resourceId: namespace._id, capability: "namespace.author",
    });
    const acquired = await marketplace.acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: revision._id },
      action: "namespace_use", adoptedBy: buyer._id,
    });

    await removeOwnedWorkspaceResource({ actorUserId: owner._id, resourceType: "namespace", resourceId: namespace._id });
    const removedNamespace = await Namespace.findById(namespace._id).lean();
    assert.equal(removedNamespace.lifecycleStatus, "trashed");
    assert.equal(String(removedNamespace.trashedBy), String(owner._id));
    assert.equal((await MarketplaceListing.findById(listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);

    const preflight = await getMarketplaceAuthoringPreflight({ actorUserId: buyer._id });
    assert.equal(preflight.content.allowed, true);
    assert.equal(preflight.content.usableNamespaces.length, 1);
    assert.equal(String(preflight.content.usableNamespaces[0].revisionId), String(revision._id));
    assert.equal(preflight.content.usableNamespaces[0].source, "licensed");
  });
});
