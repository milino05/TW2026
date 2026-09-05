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

test("Graph Workspace legge summary, primo livello e inventario paginato senza materializzare tutto il grafo", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const ContentSpace = require("../models/contentSpace.model");
    const Subject = require("../models/subject.model");
    const CollectionSubjectMembership = require("../models/collectionSubjectMembership.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { getEditorialContextGraphNeighborhood, searchEditorialGraphSubjectCandidates } = require("../services/editorialContextGraph.service");

    const user = await User.create({ username: "graph-neighborhood-owner", passwordHash: "hash" });
    const namespaceId = new mongoose.Types.ObjectId();
    const namespaceRevisionId = new mongoose.Types.ObjectId();
    const contentSpace = await ContentSpace.create({
      name: "Spazio grafo scalabile",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const { context, graphRevision } = await createEditorialContextWithGraph({
      contentSpace,
      namespaceId,
      namespaceRevisionId,
      displayName: "Raccolta grafo scalabile",
      createdBy: user._id,
    });

    const subjects = await Subject.create([
      { preferredLabel: "Centro", createdBy: user._id },
      ...Array.from({ length: 24 }, (_, index) => ({
        preferredLabel: `Nodo ${String(index + 1).padStart(2, "0")}`,
        description: `Vicino ${index + 1}`,
        createdBy: user._id,
      })),
    ]);
    await CollectionSubjectMembership.insertMany(subjects.map((subject) => ({
      editorialContextId: context._id,
      subjectId: subject._id,
      addedBy: user._id,
    })));
    await GraphSubjectBinding.insertMany(subjects.map((subject) => ({
      graphRevisionId: graphRevision._id,
      subjectId: subject._id,
      subjectClassDefinitionIds: [],
    })));
    await SemanticEdgeV2.insertMany(subjects.slice(1).map((subject, index) => ({
      graphRevisionId: graphRevision._id,
      sourceSubjectId: subjects[0]._id,
      targetSubjectId: subject._id,
      relationTypeDefinitionId: index % 2 ? "related-b" : "related-a",
      weight: 1,
    })));

    const summary = await getEditorialContextGraphNeighborhood({
      editorialContextId: context._id,
      actorUserId: user._id,
      view: "working",
      limit: 5,
    });
    assert.equal(summary.subjects.length, 0, "senza focus il workspace non deve scaricare i nodi");
    assert.equal(summary.edges.length, 0, "senza focus il workspace non deve scaricare gli edge");
    assert.equal(summary.neighborhood.totalSubjects, 25);
    assert.equal(summary.neighborhood.totalEdges, 24);

    const focused = await getEditorialContextGraphNeighborhood({
      editorialContextId: context._id,
      actorUserId: user._id,
      view: "working",
      focusSubjectId: subjects[0]._id,
      limit: 5,
    });
    assert.equal(focused.subjects.length, 6, "focus + cinque vicini visibili");
    assert.equal(focused.edges.length, 5);
    assert.equal(focused.neighborhood.totalNeighbors, 24);
    assert.equal(focused.neighborhood.visibleNeighbors, 5);
    assert.equal(focused.neighborhood.hiddenNeighbors, 19);
    const focus = focused.subjects.find((entry) => String(entry.subject._id) === String(subjects[0]._id));
    assert.equal(focus.relationCount, 24, "il conteggio del focus resta globale anche se la projection è parziale");
    assert.equal(focused.subjects.filter((entry) => String(entry.subject._id) !== String(subjects[0]._id)).every((entry) => entry.relationCount === 1), true);

    const inventory = await searchEditorialGraphSubjectCandidates({
      editorialContextId: context._id,
      actorUserId: user._id,
      scope: "graph",
      q: "Nodo",
      page: 2,
      limit: 10,
    });
    assert.equal(inventory.pagination.total, 24);
    assert.equal(inventory.pagination.totalPages, 3);
    assert.equal(inventory.results.length, 10);
    assert.equal(inventory.results.every((entry) => entry.inGraph === true), true);
    assert.equal(inventory.results.every((entry) => entry.relationCount === 1), true);
  });
});