const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_content_space_browser_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

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

function oid() { return new mongoose.Types.ObjectId(); }

test("ContentSpace browser projects Subject identity, presentation count, collection usage and search", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const EditorialContextEntry = require("../models/editorialContextEntry.model");
    const { listItemMemberships } = require("../services/contentSpace.service");

    const user = await User.create({ username: "content-space-browser", passwordHash: "test-hash" });
    const [leonardo, michelangelo] = await Subject.create([
      { preferredLabel: "Leonardo da Vinci", description: "Artista e inventore", createdBy: user._id },
      { preferredLabel: "Michelangelo Buonarroti", description: "Scultore e pittore", createdBy: user._id },
    ]);
    const space = await ContentSpace.create({
      name: "Rinascimento",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const [leonardoItem, michelangeloItem] = await ItemV2.create([
      { primarySubjectId: leonardo._id, ownerType: "user", ownerId: user._id, createdBy: user._id },
      { primarySubjectId: michelangelo._id, ownerType: "user", ownerId: user._id, createdBy: user._id },
    ]);
    await ContentSpaceMembership.create([
      { contentSpaceId: space._id, itemId: leonardoItem._id, addedBy: user._id },
      { contentSpaceId: space._id, itemId: michelangeloItem._id, addedBy: user._id },
    ]);

    const [leonardoEditionA, leonardoEditionB, michelangeloEdition] = await ItemEdition.create([
      { itemId: leonardoItem._id, namespaceId: oid(), createdBy: user._id },
      { itemId: leonardoItem._id, namespaceId: oid(), createdBy: user._id },
      { itemId: michelangeloItem._id, namespaceId: oid(), createdBy: user._id },
    ]);
    const collectionA = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: leonardoEditionA.namespaceId,
      namespaceRevisionId: oid(),
      displayName: "Leonardo essenziale",
      createdBy: user._id,
    });
    const collectionB = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: leonardoEditionB.namespaceId,
      namespaceRevisionId: oid(),
      displayName: "Leonardo approfondito",
      createdBy: user._id,
    });
    await EditorialContextEntry.create([
      { editorialContextId: collectionA.context._id, itemEditionId: leonardoEditionA._id, addedBy: user._id, updatedBy: user._id },
      { editorialContextId: collectionB.context._id, itemEditionId: leonardoEditionB._id, addedBy: user._id, updatedBy: user._id },
    ]);

    const firstPage = await listItemMemberships({
      contentSpaceId: space._id,
      actorUserId: user._id,
      page: 1,
      limit: 1,
    });
    assert.equal(firstPage.pagination.total, 2);
    assert.equal(firstPage.pagination.totalPages, 2);
    assert.equal(firstPage.results.length, 1);

    const leonardoSearch = await listItemMemberships({
      contentSpaceId: space._id,
      actorUserId: user._id,
      q: "Leonardo",
      page: 1,
      limit: 20,
    });
    assert.equal(leonardoSearch.pagination.total, 1);
    assert.equal(leonardoSearch.results.length, 1);
    assert.equal(leonardoSearch.results[0].subject.label, "Leonardo da Vinci");
    assert.equal(String(leonardoSearch.results[0].itemId), String(leonardoItem._id));
    assert.equal(leonardoSearch.results[0].editionCount, 2);
    assert.equal(leonardoSearch.results[0].collectionUsageCount, 2);
    assert.equal(leonardoSearch.results[0].membership, undefined);
    assert.equal(leonardoSearch.results[0].item, undefined);

    const michelangeloSearch = await listItemMemberships({
      contentSpaceId: space._id,
      actorUserId: user._id,
      q: "scultore",
      page: 1,
      limit: 20,
    });
    assert.equal(michelangeloSearch.pagination.total, 1);
    assert.equal(michelangeloSearch.results[0].subject.label, "Michelangelo Buonarroti");
    assert.equal(michelangeloSearch.results[0].editionCount, 1);
    assert.equal(michelangeloSearch.results[0].collectionUsageCount, 0);
    assert.equal(String(michelangeloEdition.itemId), String(michelangeloItem._id));
  });
});
