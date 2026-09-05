const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");

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

test("a personal Entitlement cannot create an Organization-owned fork", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const { Adoption } = require("../models/adoption.model");
    const { createListing, createOffer, acquireOffer } = require("../services/marketplaceV2.service");
    const { forkItem } = require("../services/itemInstantiationV2.service");

    const [seller, buyer] = await User.create([
      { username: "principal-seller", passwordHash: "test-hash" },
      { username: "principal-buyer", passwordHash: "test-hash" },
    ]);
    const organization = await Organization.create({
      name: "Buyer organization",
      createdBy: buyer._id,
    });
    await assignStarterRole({ organization, user: buyer, starterKey: "administrator" });
    const organizationSpace = await ContentSpace.create({
      name: "Buyer editorial space",
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: buyer._id,
    });

    const subject = await Subject.create({ preferredLabel: "Opera principal scope", createdBy: seller._id });
    const durationDefinitionId = "duration-standard";
    const languageDefinitionId = "language-standard";
    const namespace = await Namespace.create({
      name: "Namespace principal scope",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [{ definitionId: durationDefinitionId, key: "standard", label: "Standard", targetSeconds: 60 }],
      languageLevels: [{ definitionId: languageDefinitionId, key: "standard", label: "Standard" }],
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
    const variantId = new mongoose.Types.ObjectId();
    const representationId = new mongoose.Types.ObjectId();
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Versione autorizzata",
      authorCredits: ["Autore Marketplace"],
      metadata: { license: "CC BY" },
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        representations: [{ _id: representationId, durationTypeDefinitionId: durationDefinitionId, languageLevelDefinitionId: languageDefinitionId, locale: "it-IT", text: "Versione autorizzata" }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    edition.publishedRevisionId = revision._id;
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
        pricing: { type: "free" },
        grants: [
          { resourceType: "item_edition", resourceId: edition._id, capability: "content.fork", versionPolicy: "pin_at_acquisition" },
          { resourceType: "namespace", resourceId: namespace._id, capability: "namespace.author", versionPolicy: "pin_at_acquisition" },
        ],
      },
    });

    await acquireOffer({ offerId: offer._id, actorUserId: buyer._id, beneficiaryType: "user", beneficiaryId: buyer._id });

    await assert.rejects(
      () => forkItem({
        sourceItemId: item._id,
        sourceEditionId: edition._id,
        ownerType: "organization",
        ownerId: organization._id,
        contentSpaceId: organizationSpace._id,
        actorUserId: buyer._id,
      }),
      (error) => error?.status === 403 && error?.details?.some((detail) => detail.code === "CAPABILITY_REQUIRED"),
    );
    assert.equal(await ItemV2.countDocuments({ ownerType: "organization", ownerId: organization._id }), 0);
    assert.equal(await Adoption.countDocuments({ beneficiaryType: "organization", beneficiaryId: organization._id }), 0);

    await acquireOffer({
      offerId: offer._id,
      actorUserId: buyer._id,
      beneficiaryType: "organization",
      beneficiaryId: organization._id,
    });

    const forked = await forkItem({
      sourceItemId: item._id,
      sourceEditionId: edition._id,
      ownerType: "organization",
      ownerId: organization._id,
      contentSpaceId: organizationSpace._id,
      actorUserId: buyer._id,
    });
    assert.equal(forked.item.ownerType, "organization");
    assert.equal(String(forked.item.ownerId), String(organization._id));
    assert.equal(
      await ContentSpaceItemMembership.countDocuments({ contentSpaceId: organizationSpace._id, itemId: forked.item._id }),
      1,
    );

    const adoptions = await Adoption.find({ beneficiaryType: "organization", beneficiaryId: organization._id }).lean();
    assert.deepEqual(new Set(adoptions.map((entry) => entry.action)), new Set(["content_fork", "namespace_use"]));
  });
});