const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_collection_content_implicit_graph`;
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

async function fixture() {
  const User = require("../models/user");
  const Subject = require("../models/subject.model");
  const ContentSpace = require("../models/contentSpace.model");
  const Namespace = require("../models/namespace.model");
  const { createItem } = require("../services/itemInstantiationV2.service");

  const user = await User.create({ username: `collection-implicit-${new mongoose.Types.ObjectId()}`, passwordHash: "test-hash" });
  const space = await ContentSpace.create({ name: "Spazio curatoriale", ownerType: "user", ownerId: user._id, createdBy: user._id });
  const namespace = await Namespace.create({ name: "Regole curatoriale", ownerType: "user", ownerId: user._id, createdBy: user._id });
  const graphFixture = await createEditorialContextWithGraph({
    contentSpace: space,
    namespaceId: namespace._id,
    displayName: "Raccolta test",
    createdBy: user._id,
  });
  const subjects = await Subject.create([
    { preferredLabel: "Leonardo", description: "Artista", createdBy: user._id },
    { preferredLabel: "Raffaello", description: "Artista", createdBy: user._id },
    { preferredLabel: "Caravaggio", description: "Artista", createdBy: user._id },
  ]);
  const items = [];
  for (const subject of subjects) {
    items.push(await createItem({
      payload: { primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, contentSpaceId: space._id },
      actorUserId: user._id,
    }));
  }
  return { user, space, namespace, ...graphFixture, subjects, items };
}

test("collection candidates exclude existing entries before pagination", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { listEditorialCollectionAvailableItems } = require("../services/editorialCollectionAvailableItems.service");
    const data = await fixture();

    await addEditorialContextEntry({ editorialContextId: data.context._id, itemId: data.items[0]._id, actorUserId: data.user._id });

    const firstPage = await listEditorialCollectionAvailableItems({
      editorialContextId: data.context._id,
      actorUserId: data.user._id,
      page: 1,
      limit: 1,
    });
    assert.equal(firstPage.pagination.total, 2);
    assert.equal(firstPage.pagination.totalPages, 2);
    assert.equal(firstPage.results.length, 1);
    assert.notEqual(String(firstPage.results[0].itemId), String(data.items[0]._id));
    assert.equal(Object.hasOwn(firstPage.results[0], "inCollection"), false);

    const search = await listEditorialCollectionAvailableItems({
      editorialContextId: data.context._id,
      actorUserId: data.user._id,
      query: "Caravaggio",
      page: 1,
      limit: 12,
    });
    assert.equal(search.pagination.total, 1);
    assert.equal(String(search.results[0].itemId), String(data.items[2]._id));
  });
});

test("a collection Item subject can focus the graph with zero relations without mutating the graph", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { getEditorialCollectionGraphNeighborhood } = require("../services/editorialCollectionGraphNeighborhood.service");
    const data = await fixture();

    await addEditorialContextEntry({ editorialContextId: data.context._id, itemId: data.items[0]._id, actorUserId: data.user._id });
    const before = await SemanticGraph.findById(data.semanticGraph._id).lean();
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: data.graphRevision._id }), 0);

    const projection = await getEditorialCollectionGraphNeighborhood({
      editorialContextId: data.context._id,
      view: "working",
      actorUserId: data.user._id,
      focusSubjectId: data.subjects[0]._id,
      limit: 18,
    });

    assert.equal(String(projection.neighborhood.focusSubjectId), String(data.subjects[0]._id));
    assert.equal(projection.neighborhood.implicitFocus, true);
    assert.equal(projection.neighborhood.totalNeighbors, 0);
    assert.equal(projection.edges.length, 0);
    assert.equal(projection.subjects.length, 1);
    assert.equal(String(projection.subjects[0].subject._id), String(data.subjects[0]._id));
    assert.equal(projection.subjects[0].implicitFromCollection, true);
    assert.equal(projection.subjects[0].relationCount, 0);
    assert.equal(projection.subjects[0].presentationCoverage.collectionItemCount, 1);

    const after = await SemanticGraph.findById(data.semanticGraph._id).lean();
    assert.equal(after.workingVersion, before.workingVersion);
    assert.equal(String(after.workingRevisionId), String(before.workingRevisionId));
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: data.graphRevision._id }), 0);

    await assert.rejects(
      () => getEditorialCollectionGraphNeighborhood({
        editorialContextId: data.context._id,
        view: "working",
        actorUserId: data.user._id,
        focusSubjectId: data.subjects[1]._id,
        limit: 18,
      }),
      (error) => error?.status === 404 && error?.details?.some((entry) => entry.code === "GRAPH_SUBJECT_NOT_FOUND"),
    );
  });
});

test("relation launcher filters Collections by Subject coverage before pagination", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { listEditorialRelationChoices } = require("../services/editorialRelationLauncherV2.service");
    const data = await fixture();
    const other = await createEditorialContextWithGraph({
      contentSpace: data.space,
      namespaceId: data.namespace._id,
      displayName: "Altra raccolta",
      createdBy: data.user._id,
    });

    await addEditorialContextEntry({ editorialContextId: data.context._id, itemId: data.items[0]._id, actorUserId: data.user._id });
    await addEditorialContextEntry({ editorialContextId: other.context._id, itemId: data.items[1]._id, actorUserId: data.user._id });

    const leonardoChoices = await listEditorialRelationChoices({
      actorUserId: data.user._id,
      ownerType: "user",
      ownerId: data.user._id,
      subjectId: data.subjects[0]._id,
      page: 1,
      limit: 1,
    });
    assert.equal(leonardoChoices.pagination.total, 1);
    assert.equal(leonardoChoices.pagination.totalPages, 1);
    assert.equal(leonardoChoices.results.length, 1);
    assert.equal(String(leonardoChoices.results[0].id), String(data.context._id));

    const raffaelloChoices = await listEditorialRelationChoices({
      actorUserId: data.user._id,
      ownerType: "user",
      ownerId: data.user._id,
      subjectId: data.subjects[1]._id,
      page: 1,
      limit: 1,
    });
    assert.equal(raffaelloChoices.pagination.total, 1);
    assert.equal(String(raffaelloChoices.results[0].id), String(other.context._id));

    const caravaggioChoices = await listEditorialRelationChoices({
      actorUserId: data.user._id,
      ownerType: "user",
      ownerId: data.user._id,
      subjectId: data.subjects[2]._id,
      page: 1,
      limit: 1,
    });
    assert.equal(caravaggioChoices.pagination.total, 0);
    assert.deepEqual(caravaggioChoices.results, []);
  });
});
