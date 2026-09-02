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

test("collection removal reports but preserves the shared SemanticGraph working state", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const {
      getOwnedWorkspaceRemovalImpact,
      removeOwnedWorkspaceResource,
    } = require("../services/marketplaceResourceRemovalV2.service");

    const owner = await User.create({ username: "shared-graph-removal", passwordHash: "hash" });
    const namespace = await Namespace.create({
      name: "Regole shared graph removal",
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
      name: "Spazio condiviso removal",
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

    const subjects = await Subject.create([
      { preferredLabel: "A", createdBy: owner._id },
      { preferredLabel: "B", createdBy: owner._id },
      { preferredLabel: "C", createdBy: owner._id },
      { preferredLabel: "D", createdBy: owner._id },
    ]);
    const revision2 = await SemanticGraphRevision.create({
      semanticGraphId: first.semanticGraph._id,
      version: 2,
      basedOnRevisionId: first.graphRevision._id,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      createdBy: owner._id,
    });
    await GraphSubjectBinding.create(subjects.map((subject) => ({
      graphRevisionId: revision2._id,
      subjectId: subject._id,
      subjectClassDefinitionIds: [],
    })));
    await SemanticEdgeV2.create([
      { graphRevisionId: revision2._id, sourceSubjectId: subjects[0]._id, targetSubjectId: subjects[1]._id, relationTypeDefinitionId: "related", weight: 1 },
      { graphRevisionId: revision2._id, sourceSubjectId: subjects[1]._id, targetSubjectId: subjects[2]._id, relationTypeDefinitionId: "related", weight: 1 },
      { graphRevisionId: revision2._id, sourceSubjectId: subjects[2]._id, targetSubjectId: subjects[3]._id, relationTypeDefinitionId: "related", weight: 1 },
    ]);
    await SemanticGraph.updateOne(
      { _id: first.semanticGraph._id },
      { $set: { workingRevisionId: revision2._id, workingVersion: 2 } },
    );

    const impact = await getOwnedWorkspaceRemovalImpact({
      resourceType: "editorial_context",
      resourceId: first.context._id,
    });
    assert.equal(impact.semanticGraphRelationCount, 3, "impact must inspect the current shared graph revision");
    assert.equal(impact.semanticGraphCollectionCount, 2, "impact must report all active collections currently sharing the graph");

    const removed = await removeOwnedWorkspaceResource({
      actorUserId: owner._id,
      resourceType: "editorial_context",
      resourceId: first.context._id,
    });
    assert.equal(removed.semanticGraphRelationCount, 3);
    assert.equal(removed.semanticGraphCollectionCount, 2, "removal result captures the pre-removal sharing state");
    assert.equal((await EditorialContext.findById(first.context._id).lean()).lifecycleStatus, "trashed");
    assert.equal((await EditorialContext.findById(secondContext._id).lean()).lifecycleStatus, "active");

    const graphAfterRemoval = await SemanticGraph.findById(first.semanticGraph._id).lean();
    assert.equal(graphAfterRemoval.lifecycleStatus, "active");
    assert.equal(String(graphAfterRemoval.workingRevisionId), String(revision2._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: revision2._id }), 3);

    const survivingImpact = await getOwnedWorkspaceRemovalImpact({
      resourceType: "editorial_context",
      resourceId: secondContext._id,
    });
    assert.equal(survivingImpact.semanticGraphRelationCount, 3);
    assert.equal(survivingImpact.semanticGraphCollectionCount, 1, "the surviving collection remains attached to the unchanged graph");
  });
});
