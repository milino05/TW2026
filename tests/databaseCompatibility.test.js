const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) {
    if (file.endsWith(".js")) require(path.join(modelsDir, file));
  }
}

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

test("MongoDB 7 accepts every current Mongoose schema and index", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const ping = await mongoose.connection.db.admin().command({ ping: 1 });
    assert.equal(ping.ok, 1);

    loadAllModels();
    const modelNames = mongoose.modelNames();
    assert.ok(modelNames.length > 0, "Nessun modello Mongoose caricato");

    for (const modelName of modelNames) {
      await mongoose.model(modelName).init();
    }
  });
});

test("v2 EditorialContext releases an immutable Subject graph and pinned ItemRevision", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");
    const { addItemMembership } = require("../services/contentSpace.service");
    const { createGraphRevision } = require("../services/semanticGraphV2.service");
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { requestEditorialContextReview, approveEditorialContextReview } = require("../services/editorialContextReview.service");
    const { createEditorialRelease } = require("../services/editorialRelease.service");
    const { projectEditorialContext } = require("../services/editorialContextProjection.service");

    const user = await User.create({ username: "release-v2-test", passwordHash: "test-hash" });
    const [work, person] = await Subject.create([
      { preferredLabel: "Opera", createdBy: user._id },
      { preferredLabel: "Autore", createdBy: user._id },
    ]);
    const namespace = await Namespace.create({ name: "Schema v2", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      subjectClasses: [
        { definitionId: "class-work", key: "work", label: "Opera" },
        { definitionId: "class-person", key: "person", label: "Persona" },
      ],
      relationTypes: [{ definitionId: "rel-created-by", key: "created_by", label: "Creato da", domainDefinitionIds: ["class-work"], rangeDefinitionIds: ["class-person"], directionality: "directed", strength: "strong" }],
      durationTypes: [{ definitionId: "dur-short", key: "short", label: "Breve", targetSeconds: 15 }],
      languageLevels: [{ definitionId: "lang-simple", key: "simple", label: "Semplice" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const contentSpace = await ContentSpace.create({ name: "Workspace", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const { context } = await createEditorialContextWithGraph({
      contentSpace,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Approccio",
      createdBy: user._id,
    });
    const item = await ItemV2.create({ primarySubjectId: work._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    await addItemMembership({ contentSpaceId: contentSpace._id, itemId: item._id, actorUserId: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const revision = new ItemRevisionV2({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Descrizione opera",
      authorCredits: ["Autore test"],
      metadata: { license: "CC BY" },
      presentationVariants: [{
        key: "standard",
        label: "Standard",
        semanticFocus: [{ subjectId: work._id, weight: 1 }],
        representations: [{ durationTypeDefinitionId: "dur-short", languageLevelDefinitionId: "lang-simple", locale: "it-IT", text: "Testo della descrizione" }],
      }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    revision.defaultPresentation = { variantId: revision.presentationVariants[0]._id, representationId: revision.presentationVariants[0].representations[0]._id };
    await revision.save();
    edition.publishedRevisionId = revision._id;
    await edition.save();

    const graph = await createGraphRevision({
      editorialContextId: context._id,
      actorUserId: user._id,
      payload: {
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        subjectBindings: [
          { subjectId: work._id, subjectClassDefinitionIds: ["class-work"] },
          { subjectId: person._id, subjectClassDefinitionIds: ["class-person"] },
        ],
        edges: [{ sourceSubjectId: work._id, targetSubjectId: person._id, relationTypeDefinitionId: "rel-created-by", weight: 10 }],
      },
    });
    const revisedGraph = await createGraphRevision({
      editorialContextId: context._id,
      actorUserId: user._id,
      payload: {
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        basedOnRevisionId: graph.revision._id,
        subjectBindings: [
          { subjectId: work._id, subjectClassDefinitionIds: ["class-work"] },
          { subjectId: person._id, subjectClassDefinitionIds: ["class-person"] },
        ],
        edges: [{ sourceSubjectId: work._id, targetSubjectId: person._id, relationTypeDefinitionId: "rel-created-by", weight: 9 }],
      },
    });
    await assert.rejects(
      () => createGraphRevision({
        editorialContextId: context._id,
        actorUserId: user._id,
        payload: {
          authoredAgainstNamespaceRevisionId: namespaceRevision._id,
          basedOnRevisionId: graph.revision._id,
          subjectBindings: [
            { subjectId: work._id, subjectClassDefinitionIds: ["class-work"] },
            { subjectId: person._id, subjectClassDefinitionIds: ["class-person"] },
          ],
          edges: [{ sourceSubjectId: work._id, targetSubjectId: person._id, relationTypeDefinitionId: "rel-created-by", weight: 8 }],
        },
      }),
      (error) => error?.status === 409 && error?.details?.some((entry) => entry.code === "GRAPH_REVISION_CONFLICT"),
      "una snapshot basata su una revisione superata non deve sostituire il grafo corrente",
    );

    await addEditorialContextEntry({
      editorialContextId: context._id,
      itemId: item._id,
      curationSignals: [],
      actorUserId: user._id,
    });
    const reviewRevision = await requestEditorialContextReview({ editorialContextId: context._id, actorUserId: user._id });
    await approveEditorialContextReview({ editorialContextId: context._id, revisionId: reviewRevision._id, actorUserId: user._id });
    const release = await createEditorialRelease({
      editorialContextId: context._id,
      editorialContextRevisionId: reviewRevision._id,
      actorUserId: user._id,
    });

    const refreshedContext = await EditorialContext.findById(context._id);
    assert.equal(String(refreshedContext.publishedReleaseId), String(release._id));
    assert.equal(String(release.graphRevisionId), String(revisedGraph.revision._id));
    assert.equal(String(release.itemBindings[0].itemId), String(item._id));
    assert.equal(String(release.itemBindings[0].itemRevisionId), String(revision._id));
    assert.equal(release.subjectIds, undefined, "la semantica pubblicata è pinzata dalla GraphRevision, non duplicata nella Release");
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: release.graphRevisionId }), 2);

    const summary = await projectEditorialContext({ editorialContext: refreshedContext, contentSpace, namespace });
    assert.deepEqual(summary.stats, { availableItemCount: 1, subjectCount: 2 });
  });
});
