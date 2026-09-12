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

async function createGraph({ SemanticGraph, SemanticGraphRevision, GraphSubjectBinding, SemanticEdgeV2, namespaceId, namespaceRevisionId, ownerId, name, bindings, edges }) {
  const graph = await SemanticGraph.create({ namespaceId, displayName: name, ownerType: "user", ownerId, createdBy: ownerId });
  const revision = await SemanticGraphRevision.create({
    semanticGraphId: graph._id,
    version: 1,
    basedOnRevisionId: null,
    authoredAgainstNamespaceRevisionId: namespaceRevisionId,
    createdBy: ownerId,
  });
  if (bindings.length) await GraphSubjectBinding.insertMany(bindings.map((entry) => ({ graphRevisionId: revision._id, ...entry })));
  if (edges.length) await SemanticEdgeV2.insertMany(edges.map((entry) => ({ graphRevisionId: revision._id, weight: 1, ...entry })));
  graph.workingRevisionId = revision._id;
  graph.workingVersion = 1;
  await graph.save();
  return { graph, revision };
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
    subjectClasses: [
      { definitionId: "class-a", key: "class-a", label: "Classe A" },
      { definitionId: "class-b", key: "class-b", label: "Classe B" },
    ],
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
  namespace.workingRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({ name: "Spazio importazione", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const [subjectA, subjectB, subjectC, subjectD] = await Subject.create([
    { preferredLabel: "A", createdBy: owner._id },
    { preferredLabel: "B", createdBy: owner._id },
    { preferredLabel: "C", createdBy: owner._id },
    { preferredLabel: "D", createdBy: owner._id },
  ]);
  const [itemA, itemB1, itemB2, itemC] = await ItemV2.create([
    { primarySubjectId: subjectA._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectB._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    { primarySubjectId: subjectC._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
  ]);
  await ContentSpaceItemMembership.insertMany([itemA, itemB1, itemB2, itemC].map((item) => ({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: owner._id })));

  const sourceOne = await createGraph({
    SemanticGraph, SemanticGraphRevision, GraphSubjectBinding, SemanticEdgeV2,
    namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, ownerId: owner._id, name: "Grafo sorgente uno",
    bindings: [
      { subjectId: subjectA._id, subjectClassDefinitionIds: ["class-a"] },
      { subjectId: subjectB._id, subjectClassDefinitionIds: ["class-a"] },
      { subjectId: subjectC._id, subjectClassDefinitionIds: ["class-a"] },
    ],
    edges: [
      { sourceSubjectId: subjectA._id, targetSubjectId: subjectB._id, relationTypeDefinitionId: "related" },
      { sourceSubjectId: subjectB._id, targetSubjectId: subjectC._id, relationTypeDefinitionId: "related" },
    ],
  });
  const sourceTwo = await createGraph({
    SemanticGraph, SemanticGraphRevision, GraphSubjectBinding, SemanticEdgeV2,
    namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, ownerId: owner._id, name: "Grafo sorgente due",
    bindings: [
      { subjectId: subjectA._id, subjectClassDefinitionIds: ["class-b"] },
      { subjectId: subjectB._id, subjectClassDefinitionIds: ["class-b"] },
    ],
    edges: [
      { sourceSubjectId: subjectA._id, targetSubjectId: subjectB._id, relationTypeDefinitionId: "related" },
    ],
  });

  return {
    owner, namespace, namespaceRevision, contentSpace,
    sourceGraph: sourceOne.graph, sourceRevision: sourceOne.revision,
    secondSourceGraph: sourceTwo.graph, secondSourceRevision: sourceTwo.revision,
    subjectA, subjectB, subjectC, subjectD, itemA, itemB1, itemB2, itemC,
  };
}

async function createCollection(data, name = "Raccolta") {
  const { createEditorialStudioCollection } = require("../services/editorialStudioCreationV2.service");
  const EditorialContext = require("../models/editorialContext.model");
  const created = await createEditorialStudioCollection({
    actorUserId: data.owner._id,
    payload: {
      ownerType: "user",
      ownerId: data.owner._id,
      contentSpaceId: data.contentSpace._id,
      namespaceId: data.namespace._id,
      displayName: name,
    },
  });
  return EditorialContext.findById(created.editorialContext.id).lean();
}

function statusBySubject(preview) {
  return new Map((preview.results || []).map((entry) => [String(entry.subject.id), entry]));
}

test("source pin stays on its immutable revision until explicit update", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { addGraphSubject } = require("../services/editorialGraphCommand.service");
    const {
      attachEditorialGraphImportSource,
      listEditorialGraphImportSources,
      previewEditorialGraphImportSourceUpdate,
      updateEditorialGraphImportSource,
      importEditorialGraphSubjects,
    } = require("../services/editorialGraphImport.service");
    const data = await fixture();
    const context = await createCollection(data, "Raccolta pin");

    const attached = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.sourceGraph._id, actorUserId: data.owner._id });
    const sourceId = attached.source._id;
    assert.equal(String(attached.source.sourceGraphRevisionId), String(data.sourceRevision._id));
    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId, itemIds: [data.itemA._id], actorUserId: data.owner._id });

    await addGraphSubject({ semanticGraphId: data.sourceGraph._id, subjectId: data.subjectD._id, actorUserId: data.owner._id });
    const evolvedSource = await SemanticGraph.findById(data.sourceGraph._id).lean();
    assert.notEqual(String(evolvedSource.workingRevisionId), String(data.sourceRevision._id));

    const sourcesBefore = await listEditorialGraphImportSources({ editorialContextId: context._id, actorUserId: data.owner._id });
    assert.equal(sourcesBefore.results[0].updateAvailable, true);
    assert.equal(String(sourcesBefore.results[0].preview.source.graphRevisionId), String(data.sourceRevision._id));
    assert.equal(sourcesBefore.results[0].preview.summary.totalSubjectCount, 3);
    assert.equal(statusBySubject(sourcesBefore.results[0].preview).has(String(data.subjectD._id)), false);

    const updatePreview = await previewEditorialGraphImportSourceUpdate({ editorialContextId: context._id, sourceId, actorUserId: data.owner._id });
    assert.equal(updatePreview.updateAvailable, true);
    assert.equal(updatePreview.diff.addedSubjectCount, 1);
    await updateEditorialGraphImportSource({ editorialContextId: context._id, sourceId, actorUserId: data.owner._id });

    const pinAfter = await EditorialGraphImportSource.findById(sourceId).lean();
    assert.equal(String(pinAfter.sourceGraphRevisionId), String(evolvedSource.workingRevisionId));
    const sourcesAfter = await listEditorialGraphImportSources({ editorialContextId: context._id, actorUserId: data.owner._id });
    assert.equal(sourcesAfter.results[0].updateAvailable, false);
    assert.equal(statusBySubject(sourcesAfter.results[0].preview).has(String(data.subjectD._id)), true);
  });
});

test("multiple pinned sources share global Subjects, keep local classification authoritative and deduplicate the same edge", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const SemanticGraph = require("../models/semanticGraph.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const {
      attachEditorialGraphImportSource,
      listEditorialGraphImportSources,
      importEditorialGraphSubjects,
      detachEditorialGraphImportSource,
    } = require("../services/editorialGraphImport.service");
    const data = await fixture();
    const context = await createCollection(data, "Raccolta multi-source");

    const first = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.sourceGraph._id, actorUserId: data.owner._id });
    const duplicateAttach = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.sourceGraph._id, actorUserId: data.owner._id });
    assert.equal(String(first.source._id), String(duplicateAttach.source._id));
    const second = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.secondSourceGraph._id, actorUserId: data.owner._id });

    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId: first.source._id, itemIds: [data.itemA._id], actorUserId: data.owner._id });
    const sources = await listEditorialGraphImportSources({ editorialContextId: context._id, actorUserId: data.owner._id });
    const secondPreview = sources.results.find((entry) => String(entry.id) === String(second.source._id)).preview;
    const aFromSecond = statusBySubject(secondPreview).get(String(data.subjectA._id));
    assert.equal(aFromSecond.status, "active");
    assert.equal(aFromSecond.classificationConflict, true);

    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId: second.source._id, itemIds: [data.itemB1._id], actorUserId: data.owner._id });
    let localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    let bindings = await GraphSubjectBinding.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    let edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(bindings.length, 2);
    assert.equal(edges.length, 1);
    const bindingA = bindings.find((entry) => String(entry.subjectId) === String(data.subjectA._id));
    assert.deepEqual(bindingA.subjectClassDefinitionIds, ["class-a"]);

    await detachEditorialGraphImportSource({ editorialContextId: context._id, sourceId: second.source._id, actorUserId: data.owner._id });
    localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    bindings = await GraphSubjectBinding.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(bindings.length, 2);
    assert.equal(edges.length, 1);
  });
});

test("deleting a source-supported local edge creates one local suppression and restore derives all supporting sources", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const EditorialGraphEdgeSuppression = require("../models/editorialGraphEdgeSuppression.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { removeEditorialGraphEdge } = require("../services/editorialGraphCommand.service");
    const {
      attachEditorialGraphImportSource,
      importEditorialGraphSubjects,
      listRestorableEditorialGraphEdges,
      restoreEditorialGraphEdge,
    } = require("../services/editorialGraphImport.service");
    const data = await fixture();
    const context = await createCollection(data, "Raccolta restore");
    const first = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.sourceGraph._id, actorUserId: data.owner._id });
    const second = await attachEditorialGraphImportSource({ editorialContextId: context._id, sourceSemanticGraphId: data.secondSourceGraph._id, actorUserId: data.owner._id });

    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId: first.source._id, itemIds: [data.itemA._id], actorUserId: data.owner._id });
    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId: second.source._id, itemIds: [data.itemB1._id], actorUserId: data.owner._id });
    let localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    let edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(edges.length, 1);

    await removeEditorialGraphEdge({ editorialContextId: context._id, edgeId: edges[0]._id, actorUserId: data.owner._id });
    assert.equal(await EditorialGraphEdgeSuppression.countDocuments({ editorialContextId: context._id }), 1);

    const restorable = await listRestorableEditorialGraphEdges({ editorialContextId: context._id, actorUserId: data.owner._id });
    assert.equal(restorable.results.length, 1);
    assert.equal(restorable.results[0].supportSources.length, 2);

    await importEditorialGraphSubjects({ editorialContextId: context._id, sourceId: first.source._id, itemIds: [data.itemC._id], actorUserId: data.owner._id });
    localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(edges.some((edge) => String(edge.sourceSubjectId) === String(data.subjectA._id) && String(edge.targetSubjectId) === String(data.subjectB._id)), false);
    assert.equal(edges.some((edge) => String(edge.sourceSubjectId) === String(data.subjectB._id) && String(edge.targetSubjectId) === String(data.subjectC._id)), true);

    await restoreEditorialGraphEdge({ editorialContextId: context._id, suppressionId: restorable.results[0].id, actorUserId: data.owner._id });
    assert.equal(await EditorialGraphEdgeSuppression.countDocuments({ editorialContextId: context._id }), 0);
    localGraph = await SemanticGraph.findById(context.semanticGraphId).lean();
    edges = await SemanticEdgeV2.find({ graphRevisionId: localGraph.workingRevisionId }).lean();
    assert.equal(edges.length, 2);
  });
});

test("collection-bound graph commands enforce containment while standalone source graphs remain independently editable", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const SemanticGraph = require("../models/semanticGraph.model");
    const { addEditorialGraphSubject, addGraphSubject } = require("../services/editorialGraphCommand.service");
    const data = await fixture();
    const context = await createCollection(data, "Raccolta containment");

    await assert.rejects(
      () => addEditorialGraphSubject({ editorialContextId: context._id, subjectId: data.subjectB._id, actorUserId: data.owner._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT"),
    );
    await assert.rejects(
      () => addGraphSubject({ semanticGraphId: context.semanticGraphId, subjectId: data.subjectB._id, actorUserId: data.owner._id }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "SEMANTIC_GRAPH_COLLECTION_BOUND_USE_CONTEXT_API"),
    );

    await addGraphSubject({ semanticGraphId: data.sourceGraph._id, subjectId: data.subjectD._id, actorUserId: data.owner._id });
    const sourceAfter = await SemanticGraph.findById(data.sourceGraph._id).lean();
    assert.equal(sourceAfter.workingVersion, 2);
  });
});
