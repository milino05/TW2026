const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_runtime_direct_semantic_actions_v2`;
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

function id(value) { return String(value?._id || value || ""); }

async function createPublishedItem({ ItemV2, ItemEdition, ItemRevisionV2, owner, subjectId, namespaceId, namespaceRevisionId, label, text }) {
  const item = await ItemV2.create({
    primarySubjectId: subjectId,
    ownerType: "user",
    ownerId: owner._id,
    createdBy: owner._id,
  });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId, createdBy: owner._id });
  const revision = new ItemRevisionV2({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevisionId,
    label,
    authorCredits: ["Autore demo"],
    metadata: { license: "CC BY" },
    presentationVariants: [{
      key: "standard",
      label: "Standard",
      representations: [{
        durationTypeDefinitionId: "duration-short",
        languageLevelDefinitionId: "language-simple",
        locale: "it-IT",
        text,
      }],
    }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
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

test("una Visit con ItemRevision diretta espone le relazioni del graph pinned e il contenuto target owned anche fuori dalla sequenza", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const { createExecutionPreparation, startExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");

    const owner = await User.create({ username: "direct-semantic-owner", passwordHash: "test-hash" });
    const [artworkSubject, artistSubject] = await Subject.create([
      { preferredLabel: "Item 1", createdBy: owner._id },
      { preferredLabel: "Item 2", createdBy: owner._id },
    ]);

    const namespace = await Namespace.create({
      name: "Namespace collegamenti diretti",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      relationTypes: [{
        definitionId: "relation-created-by",
        key: "created_by",
        label: "Autore",
        category: "semantic",
        strength: "strong",
        userIntents: ["chi è l'autore"],
        directionality: "directed",
        reverse: { label: "Ha creato", userIntents: [] },
      }],
      durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 20 }],
      languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const main = await createPublishedItem({
      ItemV2, ItemEdition, ItemRevisionV2, owner,
      subjectId: artworkSubject._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      label: "Item 1",
      text: "Descrizione di Item 1.",
    });
    const artist = await createPublishedItem({
      ItemV2, ItemEdition, ItemRevisionV2, owner,
      subjectId: artistSubject._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      label: "Item 2",
      text: "Item 2 è il contenuto collegato come autore.",
    });

    const contentSpace = await ContentSpace.create({
      name: "Collegamenti personali",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const { context, graphRevision } = await createEditorialContextWithGraph({
      contentSpace,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Collegamenti Item 1",
      createdBy: owner._id,
    });
    await ContentSpaceMembership.create({ contentSpaceId: contentSpace._id, itemId: main.item._id, addedBy: owner._id });

    await GraphSubjectBinding.insertMany([
      { graphRevisionId: graphRevision._id, subjectId: artworkSubject._id, subjectClassDefinitionIds: [] },
      { graphRevisionId: graphRevision._id, subjectId: artistSubject._id, subjectClassDefinitionIds: [] },
    ]);
    await SemanticEdgeV2.create({
      graphRevisionId: graphRevision._id,
      sourceSubjectId: artworkSubject._id,
      targetSubjectId: artistSubject._id,
      relationTypeDefinitionId: "relation-created-by",
      weight: 10,
    });

    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const directSourceId = new mongoose.Types.ObjectId();
    const visitRevision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visit direct semantic actions",
      contentSources: [{ _id: directSourceId, sourceType: "item_revision", itemRevisionId: main.revision._id }],
      contentEntries: [{
        contentSourceId: directSourceId,
        itemId: main.item._id,
        itemEditionId: main.edition._id,
        itemRevisionId: main.revision._id,
        deliveryAnchorId: null,
        role: "core",
      }],
      visitAnchors: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = visitRevision._id;
    await visit.save();

    const preparation = await createExecutionPreparation({ userId: owner._id, payload: { visitId: visit._id } });
    const started = await startExecutionPreparation({
      preparationId: preparation.id,
      userId: owner._id,
      expectedVersion: preparation.version,
    });

    const plan = await SessionPlanRevisionV2.findById(started.current.planRevisionId).lean();
    assert.equal(plan.sourceEditorialReleaseIds.length, 0);
    assert.equal(plan.semanticGraphPins.length, 1);
    assert.equal(id(plan.semanticGraphPins[0].graphRevisionId), id(graphRevision._id));
    assert.ok(plan.semanticContentPins.some((entry) => id(entry.itemRevisionId) === id(artist.revision._id)), "Item 2 deve essere pinzato come contenuto semantico anche se non è nella sequenza della Visit");

    const authorAction = started.current.availableActions.find((entry) =>
      entry.family === "semantic" && entry.label === "Chi è l'autore");
    assert.ok(authorAction, "created_by deve materializzare un'azione naturale per una ItemRevision diretta");
    assert.deepEqual(authorAction.controlledVoiceAliases, ["chi è l'autore"]);

    const result = await dispatchAction({
      sessionId: started.session._id,
      userId: owner._id,
      payload: {
        actionId: authorAction.actionId,
        expectedRuntimeVersion: 1,
        interactionChannel: "controlled_voice",
      },
    });
    assert.equal(result.runtime.current.label, "Item 2");
    assert.equal(result.runtime.current.presentation.kind, "semantic_exploration");
    assert.equal(result.runtime.current.presentation.text, "Item 2 è il contenuto collegato come autore.");

    const persisted = await VisitSessionV2.findById(started.session._id).lean();
    assert.equal(persisted.semanticPresentation.sourceType, "direct_item");
    assert.equal(persisted.semanticPresentation.sourceEditorialReleaseId, null);
    assert.equal(id(persisted.semanticPresentation.itemRevisionId), id(artist.revision._id));
  });
});
