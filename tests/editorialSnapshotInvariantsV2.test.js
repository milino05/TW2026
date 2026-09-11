const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_editorial_snapshot_invariants_v2`;
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

async function createBaseFixture({ namespaceStatus = "published" } = {}) {
  const User = require("../models/user");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");

  const user = await User.create({ username: `snapshot-${namespaceStatus}`, passwordHash: "hash" });
  const namespace = await Namespace.create({
    name: `Regole ${namespaceStatus}`,
    ownerType: "user",
    ownerId: user._id,
    createdBy: user._id,
  });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    subjectClasses: [{ definitionId: "class-work", key: "work", label: "Opera" }],
    relationTypes: [],
    durationTypes: [],
    languageLevels: [],
    presentationAspects: [],
    selectionSignals: [],
    status: namespaceStatus,
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  namespace.workingRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({
    name: `Spazio ${namespaceStatus}`,
    ownerType: "user",
    ownerId: user._id,
    createdBy: user._id,
  });
  const graphFixture = await createEditorialContextWithGraph({
    contentSpace,
    namespaceId: namespace._id,
    namespaceRevisionId: namespaceRevision._id,
    displayName: `Raccolta ${namespaceStatus}`,
    createdBy: user._id,
  });
  return { user, namespace, namespaceRevision, contentSpace, ...graphFixture };
}

test("una NamespaceRevision superseded resta valida per uno snapshot editoriale già pinzato", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { validateEditorialReleaseCoherence } = require("../services/editorialReleaseIntegrity.service");
    const fixture = await createBaseFixture({ namespaceStatus: "superseded" });

    const issues = await validateEditorialReleaseCoherence({
      editorialContextId: fixture.context._id,
      namespaceRevisionId: fixture.namespaceRevision._id,
      graphRevisionId: fixture.graphRevision._id,
      itemBindings: [],
    });

    assert.equal(issues.some((entry) => entry.code === "NAMESPACE_REVISION_NOT_RELEASE_READY"), false);
    assert.deepEqual(issues, []);
  });
});

test("assegnare classi materializza atomicamente un Subject della Raccolta", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { setEditorialGraphSubjectClasses } = require("../services/editorialGraphCommand.service");

    const fixture = await createBaseFixture();
    const subject = await Subject.create({ preferredLabel: "Opera esplicita", createdBy: fixture.user._id });
    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: fixture.user._id,
      createdBy: fixture.user._id,
    });
    await ContentSpaceItemMembership.create({
      contentSpaceId: fixture.contentSpace._id,
      itemId: item._id,
      addedBy: fixture.user._id,
    });
    await CollectionItemMembership.create({
      editorialContextId: fixture.context._id,
      itemId: item._id,
      curationSignals: [],
      addedBy: fixture.user._id,
      updatedBy: fixture.user._id,
    });

    let graph = await SemanticGraph.findById(fixture.semanticGraph._id).lean();
    const beforeRevisionId = String(graph.workingRevisionId);
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graph.workingRevisionId, subjectId: subject._id }), 0);

    await setEditorialGraphSubjectClasses({
      editorialContextId: fixture.context._id,
      subjectId: subject._id,
      subjectClassDefinitionIds: ["class-work"],
      actorUserId: fixture.user._id,
    });

    graph = await SemanticGraph.findById(fixture.semanticGraph._id).lean();
    assert.notEqual(String(graph.workingRevisionId), beforeRevisionId);
    const binding = await GraphSubjectBinding.findOne({ graphRevisionId: graph.workingRevisionId, subjectId: subject._id }).lean();
    assert.deepEqual(binding.subjectClassDefinitionIds, ["class-work"]);
  });
});

test("una classificazione vuota non materializza un Subject usato solo come focus", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const CollectionItemMembership = require("../models/collectionItemMembership.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const { setEditorialGraphSubjectClasses } = require("../services/editorialGraphCommand.service");

    const fixture = await createBaseFixture();
    const subject = await Subject.create({ preferredLabel: "Focus virtuale", createdBy: fixture.user._id });
    const item = await ItemV2.create({
      primarySubjectId: subject._id,
      ownerType: "user",
      ownerId: fixture.user._id,
      createdBy: fixture.user._id,
    });
    await CollectionItemMembership.create({
      editorialContextId: fixture.context._id,
      itemId: item._id,
      curationSignals: [],
      addedBy: fixture.user._id,
      updatedBy: fixture.user._id,
    });

    const graphBefore = await SemanticGraph.findById(fixture.semanticGraph._id).lean();
    await setEditorialGraphSubjectClasses({
      editorialContextId: fixture.context._id,
      subjectId: subject._id,
      subjectClassDefinitionIds: [],
      actorUserId: fixture.user._id,
    });
    const graphAfter = await SemanticGraph.findById(fixture.semanticGraph._id).lean();

    assert.equal(String(graphAfter.workingRevisionId), String(graphBefore.workingRevisionId));
    assert.equal(await GraphSubjectBinding.countDocuments({ graphRevisionId: graphAfter.workingRevisionId, subjectId: subject._id }), 0);
  });
});
