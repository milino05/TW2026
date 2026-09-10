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
  const SemanticGraph = require("../models/semanticGraph.model");
  const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
  const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
  const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");

  const owner = await User.create({ username: `graph-import-${new mongoose.Types.ObjectId()}`, passwordHash: "hash" });
  const namespace = await Namespace.create({ name: "Regole importazione", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
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

  const contentSpace = await ContentSpace.create({ name: "Spazio importazione", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const [subjectA, subjectB, subjectC, subjectD] = await Subject.create([
    { preferredLabel: "A", createdBy: owner._id },
    { preferredLabel: "B", createdBy: owner._id },
    { preferredLabel: "C", createdBy: owner._id },
    { preferredLabel: "D", createdBy: owner._id },
  ]);
  const [itemA, itemB1, itemB2] = await ItemV2.create([
    { primarySubjectId: subjectA._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
  ]);
  await ContentSpaceItemMembership.insertMany([itemA, itemB1, itemB2].map((item) => ({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: owner._id })));

  const sourceGraph = await SemanticGraph.create({
    namespaceId: namespace._id,
    displayName: "Grafo sorgente import",
    ownerType: "user",
    ownerId: owner._id,
    createdBy: owner._id,
  });
  const sourceRevision = await SemanticGraphRevision.create({
    semanticGraphId: sourceGraph._id,
    version: 1,
    basedOnRevisionId: null,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    createdBy: owner._id,
  });
  await GraphSubjectBinding.insertMany([subjectA, subjectB, subjectC].map((subject) => ({
    graphRevisionId: sourceRevision._id,
    subjectId: subject._id,
    subjectClassDefinitionIds: [],
  })));
  await SemanticEdgeV2.insertMany([
    { graphRevisionId: sourceRevision._id, sourceSubjectId: subjectA._id, targetSubjectId: subjectB._id, relationTypeDefinitionId: "related", weight: 1 },
    { graphRevisionId: sourceRevision._id, sourceSubjectId: subjectB._id, targetSubjectId: subjectC._id, relationTypeDefinitionId: "related", weight: 1 },
  ]);
  sourceGraph.workingRevisionId = sourceRevision._id;
  sourceGraph.workingVersion = 1;
  await sourceGraph.save();

  return { owner, namespace, namespaceRevision, contentSpace, sourceGraph, sourceRevision, subjectA, subjectB, subjectC, subjectD, itemA, itemB1, itemB2 };
}

function statusBySubject(preview) {
  return new Map((preview.results || []).map((entry) => [String(entry.subject.id), entry]));
}

test("collection graph import pins the source revision and projects only collection-backed subjects", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
    const { listEditorialGraphImportSources, importEditorialGraphSubjects } = require("../services/editorialGraphImport.service");
    const { addGraphSubject } = require("../services/editorialGraphCommand.service");
    const data = await fixture();

    const created = await createEditorialStudioCollection({
      actorUserId: data.owner._id,
      payload: {
        ownerType: "user",
        ownerId: data.owner._id,
        contentSpaceId: data.contentSpace._id,
        namespaceId: data.namespace._id,
        graphMode: "import",
        semanticGraphId: data.sourceGraph._id,
        importItemIds: [data.itemA._id],
        displayName: "Raccolta proiettata",
      },
    });
    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    assert.notEqual(String(localGraph._id), String(data.sourceGraph._id));
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: context._id }), 1);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: localGraph.workingRevisionId }), 1);
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: localGraph.workingRevisionId }), 0);

    const source = await EditorialGraphImportSource.findOne({ editorialContextId: context._id }).lean();
    assert.equal(String(source.sourceGraphRevisionId), String(data.sourceRevision._id));

    await addGraphSubject({ semanticGraphId: data.sourceGraph._id, subjectId: data.subjectD._id, actorUserId: data.owner._id });
    const evolvedSource = await SemanticGraph.findById(data.sourceGraph._id).lean();
    assert.notEqual(String(evolvedSource.workingRevisionId), String(data.sourceRevision._id));

    const sources = await listEditorialGraphImportSources({ editorialContextId: context._id, actorUserId: data.owner._id });
    assert.equal(sources.results.length, 1);
    const preview = sources.results[0].preview;
    assert.equal(String(preview.source.graphRevisionId), String(data.sourceRevision._id));
    assert.equal(preview.summary.totalSubjectCount, 3);
    const bySubject = statusBySubject(preview);
    assert.equal(bySubject.get(String(data.subjectA._id)).status, "active");
    assert.equal(bySubject.get(String(data.subjectB._id)).status, "ambiguous");
    assert.equal(bySubject.get(String(data.subjectB._id)).itemCandidates.length, 2);
    assert.equal(bySubject.get(String(data.subjectC._id)).status, "unavailable");
    assert.equal(bySubject.has(String(data.subjectD._id)), false);

    const imported = await importEditorialGraphSubjects({
      editorialContextId: context._id,
      sourceId: source._id,
      itemIds: [data.itemB1._id],
      actorUserId: data.owner._id,
    });
    assert.equal(imported.importedItemCount, 1);
    const updatedContext = await EditorialContext.findById(context._id).lean();
    const updatedGraph = await SemanticGraph.findById(localGraph._id).lean();
    assert.equal(updatedContext.workingVersion, 2);
    assert.equal(await CollectionItemMembership.countDocuments({ editorialContextId: context._id }), 2);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: updatedGraph.workingRevisionId }), 2);
    const edges = await SemanticEdgeV2.find({ graphRevisionId: updatedGraph.workingRevisionId }).lean();
    assert.equal(edges.length, 1);
    assert.equal(String(edges[0].sourceSubjectId), String(data.subjectA._id));
    assert.equal(String(edges[0].targetSubjectId), String(data.subjectB._id));
    assert.equal(edges[0].provenance.origin, "imported");
    assert.equal(String(edges[0].provenance.sourceGraphRevisionId), String(data.sourceRevision._id));
  });
});

test("collection-bound graph commands enforce containment while standalone graphs remain general", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
    const { addEditorialGraphSubject, addGraphSubject } = require("../services/editorialGraphCommand.service");
    const data = await fixture();

    const created = await createEditorialStudioCollection({
      actorUserId: data.owner._id,
      payload: {
        ownerType: "user",
        ownerId: data.owner._id,
        contentSpaceId: data.contentSpace._id,
        namespaceId: data.namespace._id,
        graphMode: "import",
        semanticGraphId: data.sourceGraph._id,
        importItemIds: [data.itemA._id],
        displayName: "Raccolta containment",
      },
    });
    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();

    await assert.rejects(
      () => addEditorialGraphSubject({ editorialContextId: context._id, subjectId: data.subjectB._id, actorUserId: data.owner._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT"),
    );
    await assert.rejects(
      () => addGraphSubject({ semanticGraphId: localGraph._id, subjectId: data.subjectB._id, actorUserId: data.owner._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "SEMANTIC_GRAPH_COLLECTION_BOUND_USE_CONTEXT_API"),
    );

    await addGraphSubject({ semanticGraphId: data.sourceGraph._id, subjectId: data.subjectD._id, actorUserId: data.owner._id });
    const sourceAfter = await SemanticGraph.findById(data.sourceGraph._id).lean();
    assert.equal(sourceAfter.workingVersion, 2);
  });
});

test("local deletion of an imported edge is authoritative across later source activations", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const ItemV2 = require("../models/itemV2.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
    const { importEditorialGraphSubjects } = require("../services/editorialGraphImport.service");
    const { removeEditorialGraphEdge } = require("../services/editorialGraphCommand.service");
    const data = await fixture();

    const created = await createEditorialStudioCollection({
      actorUserId: data.owner._id,
      payload: {
        ownerType: "user",
        ownerId: data.owner._id,
        contentSpaceId: data.contentSpace._id,
        namespaceId: data.namespace._id,
        graphMode: "import",
        semanticGraphId: data.sourceGraph._id,
        importItemIds: [data.itemA._id],
        displayName: "Raccolta con override locale",
      },
    });
    const context = await EditorialContext.findById(created.editorialContext.id).lean();
    const source = await EditorialGraphImportSource.findOne({ editorialContextId: context._id });

    await importEditorialGraphSubjects({
      editorialContextId: context._id,
      sourceId: source._id,
      itemIds: [data.itemB1._id],
      actorUserId: data.owner._id,
    });

    let localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    let edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(edges.length, 1);
    const importedAB = edges[0];

    await removeEditorialGraphEdge({
      editorialContextId: context._id,
      edgeId: importedAB._id,
      actorUserId: data.owner._id,
    });

    const sourceAfterDelete = await EditorialGraphImportSource.findById(source._id).lean();
    assert.equal(sourceAfterDelete.suppressedEdgeKeys.length, 1);

    const itemC = await ItemV2.create({
      primarySubjectId: data.subjectC._id,
      ownerType: "user",
      ownerId: data.owner._id,
      createdBy: data.owner._id,
    });
    await ContentSpaceItemMembership.create({
      contentSpaceId: data.contentSpace._id,
      itemId: itemC._id,
      addedBy: data.owner._id,
    });

    const activatedC = await importEditorialGraphSubjects({
      editorialContextId: context._id,
      sourceId: source._id,
      itemIds: [itemC._id],
      actorUserId: data.owner._id,
    });
    assert.equal(activatedC.activatedSubjectCount, 1);
    assert.equal(activatedC.activatedRelationCount, 1);

    localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(edges.length, 1);
    assert.equal(String(edges[0].sourceSubjectId), String(data.subjectB._id));
    assert.equal(String(edges[0].targetSubjectId), String(data.subjectC._id));
    assert.equal(edges.some((edge) => String(edge.sourceSubjectId) === String(data.subjectA._id) && String(edge.targetSubjectId) === String(data.subjectB._id)), false);
  });
});
