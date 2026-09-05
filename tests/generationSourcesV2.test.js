const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

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

async function createEditorialFixture() {
  const User = require("../models/user");
  const Subject = require("../models/subject.model");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");
  const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const EditorialRelease = require("../models/editorialRelease.model");

  const owner = await User.create({ username: "generator-source-owner", passwordHash: "hash" });
  const buyer = await User.create({ username: "generator-source-buyer", passwordHash: "hash" });
  const subject = await Subject.create({ preferredLabel: "Subject generator", createdBy: owner._id });
  const namespace = await Namespace.create({ name: "Generator source namespace", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language-medium", key: "medium", label: "Medio" }],
    relationTypeDefinitions: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({ name: "Generator source space", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const { context, graphRevision } = await createEditorialContextWithGraph({
    contentSpace,
    namespaceId: namespace._id,
    namespaceRevisionId: namespaceRevision._id,
    displayName: "Generator source context",
    createdBy: owner._id,
  });
  await GraphSubjectBinding.create({ graphRevisionId: graphRevision._id, subjectId: subject._id, subjectClassDefinitionIds: [] });

  const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
  const firstRevision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label: "Contenuto R1",
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    presentationVariants: [],
    status: "superseded",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  const secondRevision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 2,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label: "Contenuto R2",
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    presentationVariants: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  edition.publishedRevisionId = secondRevision._id;
  await edition.save();

  const release1 = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 1,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    subjectIds: [subject._id],
    itemBindings: [{ itemId: item._id, itemEditionId: edition._id, itemRevisionId: firstRevision._id, curationSignals: [] }],
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    releasedAt: new Date(Date.now() - 1000),
    releasedBy: owner._id,
  });
  const release2 = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 2,
    basedOnReleaseId: release1._id,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    subjectIds: [subject._id],
    itemBindings: [{ itemId: item._id, itemEditionId: edition._id, itemRevisionId: secondRevision._id, curationSignals: [] }],
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    releasedAt: new Date(),
    releasedBy: owner._id,
  });
  context.publishedReleaseId = release2._id;
  await context.save();

  return { owner, buyer, context, release1, release2, firstRevision, secondRevision };
}

test("GenerationRequest accepts typed editorial sources and rejects legacy editorialContextIds", () => {
  const { validateGenerationRequestV2 } = require("../services/validation/generationV2.validation");
  const venueId = oid();
  const contextId = oid();
  const valid = validateGenerationRequestV2({
    venueIds: [venueId],
    editorialSources: [{ resourceType: "editorial_context", resourceId: contextId }],
    timeBudgetSeconds: 600,
  });
  assert.equal(valid.length, 0);
  const legacy = validateGenerationRequestV2({ venueIds: [venueId], editorialContextIds: [contextId], timeBudgetSeconds: 600 });
  assert.ok(legacy.some((issue) => issue.field === "editorialContextIds" && issue.code === "UNKNOWN_FIELD"));
});

test("live EditorialContext source follows current release while explicit EditorialRelease stays pinned", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const { loadEditorialScope } = require("../services/visitGeneratorV2.service");
    const fixture = await createEditorialFixture();

    const live = await loadEditorialScope({
      actorUserId: fixture.owner._id,
      physicalScope: { venues: [] },
      request: { editorialSources: [{ resourceType: "editorial_context", resourceId: fixture.context._id }] },
    });
    assert.equal(live.source, "explicit");
    assert.equal(live.resolvedSources[0].versionMode, "follow_current");
    assert.equal(String(live.sourceEditorialReleaseIds[0]), String(fixture.release2._id));
    assert.equal(String(live.baseCandidates[0].revision._id), String(fixture.secondRevision._id));

    const pinned = await loadEditorialScope({
      actorUserId: fixture.owner._id,
      physicalScope: { venues: [] },
      request: { editorialSources: [{ resourceType: "editorial_release", resourceId: fixture.release1._id }] },
    });
    assert.equal(pinned.resolvedSources[0].versionMode, "pinned");
    assert.equal(String(pinned.sourceEditorialReleaseIds[0]), String(fixture.release1._id));
    assert.equal(String(pinned.baseCandidates[0].revision._id), String(fixture.firstRevision._id));
  });
});

test("pinned context.generate entitlement requires an explicit EditorialRelease source", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const Entitlement = require("../models/entitlement.model");
    const { loadEditorialScope } = require("../services/visitGeneratorV2.service");
    const fixture = await createEditorialFixture();
    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: fixture.buyer._id,
      resourceType: "editorial_release",
      resourceId: fixture.release1._id,
      capability: "context.generate",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "editorial_release", resourceId: fixture.release1._id },
      status: "active",
    });

    await assert.rejects(
      () => loadEditorialScope({
        actorUserId: fixture.buyer._id,
        physicalScope: { venues: [] },
        request: { editorialSources: [{ resourceType: "editorial_context", resourceId: fixture.context._id }] },
      }),
      (error) => error?.status === 409 && error?.details?.some((issue) => issue.code === "GENERATION_SOURCE_TYPE_VERSION_MISMATCH"),
    );

    const pinned = await loadEditorialScope({
      actorUserId: fixture.buyer._id,
      physicalScope: { venues: [] },
      request: { editorialSources: [{ resourceType: "editorial_release", resourceId: fixture.release1._id }] },
    });
    assert.equal(String(pinned.sourceEditorialReleaseIds[0]), String(fixture.release1._id));
    assert.equal(String(pinned.baseCandidates[0].revision._id), String(fixture.firstRevision._id));
  });
});