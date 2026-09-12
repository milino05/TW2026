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

async function baseFixture(username) {
  const User = require("../models/user");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");
  const owner = await User.create({ username, passwordHash: "hash" });
  const namespace = await Namespace.create({ name: `Regole ${username}`, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
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
  const space = await ContentSpace.create({ name: `Spazio ${username}`, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  return { owner, namespace, namespaceRevision, space };
}

test("removing a Collection trashes its local SemanticGraph but preserves immutable revisions", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Subject = require("../models/subject.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { getOwnedWorkspaceRemovalImpact, removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const base = await baseFixture("local-graph-removal");
    const created = await createEditorialContextWithGraph({
      contentSpace: base.space,
      namespaceId: base.namespace._id,
      namespaceRevisionId: base.namespaceRevision._id,
      displayName: "Raccolta locale",
      createdBy: base.owner._id,
    });
    const [a, b] = await Subject.create([
      { preferredLabel: "A", createdBy: base.owner._id },
      { preferredLabel: "B", createdBy: base.owner._id },
    ]);
    await GraphSubjectBinding.insertMany([
      { graphRevisionId: created.graphRevision._id, subjectId: a._id, subjectClassDefinitionIds: [] },
      { graphRevisionId: created.graphRevision._id, subjectId: b._id, subjectClassDefinitionIds: [] },
    ]);
    await SemanticEdgeV2.create({
      graphRevisionId: created.graphRevision._id,
      sourceSubjectId: a._id,
      targetSubjectId: b._id,
      relationTypeDefinitionId: "related",
      weight: 1,
    });

    const impact = await getOwnedWorkspaceRemovalImpact({ resourceType: "editorial_context", resourceId: created.context._id });
    assert.equal(impact.semanticGraphRelationCount, 1);
    assert.equal(impact.semanticGraphCollectionCount, 1);

    const removed = await removeOwnedWorkspaceResource({
      actorUserId: base.owner._id,
      resourceType: "editorial_context",
      resourceId: created.context._id,
    });
    assert.equal(removed.semanticGraphRelationCount, 1);
    assert.equal(removed.semanticGraphCollectionCount, 1);
    assert.equal((await EditorialContext.findById(created.context._id).lean()).lifecycleStatus, "trashed");
    const graph = await SemanticGraph.findById(created.semanticGraph._id).lean();
    assert.equal(graph.lifecycleStatus, "trashed");
    assert.equal(String(graph.workingRevisionId), String(created.graphRevision._id));
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: created.graphRevision._id }), 2);
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: created.graphRevision._id }), 1);
  });
});

test("a live SemanticGraph belongs to exactly one Collection at the persistence boundary", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const base = await baseFixture("one-to-one-graph");
    const first = await createEditorialContextWithGraph({
      contentSpace: base.space,
      namespaceId: base.namespace._id,
      namespaceRevisionId: base.namespaceRevision._id,
      displayName: "Raccolta A",
      createdBy: base.owner._id,
    });

    await assert.rejects(
      () => EditorialContext.create({
        contentSpaceId: base.space._id,
        namespaceId: base.namespace._id,
        semanticGraphId: first.semanticGraph._id,
        displayName: "Raccolta B non valida",
        createdBy: base.owner._id,
      }),
      (error) => error?.code === 11000 && error?.keyPattern?.semanticGraphId === 1,
    );

    assert.equal(await EditorialContext.countDocuments({ semanticGraphId: first.semanticGraph._id }), 1);
    assert.equal((await EditorialContext.findById(first.context._id).lean()).lifecycleStatus, "active");
    assert.equal((await SemanticGraph.findById(first.semanticGraph._id).lean()).lifecycleStatus, "active");
  });
});
