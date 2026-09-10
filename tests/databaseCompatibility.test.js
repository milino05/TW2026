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
    const { addEditorialContextEntry } = require("../services/editorialContextEntry.service");
    const { addEditorialGraphEdge, updateEditorialGraphEdge } = require("../services/editorialGraphCommand.service");
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
      relationTypes: [{
        definitionId: "rel-created-by",
        key: "created_by",
        label: "Creato da",
        domainDefinitionIds: ["class-work"],
        rangeDefinitionIds: ["class-person"],
        directionality: "directed",
        strength: "strong",
      }],
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

    async function createPublishedItem({ subject, label, text }) {
      const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
      await addItemMembership({ contentSpaceId: contentSpace._id, itemId: item._id, actorUserId: user._id });
      const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
      const revision = new ItemRevisionV2({
        itemEditionId: edition._id,
        version: 1,
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        label,
        authorCredits: ["Autore test"],
        metadata: { license: "CC BY" },
        presentationVariants: [{
          key: "standard",
          label: "Standard",
          semanticFocus: [{ subjectId: subject._id, weight: 1 }],
          representations: [{
            durationTypeDefinitionId: "dur-short",
            languageLevelDefinitionId: "lang-simple",
            locale: "it-IT",
            text,
          }],
        }],
        status: "published",
        integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
        publication: { publishedAt: new Date(), publishedBy: user._id },
        createdBy: user._id,
        updatedBy: user._id,
      });
      revision.defaultPresentation = {
        variantId: revision.presentationVariants[0]._id,
        representationId: revision.presentationVariants[0].representations[0]._id,
      };
      await revision.save();
      edition.publishedRevisionId = revision._id;
      await edition.save();
      return { item, edition, revision };
    }

    const workContent = await createPublishedItem({
      subject: work,
      label: "Descrizione opera",
      text: "Testo della descrizione",
    });
    const personContent = await createPublishedItem({
      subject: person,
      label: "Profilo autore",
      text: "Testo sul profilo dell'autore",
    });

    for (const content of [workContent, personContent]) {
      await addEditorialContextEntry({
        editorialContextId: context._id,
        itemId: content.item._id,
        curationSignals: [],
        actorUserId: user._id,
      });
    }

    const graph = await addEditorialGraphEdge({
      editorialContextId: context._id,
      actorUserId: user._id,
      payload: {
        sourceSubjectId: work._id,
        targetSubjectId: person._id,
        relationTypeDefinitionId: "rel-created-by",
        weight: 10,
        subjectClassAssignments: [
          { subjectId: work._id, subjectClassDefinitionIds: ["class-work"] },
          { subjectId: person._id, subjectClassDefinitionIds: ["class-person"] },
        ],
      },
    });
    const revisedGraph = await updateEditorialGraphEdge({
      editorialContextId: context._id,
      edgeId: graph.authoritativeEdges[0]._id,
      actorUserId: user._id,
      payload: { weight: 9 },
    });

    const reviewRevision = await requestEditorialContextReview({
      editorialContextId: context._id,
      actorUserId: user._id,
    });
    await approveEditorialContextReview({
      editorialContextId: context._id,
      revisionId: reviewRevision._id,
      actorUserId: user._id,
    });
    const release = await createEditorialRelease({
      editorialContextId: context._id,
      editorialContextRevisionId: reviewRevision._id,
      actorUserId: user._id,
    });

    const refreshedContext = await EditorialContext.findById(context._id);
    assert.equal(String(refreshedContext.publishedReleaseId), String(release._id));
    assert.equal(String(release.graphRevisionId), String(revisedGraph.revision._id));
    const releasedWork = release.itemBindings.find((binding) => String(binding.itemId) === String(workContent.item._id));
    assert.ok(releasedWork);
    assert.equal(String(releasedWork.itemRevisionId), String(workContent.revision._id));
    assert.equal(release.itemBindings.length, 2);
    assert.equal(release.subjectIds, undefined, "la semantica pubblicata è pinzata dalla GraphRevision, non duplicata nella Release");
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: release.graphRevisionId }), 2);

    const summary = await projectEditorialContext({ editorialContext: refreshedContext, contentSpace, namespace });
    assert.deepEqual(summary.stats, { availableItemCount: 2, subjectCount: 2 });
  });
});
