const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_collection_entry_authorization`;
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

test("collection addEntry cannot bypass ItemEdition release authorization", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");

    const owner = await User.create({ username: "collection-auth-owner", passwordHash: "hash" });
    const outsider = await User.create({ username: "collection-auth-outsider", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Regole autorizzazione raccolta",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const space = await ContentSpace.create({
      name: "Spazio autorizzazione raccolta",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const graphFixture = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Raccolta autorizzazione",
      createdBy: owner._id,
    });

    const subject = await Subject.create({ preferredLabel: "Contenuto esterno", createdBy: outsider._id });
    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: outsider._id,
      createdBy: outsider._id,
    });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: outsider._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Versione non acquisita",
      authorCredits: [outsider.username],
      metadata: { license: "CC BY" },
      presentationVariants: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: outsider._id },
      publication: { publishedAt: new Date(), publishedBy: outsider._id },
      createdBy: outsider._id,
      updatedBy: outsider._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();

    await ContentSpaceItemMembership.create({ contentSpaceId: space._id, itemId: item._id, addedBy: owner._id });

    await assert.rejects(
      () => addEditorialContextEntry({
        editorialContextId: graphFixture.context._id,
        itemId: item._id,
        actorUserId: owner._id,
      }),
      (error) => error?.status === 403,
      "la membership nello spazio non deve bypassare l'autorizzazione d'uso della ItemEdition",
    );
  });
});
