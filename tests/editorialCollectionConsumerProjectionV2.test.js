const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_collection_consumer_projection_v2`;
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

test("collection consumers project graph traversal and semantic search to pinned release Items", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const {
      resolveEditorialReleaseCollectionProjection,
    } = require("../services/editorialCollectionConsumerProjectionV2.service");
    const { subjectIdsForResolvedSources } = require("../services/generationSemanticOptionsV2.service");

    const user = await User.create({ username: "collection-consumer-projection", passwordHash: "hash" });
    const [inside, outside] = await Subject.create([
      { preferredLabel: "Dentro la raccolta", createdBy: user._id },
      { preferredLabel: "Fuori dalla raccolta", createdBy: user._id },
    ]);
    const namespace = await Namespace.create({
      name: "Regole proiezione consumer",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      subjectClasses: [],
      relationTypes: [{
        definitionId: "related",
        key: "related",
        label: "Correlato",
        directionality: "directed",
        strength: "medium",
      }],
      durationTypes: [],
      languageLevels: [],
      presentationAspects: [],
      selectionSignals: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const graph = await SemanticGraph.create({
      namespaceId: namespace._id,
      displayName: "Grafo volutamente sovraesteso",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const graphRevision = await SemanticGraphRevision.create({
      semanticGraphId: graph._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      createdBy: user._id,
    });
    graph.workingRevisionId = graphRevision._id;
    graph.workingVersion = 1;
    await graph.save();
    await GraphSubjectBinding.create([
      { graphRevisionId: graphRevision._id, subjectId: inside._id, subjectClassDefinitionIds: [] },
      { graphRevisionId: graphRevision._id, subjectId: outside._id, subjectClassDefinitionIds: [] },
    ]);
    await SemanticEdgeV2.create({
      graphRevisionId: graphRevision._id,
      sourceSubjectId: inside._id,
      targetSubjectId: outside._id,
      relationTypeDefinitionId: "related",
      weight: 1,
      provenance: { origin: "human" },
    });

    const item = await ItemV2.create({
      primarySubjectId: inside._id,
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const edition = await ItemEdition.create({
      itemId: item._id,
      namespaceId: namespace._id,
      createdBy: user._id,
    });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto interno",
      relatedSubjectIds: [outside._id],
      presentationVariants: [{
        key: "default",
        label: "Default",
        semanticFocus: [{ subjectId: outside._id, weight: 1 }],
        knowledgeRequirements: [{ subjectId: outside._id, minLevel: 0, maxLevel: 1, weight: 1 }],
        representations: [],
      }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();

    const release = await EditorialRelease.create({
      editorialContextId: new mongoose.Types.ObjectId(),
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graphRevision._id,
      itemBindings: [{
        itemId: item._id,
        itemEditionId: edition._id,
        itemRevisionId: revision._id,
        curationSignals: [],
      }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      releasedAt: new Date(),
      releasedBy: user._id,
    });

    const projection = await resolveEditorialReleaseCollectionProjection({ release: release.toObject() });
    assert.deepEqual(projection.itemSubjectIds, [String(inside._id)]);
    assert.deepEqual(projection.graphSubjectIds, [String(inside._id)]);
    assert.equal(projection.graph.nodes.has(String(outside._id)), false);
    assert.equal(projection.graph.authoritativeEdges.length, 0);
    assert.equal(projection.graph.edgesFrom.size, 0);

    const searchableSubjectIds = await subjectIdsForResolvedSources([{ editorialRelease: release.toObject() }]);
    assert.deepEqual(searchableSubjectIds, [String(inside._id)]);
  });
});
