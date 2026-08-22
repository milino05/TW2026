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

async function publishedNamespace({ Namespace, NamespaceRevision, ownerId, actorUserId, name }) {
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId, createdBy: actorUserId });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [], languageLevels: [], presentationAspects: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: actorUserId },
    publication: { publishedAt: new Date(), publishedBy: actorUserId },
    createdBy: actorUserId, updatedBy: actorUserId,
  });
  namespace.publishedRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

test("Offer self-contained accetta dipendenze snapshot possedute dallo stesso seller", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const { createListing, createOffer } = require("../services/marketplaceV2.service");

    const seller = await User.create({ username: "integrity-seller", passwordHash: "test-hash" });
    const subject = await Subject.create({ preferredLabel: "Self contained", createdBy: seller._id });
    const { namespace, revision: namespaceRevision } = await publishedNamespace({ Namespace, NamespaceRevision, ownerId: seller._id, actorUserId: seller._id, name: "Seller namespace" });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: seller._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto self contained", presentationVariants: [], status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id }, createdBy: seller._id, updatedBy: seller._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();

    const listing = await createListing({ resourceType: "item_edition", resourceId: edition._id, sellerType: "user", sellerId: seller._id, actorUserId: seller._id });
    const offer = await createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: { pricing: { type: "free" }, grants: [{ resourceType: "item_edition", resourceId: edition._id, capability: "content.consume", versionPolicy: "follow_current" }] },
    });
    assert.equal(offer.dependencyIntegrity.status, "self_contained");
    assert.equal(offer.dependencyIntegrity.externalRequirements.length, 0);
    assert.equal(offer.dependencyIntegrity.selfContainedDependencies.some((entry) => String(entry.resourceId) === String(namespaceRevision._id)), true);
  });
});

test("Offer rifiuta una dependency closure con asset di owner esterno", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const { createListing, createOffer } = require("../services/marketplaceV2.service");

    const [seller, external] = await User.create([
      { username: "integrity-owner", passwordHash: "test-hash" },
      { username: "integrity-external", passwordHash: "test-hash" },
    ]);
    const subject = await Subject.create({ preferredLabel: "External dependency", createdBy: seller._id });
    const { namespace, revision: externalRevision } = await publishedNamespace({ Namespace, NamespaceRevision, ownerId: external._id, actorUserId: external._id, name: "External namespace" });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: seller._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id, version: 1, authoredAgainstNamespaceRevisionId: externalRevision._id,
      label: "Dipendenza esterna", presentationVariants: [], status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id }, createdBy: seller._id, updatedBy: seller._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();
    const listing = await createListing({ resourceType: "item_edition", resourceId: edition._id, sellerType: "user", sellerId: seller._id, actorUserId: seller._id });

    await assert.rejects(
      () => createOffer({ listingId: listing._id, actorUserId: seller._id, payload: { pricing: { type: "free" }, grants: [{ resourceType: "item_edition", resourceId: edition._id, capability: "content.consume", versionPolicy: "follow_current" }] } }),
      (error) => error?.details?.some((detail) => detail.code === "MARKETPLACE_EXTERNAL_DEPENDENCIES_NOT_SUPPORTED"),
    );
  });
});

test("follow_current ricontrolla la closure prima di una nuova Acquisition", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const { createListing, createOffer, acquireOffer } = require("../services/marketplaceV2.service");

    const [seller, external, buyer] = await User.create([
      { username: "follow-seller", passwordHash: "test-hash" },
      { username: "follow-external", passwordHash: "test-hash" },
      { username: "follow-buyer", passwordHash: "test-hash" },
    ]);
    const { namespace, revision: namespaceRevision } = await publishedNamespace({ Namespace, NamespaceRevision, ownerId: seller._id, actorUserId: seller._id, name: "Follow namespace" });
    const space = await ContentSpace.create({ name: "Follow space", ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const context = await EditorialContext.create({ contentSpaceId: space._id, namespaceId: namespace._id, displayName: "Follow context", createdBy: seller._id });
    const release1 = await EditorialRelease.create({
      editorialContextId: context._id, version: 1, namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: new mongoose.Types.ObjectId(), itemBindings: [],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id }, releasedAt: new Date(), releasedBy: seller._id,
    });
    context.publishedReleaseId = release1._id;
    await context.save();
    const listing = await createListing({ resourceType: "editorial_context", resourceId: context._id, sellerType: "user", sellerId: seller._id, actorUserId: seller._id });
    const offer = await createOffer({
      listingId: listing._id, actorUserId: seller._id,
      payload: { pricing: { type: "free" }, grants: [{ resourceType: "editorial_context", resourceId: context._id, capability: "context.generate", versionPolicy: "follow_current" }] },
    });
    assert.equal(offer.dependencyIntegrity.status, "self_contained");

    const subject = await Subject.create({ preferredLabel: "External item", createdBy: external._id });
    const externalItem = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: external._id, createdBy: external._id });
    const externalEdition = await ItemEdition.create({ itemId: externalItem._id, namespaceId: namespace._id, createdBy: external._id });
    const externalRevision = await ItemRevisionV2.create({
      itemEditionId: externalEdition._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "External release item", presentationVariants: [], status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: external._id },
      publication: { publishedAt: new Date(), publishedBy: external._id }, createdBy: external._id, updatedBy: external._id,
    });
    externalEdition.publishedRevisionId = externalRevision._id;
    await externalEdition.save();
    const release2 = await EditorialRelease.create({
      editorialContextId: context._id, version: 2, basedOnReleaseId: release1._id, namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: new mongoose.Types.ObjectId(), itemBindings: [{ itemEditionId: externalEdition._id, itemRevisionId: externalRevision._id }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id }, releasedAt: new Date(), releasedBy: seller._id,
    });
    context.publishedReleaseId = release2._id;
    await context.save();

    await assert.rejects(
      () => acquireOffer({ offerId: offer._id, actorUserId: buyer._id }),
      (error) => error?.details?.some((detail) => detail.code === "MARKETPLACE_EXTERNAL_DEPENDENCIES_NOT_SUPPORTED"),
    );
  });
});
