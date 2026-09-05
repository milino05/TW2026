const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

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

async function createPublishedEdition({ owner, namespace, namespaceRevision, label, subjectLabel }) {
  const Subject = require("../models/subject.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const subject = await Subject.create({ preferredLabel: subjectLabel, createdBy: owner._id });
  const item = await ItemV2.create({
    primarySubjectId: subject._id,
    ownerType: "user",
    ownerId: owner._id,
    createdBy: owner._id,
  });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
  const revision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label,
    authorCredits: [owner.username],
    metadata: { license: "CC BY" },
    presentationVariants: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  edition.publishedRevisionId = revision._id;
  await edition.save();
  return { subject, item, edition, revision };
}

test("outside-space import adds membership and only the selected collection entry", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
    const EditorialContext = require("../models/editorialContext.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const {
      searchExternalEditorialCandidates,
      importExternalEditorialCandidate,
    } = require("../services/editorialContextExternalContent.service");
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");

    const owner = await User.create({ username: "external-import-owner", passwordHash: "hash" });
    const outsider = await User.create({ username: "external-import-outsider", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Regole import",
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
      name: "Spazio import",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const first = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Raccolta A",
      createdBy: owner._id,
    });
    const secondContext = await EditorialContext.create({
      contentSpaceId: space._id,
      namespaceId: namespace._id,
      semanticGraphId: first.semanticGraph._id,
      displayName: "Raccolta B",
      createdBy: owner._id,
    });

    const owned = await createPublishedEdition({
      owner,
      namespace,
      namespaceRevision,
      label: "Leonardo e le sue opere",
      subjectLabel: "Leonardo da Vinci",
    });
    const unauthorized = await createPublishedEdition({
      owner: outsider,
      namespace,
      namespaceRevision,
      label: "La bottega di Verrocchio",
      subjectLabel: "Andrea del Verrocchio",
    });

    const candidates = await searchExternalEditorialCandidates({
      editorialContextId: first.context._id,
      actorUserId: owner._id,
      query: "Leonardo",
      page: 1,
      limit: 12,
    });
    assert.equal(candidates.pagination.total, 1);
    assert.equal(String(candidates.results[0].itemEditionId), String(owned.edition._id));

    const imported = await importExternalEditorialCandidate({
      editorialContextId: first.context._id,
      itemEditionId: owned.edition._id,
      actorUserId: owner._id,
    });
    assert.equal(imported.membershipCreated, true);
    assert.equal(await ContentSpaceItemMembership.countDocuments({ contentSpaceId: space._id, itemId: owned.item._id }), 1);
    assert.equal(await ContentSpaceSubjectMembership.countDocuments({ contentSpaceId: space._id, subjectId: owned.subject._id }), 1);
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: first.context._id, itemId: owned.item._id }), 1);
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: secondContext._id, itemId: owned.item._id }), 0, "l'altra raccolta dello spazio non deve essere modificata");
    assert.equal(
      await GraphSubjectBinding.countDocuments({ graphRevisionId: first.semanticGraph.workingRevisionId }),
      0,
      "aggiungere un contenuto alla raccolta non deve modificare automaticamente il grafo semantico",
    );

    const noLongerExternal = await searchExternalEditorialCandidates({
      editorialContextId: first.context._id,
      actorUserId: owner._id,
      query: "Leonardo",
    });
    assert.equal(noLongerExternal.pagination.total, 0, "dopo l'import il contenuto appartiene allo spazio e non è più un candidato esterno");

    const hiddenUnauthorized = await searchExternalEditorialCandidates({
      editorialContextId: first.context._id,
      actorUserId: owner._id,
      query: "Verrocchio",
    });
    assert.equal(hiddenUnauthorized.pagination.total, 0);
    await assert.rejects(
      () => importExternalEditorialCandidate({
        editorialContextId: first.context._id,
        itemEditionId: unauthorized.edition._id,
        actorUserId: owner._id,
      }),
      (error) => error?.status === 403,
    );

    await ContentSpaceItemMembership.create({ contentSpaceId: space._id, itemId: unauthorized.item._id, addedBy: owner._id });
    await assert.rejects(
      () => addEditorialContextEntry({
        editorialContextId: first.context._id,
        itemId: unauthorized.item._id,
        actorUserId: owner._id,
      }),
      (error) => error?.status === 403,
      "il POST leggero non deve poter aggirare l'autorizzazione filtrata dalla UI",
    );
  });
});