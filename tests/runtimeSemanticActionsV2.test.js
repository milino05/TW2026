const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_runtime_semantic_actions_v2`;
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

async function createPublishedItem({
  ItemV2,
  ItemEdition,
  ItemRevisionV2,
  owner,
  subjectId,
  namespaceId,
  namespaceRevisionId,
  label,
  text,
}) {
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
    authorCredits: ["Autore editoriale demo"],
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

test("semantic Actions derivano da Item/Subject/Graph pinzati senza catalogo globale author/style", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const {
      createExecutionPreparation,
      startExecutionPreparation,
    } = require("../services/executionPreparationV2.service");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");

    const owner = await User.create({ username: "semantic-actions-owner", passwordHash: "test-hash" });
    const [artworkSubject, artistSubject] = await Subject.create([
      { preferredLabel: "Opera Demo", createdBy: owner._id },
      { preferredLabel: "Girolamo Bedoli", createdBy: owner._id },
    ]);

    const namespace = await Namespace.create({
      name: "Namespace semantico demo",
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
        userIntents: ["chi è l'autore", "dimmi chi ha creato l'opera"],
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

    const contentSpace = await ContentSpace.create({
      name: "Spazio semantico demo",
      ownerType: "user",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    const { context, graphRevision } = await createEditorialContextWithGraph({
      contentSpace,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Contesto semantico demo",
      createdBy: owner._id,
    });
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

    const main = await createPublishedItem({
      ItemV2,
      ItemEdition,
      ItemRevisionV2,
      owner,
      subjectId: artworkSubject._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      label: "Opera principale",
      text: "Descrizione principale dell'opera.",
    });
    const curiosity = await createPublishedItem({
      ItemV2,
      ItemEdition,
      ItemRevisionV2,
      owner,
      subjectId: artworkSubject._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      label: "Curiosità sull'opera",
      text: "Una curiosità editoriale sullo stesso soggetto.",
    });
    const artist = await createPublishedItem({
      ItemV2,
      ItemEdition,
      ItemRevisionV2,
      owner,
      subjectId: artistSubject._id,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      label: "Girolamo Bedoli",
      text: "Girolamo Bedoli è l'autore collegato dal graph demo.",
    });

    const release = await EditorialRelease.create({
      editorialContextId: context._id,
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graphRevision._id,
      subjectIds: [artworkSubject._id, artistSubject._id],
      itemBindings: [main, curiosity, artist].map((value) => ({
        itemId: value.item._id,
        itemEditionId: value.edition._id,
        itemRevisionId: value.revision._id,
        curationSignals: [],
      })),
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      releasedAt: new Date(),
      releasedBy: owner._id,
    });
    context.publishedReleaseId = release._id;
    await context.save();

    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const editorialSourceId = new mongoose.Types.ObjectId();
    const visitRevision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visit semantic actions",
      editorialSources: [{ _id: editorialSourceId, editorialReleaseId: release._id }],
      contentEntries: [{
        editorialSourceId,
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
    assert.deepEqual(new Set(plan.semanticGraphPins[0].subjectIds.map(id)), new Set([id(artworkSubject._id), id(artistSubject._id)]));
    assert.equal(started.current.current.label, "Opera principale");
    assert.equal(started.current.current.presentation.kind, "visit_content");
    assert.equal(started.current.session.currentEntryIndex, 0);

    const semanticActions = started.current.availableActions.filter((entry) => entry.family === "semantic");
    const curiosityAction = semanticActions.find((entry) => entry.label === "Approfondisci: Curiosità sull'opera");
    const authorAction = semanticActions.find((entry) => entry.label === "Chi è l'autore");
    assert.ok(curiosityAction, "same-Subject Item must materialize a semantic Action without requiring a graph edge");
    assert.ok(authorAction, "related Subject with available content must materialize a semantic Action");
    assert.deepEqual(authorAction.controlledVoiceAliases, ["chi è l'autore", "dimmi chi ha creato l'opera"]);
    assert.equal(authorAction.actionId.includes(id(artist.revision._id)), false, "Action ID must not expose the ItemRevision ID");
    assert.equal(authorAction.actionId.includes("created_by"), false, "Action ID must not expose the local relation key");

    const curiosityResult = await dispatchAction({
      sessionId: started.session._id,
      userId: owner._id,
      payload: {
        actionId: curiosityAction.actionId,
        expectedRuntimeVersion: 1,
        interactionChannel: "button",
      },
    });
    assert.equal(curiosityResult.runtime.session.runtimeVersion, 2);
    assert.equal(curiosityResult.runtime.session.currentEntryIndex, 0, "semantic exploration must not advance Visit progress");
    assert.equal(curiosityResult.runtime.current.label, "Curiosità sull'opera");
    assert.equal(curiosityResult.runtime.current.presentation.kind, "semantic_exploration");
    assert.equal(curiosityResult.runtime.current.anchor, null, "nonphysical semantic exploration must not invent a physical destination");
    assert.ok(curiosityResult.runtime.availableActions.some((entry) => entry.actionId === "semantic.return"));

    const returned = await dispatchAction({
      sessionId: started.session._id,
      userId: owner._id,
      payload: {
        actionId: "semantic.return",
        expectedRuntimeVersion: 2,
        interactionChannel: "controlled_voice",
      },
    });
    assert.equal(returned.runtime.session.runtimeVersion, 3);
    assert.equal(returned.runtime.current.label, "Opera principale");
    assert.equal(returned.runtime.current.presentation.kind, "visit_content");

    const refreshedAuthorAction = returned.runtime.availableActions.find((entry) => entry.label === "Chi è l'autore");
    assert.ok(refreshedAuthorAction);
    const authorResult = await dispatchAction({
      sessionId: started.session._id,
      userId: owner._id,
      payload: {
        actionId: refreshedAuthorAction.actionId,
        expectedRuntimeVersion: 3,
        interactionChannel: "controlled_voice",
      },
    });
    assert.equal(authorResult.runtime.session.runtimeVersion, 4);
    assert.equal(authorResult.runtime.current.label, "Girolamo Bedoli");
    assert.equal(authorResult.runtime.current.presentation.text, "Girolamo Bedoli è l'autore collegato dal graph demo.");
    assert.equal(authorResult.runtime.session.currentEntryIndex, 0);

    const persisted = await VisitSessionV2.findById(started.session._id).lean();
    const semanticEvent = persisted.interactionEvents.find((entry) => entry.actionId === refreshedAuthorAction.actionId);
    assert.ok(semanticEvent);
    assert.equal(semanticEvent.actionType, "EXPLORE_SEMANTIC_RELATION");
    assert.equal(semanticEvent.interactionChannel, "controlled_voice");
    assert.equal(id(semanticEvent.context.semanticSubjectId), id(artistSubject._id));
    assert.equal(id(semanticEvent.context.semanticItemEditionId), id(artist.edition._id));
  });
});