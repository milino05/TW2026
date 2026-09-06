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
      externalIdentities: [{ scheme: "wikidata", id: "Q762", role: "canonical", verification: { status: "verified" } }],
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
