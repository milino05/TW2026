const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_content_space_item_detail_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);
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

test("ContentSpace quick add preserves Item identity, recognition media, collection Edition derivation and graph coverage", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ContentSpace = require("../models/contentSpace.model");
    const Namespace = require("../models/namespace.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const { createItem } = require("../services/itemInstantiationV2.service");
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { getItemAddContext, getItemLibraryDetail } = require("../services/contentSpaceItemDetail.service");

    const user = await User.create({ username: "item-detail-owner", passwordHash: "test-hash" });
    const subject = await Subject.create({
      preferredLabel: "Leonardo da Vinci",
      description: "Artista e inventore",
      externalIdentities: [{
        scheme: "wikidata",
        id: "Q762",
        role: "canonical",
        confirmation: { source: "seed", confirmedAt: new Date() },
        verification: { status: "verified" },
      }],
      createdBy: user._id,
    });
    const space = await ContentSpace.create({
      name: "Collezione permanente",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const recognitionMedia = {
      url: "https://commons.wikimedia.org/example.jpg",
      altText: "Ritratto di Leonardo da Vinci",
      source: { provider: "wikimedia_commons", wikidataEntityId: "Q762", retrievedAt: new Date().toISOString() },
      rights: { licenseName: "Public domain" },
    };
    const item = await createItem({
      payload: {
        primarySubjectId: subject._id,
        ownerType: "user",
        ownerId: user._id,
        contentSpaceId: space._id,
        recognitionMedia,
      },
      actorUserId: user._id,
    });
    assert.equal(item.recognitionMedia.url, recognitionMedia.url);
    assert.equal(item.recognitionMedia.altText, recognitionMedia.altText);

    const addContext = await getItemAddContext({ contentSpaceId: space._id, subjectId: subject._id, actorUserId: user._id });
    assert.equal(addContext.ownedItems.length, 1);
    assert.equal(String(addContext.ownedItems[0].id), String(item._id));
    assert.equal(addContext.ownedItems[0].alreadyInCurrentSpace, true);
    assert.equal(addContext.ownedItems[0].recognitionMedia.url, recognitionMedia.url);

    const namespace = await Namespace.create({
      name: "Regole didattiche",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const fixture = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: namespace._id,
      displayName: "Percorso bambini",
      createdBy: user._id,
    });
    await GraphSubjectBinding.create({ graphRevisionId: fixture.graphRevision._id, subjectId: subject._id });
    await addEditorialContextEntry({ editorialContextId: fixture.context._id, itemId: item._id, actorUserId: user._id });

    const missingEditionDetail = await getItemLibraryDetail({ contentSpaceId: space._id, itemId: item._id, actorUserId: user._id });
    assert.equal(missingEditionDetail.item.recognitionMedia.url, recognitionMedia.url);
    assert.equal(missingEditionDetail.collections.length, 1);
    assert.equal(missingEditionDetail.collections[0].containsItem, true);
    assert.equal(missingEditionDetail.collections[0].compatibleEdition, null);
    assert.equal(missingEditionDetail.collections[0].semanticCoverage, "covered");
    assert.equal(missingEditionDetail.collections[0].availableOperations.canCreateEdition, true);

    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: oid(),
      label: "Leonardo per bambini",
      authorCredits: ["Museo"],
      metadata: { license: "CC BY" },
      presentationVariants: [],
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.workingRevisionId = revision._id;
    await edition.save();

    const completeDetail = await getItemLibraryDetail({ contentSpaceId: space._id, itemId: item._id, actorUserId: user._id });
    assert.equal(completeDetail.editions.length, 1);
    assert.equal(completeDetail.editions[0].namespace.name, "Regole didattiche");
    assert.equal(completeDetail.editions[0].revision.label, "Leonardo per bambini");
    assert.equal(String(completeDetail.collections[0].compatibleEdition.id), String(edition._id));
    assert.equal(completeDetail.collections[0].compatibleEdition.revision.label, "Leonardo per bambini");
  });
});

test("ContentSpace quick add exposes only actionable marketplace forks and preserves owned Item reuse priority", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ContentSpace = require("../models/contentSpace.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const Entitlement = require("../models/entitlement.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const { createItem, forkItem } = require("../services/itemInstantiationV2.service");
    const { acquireOffer } = require("../services/marketplaceV2.service");
    const { getItemAddContext } = require("../services/contentSpaceItemAddContext.service");

    const seller = await User.create({ username: "quick-add-seller", passwordHash: "test-hash" });
    const buyer = await User.create({ username: "quick-add-buyer", passwordHash: "test-hash" });
    const subject = await Subject.create({
      preferredLabel: "La Gioconda",
      description: "Dipinto di Leonardo",
      createdBy: seller._id,
    });
    const sellerSpace = await ContentSpace.create({
      name: "Seller space",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const buyerSpace = await ContentSpace.create({
      name: "Buyer space",
      ownerType: "user",
      ownerId: buyer._id,
      createdBy: buyer._id,
    });
    const sellerItem = await createItem({
      payload: {
        primarySubjectId: subject._id,
        ownerType: "user",
        ownerId: seller._id,
        contentSpaceId: sellerSpace._id,
      },
      actorUserId: seller._id,
    });
    const namespace = await Namespace.create({
      name: "Regole seller",
      ownerType: "user",
      ownerId: seller._id,
      createdBy: seller._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
      languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
      presentationAspects: [{ definitionId: "aspect-story", key: "story", label: "Racconto" }],
      selectionSignals: [{ definitionId: "signal-core", key: "core", label: "Principale" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const sellerEdition = await ItemEdition.create({ itemId: sellerItem._id, namespaceId: namespace._id, createdBy: seller._id });
    const variantId = oid();
    const representationId = oid();
    const sellerRevision = await ItemRevisionV2.create({
      itemEditionId: sellerEdition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Gioconda completa",
      authorCredits: ["Autore demo"],
      metadata: { license: "CC BY" },
      selectionSignals: [{ definitionId: "signal-core", weight: 1 }],
      presentationVariants: [{
        _id: variantId,
        key: "default",
        label: "Default",
        presentationAspects: [{ definitionId: "aspect-story", weight: 1 }],
        representations: [{
          _id: representationId,
          durationTypeDefinitionId: "duration-short",
          languageLevelDefinitionId: "language-simple",
          locale: "it-IT",
          text: "Testo di prova",
        }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    sellerEdition.publishedRevisionId = sellerRevision._id;
    await sellerEdition.save();

    const privateContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.equal(privateContext.ownedItems.length, 0);
    assert.deepEqual(privateContext.marketplaceOptions, []);
    assert.equal(privateContext.availableOperations.canAcquireAndForkMarketplaceItem, true);

    const listing = await MarketplaceListing.create({
      sellerType: "user",
      sellerId: seller._id,
      resourceType: "item_edition",
      resourceId: sellerEdition._id,
      title: "Gioconda · versione completa",
      summary: "Contenuto editoriale pubblicato",
      status: "draft",
      createdBy: seller._id,
    });
    const offer = await MarketplaceOffer.create({
      listingId: listing._id,
      label: "Licenza gratuita",
      pricing: { type: "free" },
      grants: [{
        resourceType: "item_edition",
        resourceId: sellerEdition._id,
        capability: "content.fork",
        versionPolicy: "follow_current",
      }],
      status: "active",
      createdBy: seller._id,
    });

    const draftContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.deepEqual(draftContext.marketplaceOptions, []);

    listing.status = "published";
    listing.publishedAt = new Date();
    await listing.save();

    const missingNamespaceAccessContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.deepEqual(missingNamespaceAccessContext.marketplaceOptions, []);

    const existingNamespaceEntitlement = await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
      resourceType: "namespace",
      resourceId: namespace._id,
      capability: "namespace.author",
      versionPolicy: "follow_current",
      status: "active",
    });
    const existingNamespaceAccessContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.equal(existingNamespaceAccessContext.marketplaceOptions.length, 1);
    await Entitlement.deleteOne({ _id: existingNamespaceEntitlement._id });

    const noAccessAgainContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.deepEqual(noAccessAgainContext.marketplaceOptions, []);

    offer.grants.push({
      resourceType: "namespace",
      resourceId: namespace._id,
      capability: "namespace.author",
      versionPolicy: "pin_at_acquisition",
    });
    await offer.save();

    const marketplaceContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.equal(marketplaceContext.ownedItems.length, 0);
    assert.equal(marketplaceContext.marketplaceOptions.length, 1);
    assert.equal(String(marketplaceContext.marketplaceOptions[0].itemId), String(sellerItem._id));
    assert.equal(String(marketplaceContext.marketplaceOptions[0].editionId), String(sellerEdition._id));
    assert.equal(String(marketplaceContext.marketplaceOptions[0].listingId), String(listing._id));
    assert.equal(String(marketplaceContext.marketplaceOptions[0].offerId), String(offer._id));
    assert.equal(marketplaceContext.marketplaceOptions[0].pricing.type, "free");

    await acquireOffer({
      offerId: offer._id,
      actorUserId: buyer._id,
      beneficiaryType: "user",
      beneficiaryId: buyer._id,
    });
    const forked = await forkItem({
      sourceItemId: sellerItem._id,
      sourceEditionId: sellerEdition._id,
      ownerType: "user",
      ownerId: buyer._id,
      contentSpaceId: buyerSpace._id,
      actorUserId: buyer._id,
    });
    assert.equal(String(forked.item.ownerId), String(buyer._id));
    assert.equal(String(forked.edition.namespaceId), String(namespace._id));

    const ownedContext = await getItemAddContext({
      contentSpaceId: buyerSpace._id,
      subjectId: subject._id,
      actorUserId: buyer._id,
    });
    assert.equal(ownedContext.ownedItems.length, 1);
    assert.equal(String(ownedContext.ownedItems[0].id), String(forked.item._id));
    assert.equal(ownedContext.ownedItems[0].alreadyInCurrentSpace, true);
    assert.deepEqual(ownedContext.marketplaceOptions, []);
  });
});
