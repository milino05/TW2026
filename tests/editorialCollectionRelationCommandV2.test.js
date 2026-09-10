const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

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

async function fixture() {
  const User = require("../models/user");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");
  const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
  const Subject = require("../models/subject.model");
  const ItemV2 = require("../models/itemV2.model");
  const EditorialContext = require("../models/editorialContext.model");
  const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
  const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");

  const owner = await User.create({ username: `relation-${new mongoose.Types.ObjectId()}`, passwordHash: "hash" });
  const namespace = await Namespace.create({ name: "Regole relazioni", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [],
    languageLevels: [],
    subjectClasses: [],
    relationTypes: [{
      definitionId: "related",
      key: "related",
      label: "Collegato a",
      domainDefinitionIds: [],
      rangeDefinitionIds: [],
      directionality: "directed",
    }],
    presentationAspects: [],
    selectionSignals: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({ name: "Spazio relazioni", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const [subjectA, subjectB] = await Subject.create([
    { preferredLabel: "Opera", createdBy: owner._id },
    { preferredLabel: "Autore", createdBy: owner._id },
  ]);
  const [itemA, itemB1, itemB2] = await ItemV2.create([
    { primarySubjectId: subjectA._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
  ]);
  await ContentSpaceItemMembership.insertMany([itemA, itemB1, itemB2].map((item) => ({
    contentSpaceId: contentSpace._id,
    itemId: item._id,
    addedBy: owner._id,
  })));

  const created = await createEditorialStudioCollection({
    actorUserId: owner._id,
    payload: {
      ownerType: "user",
      ownerId: owner._id,
      contentSpaceId: contentSpace._id,
      namespaceId: namespace._id,
      graphMode: "new",
      graphDisplayName: "Relazioni locali",
      displayName: "Raccolta relazioni",
    },
  });
  const context = await EditorialContext.findById(created.editorialContext.id);
  await addEditorialContextEntry({ editorialContextId: context._id, itemId: itemA._id, actorUserId: owner._id });
  return { owner, namespace, contentSpace, contextId: context._id, subjectA, subjectB, itemA, itemB1, itemB2 };
}

test("relation command requires an explicit Item when multiple ContentSpace presentations back the target Subject", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { addCollectionGraphEdge } = require("../services/editorialCollectionRelationCommand.service");
    const data = await fixture();
    const beforeContext = await EditorialContext.findById(data.contextId).lean();
    const beforeGraph = await SemanticGraph.findById(beforeContext.semanticGraphId).lean();

    await assert.rejects(
      () => addCollectionGraphEdge({
        editorialContextId: data.contextId,
        actorUserId: data.owner._id,
        payload: {
          sourceSubjectId: data.subjectA._id,
          targetSubjectId: data.subjectB._id,
          relationTypeDefinitionId: "related",
        },
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "COLLECTION_GRAPH_TARGET_ITEM_SELECTION_REQUIRED"),
    );

    const afterContext = await EditorialContext.findById(data.contextId).lean();
    const afterGraph = await SemanticGraph.findById(beforeContext.semanticGraphId).lean();
    assert.equal(afterContext.workingVersion, beforeContext.workingVersion);
    assert.equal(String(afterGraph.workingRevisionId), String(beforeGraph.workingRevisionId));
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: data.contextId }), 1);
  });
});

test("relation command atomically adds the selected Item, materializes the Subject and creates the edge", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { addCollectionGraphEdge } = require("../services/editorialCollectionRelationCommand.service");
    const data = await fixture();
    const beforeContext = await EditorialContext.findById(data.contextId).lean();

    await addCollectionGraphEdge({
      editorialContextId: data.contextId,
      actorUserId: data.owner._id,
      payload: {
        sourceSubjectId: data.subjectA._id,
        targetSubjectId: data.subjectB._id,
        targetItemId: data.itemB1._id,
        relationTypeDefinitionId: "related",
      },
    });

    const afterContext = await EditorialContext.findById(data.contextId).lean();
    const graph = await SemanticGraph.findById(afterContext.semanticGraphId).lean();
    const memberships = await CollectionItemMembership.find({ editorialContextId: data.contextId }).lean();
    const bindings = await GraphSubjectBinding.find({ graphRevisionId: graph.workingRevisionId }).lean();
    const edges = await SemanticEdgeV2.find({ graphRevisionId: graph.workingRevisionId }).lean();
    assert.equal(afterContext.workingVersion, beforeContext.workingVersion + 1);
    assert.deepEqual(new Set(memberships.map((entry) => String(entry.itemId))), new Set([String(data.itemA._id), String(data.itemB1._id)]));
    assert.deepEqual(new Set(bindings.map((entry) => String(entry.subjectId))), new Set([String(data.subjectA._id), String(data.subjectB._id)]));
    assert.equal(edges.length, 1);
    assert.equal(String(edges[0].sourceSubjectId), String(data.subjectA._id));
    assert.equal(String(edges[0].targetSubjectId), String(data.subjectB._id));
    assert.equal(edges[0].relationTypeDefinitionId, "related");
  });
});

test("relation command rolls back the Collection membership and version when graph validation fails", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { addCollectionGraphEdge } = require("../services/editorialCollectionRelationCommand.service");
    const data = await fixture();
    const beforeContext = await EditorialContext.findById(data.contextId).lean();
    const beforeGraph = await SemanticGraph.findById(beforeContext.semanticGraphId).lean();

    await assert.rejects(() => addCollectionGraphEdge({
      editorialContextId: data.contextId,
      actorUserId: data.owner._id,
      payload: {
        sourceSubjectId: data.subjectA._id,
        targetSubjectId: data.subjectB._id,
        targetItemId: data.itemB1._id,
        relationTypeDefinitionId: "relation-not-in-namespace",
      },
    }));

    const afterContext = await EditorialContext.findById(data.contextId).lean();
    const afterGraph = await SemanticGraph.findById(beforeContext.semanticGraphId).lean();
    assert.equal(afterContext.workingVersion, beforeContext.workingVersion);
    assert.equal(String(afterGraph.workingRevisionId), String(beforeGraph.workingRevisionId));
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: data.contextId }), 1);
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: data.contextId, itemId: data.itemB1._id }), 0);
  });
});
