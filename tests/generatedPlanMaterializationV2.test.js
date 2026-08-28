const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

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

async function createFixture() {
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const Subject = require("../models/subject.model");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");
  const EditorialContext = require("../models/editorialContext.model");
  const EditorialRelease = require("../models/editorialRelease.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const Venue = require("../models/venue.model");
  const VenueTarget = require("../models/venueTarget.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const VenueRelease = require("../models/venueRelease.model");
  const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");

  const user = await User.create({ username: "materialize-user", passwordHash: "hash" });
  const organization = await Organization.create({ name: "Materialize org", createdBy: user._id });
  const subjects = await Subject.create([
    { preferredLabel: "Opera A1", createdBy: user._id },
    { preferredLabel: "Opera A2", createdBy: user._id },
    { preferredLabel: "Opera B1", createdBy: user._id },
  ]);

  const namespace = await Namespace.create({ name: "Materialize namespace", ownerType: "user", ownerId: user._id, createdBy: user._id });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language-medium", key: "medium", label: "Medio" }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({ name: "Materialize space", ownerType: "user", ownerId: user._id, createdBy: user._id });
  const context = await EditorialContext.create({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, displayName: "Materialize context", createdBy: user._id });

  const item = await ItemV2.create({ primarySubjectId: subjects[0]._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
  const variantId = oid();
  const representationId = oid();
  const itemRevision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label: "Contenuto materializzato",
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    presentationVariants: [{
      _id: variantId,
      key: "standard",
      label: "Standard",
      representations: [{
        _id: representationId,
        durationTypeDefinitionId: "duration-short",
        languageLevelDefinitionId: "language-medium",
        locale: "it-IT",
        text: "Testo che non deve essere copiato nella VisitRevision.",
      }],
    }],
    defaultPresentation: { variantId, representationId },
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  edition.publishedRevisionId = itemRevision._id;
  await edition.save();

  const release = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 1,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: oid(),
    itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] }],
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    releasedAt: new Date(),
    releasedBy: user._id,
  });
  context.publishedReleaseId = release._id;
  await context.save();

  const [venueA, venueB] = await Venue.create([
    { name: "Venue A", ownerOrganizationId: organization._id, createdBy: user._id },
    { name: "Venue B", ownerOrganizationId: organization._id, createdBy: user._id },
  ]);
  const [targetA1, targetA2, targetB1] = await VenueTarget.create([
    { venueId: venueA._id, subjectId: subjects[0]._id, label: "Target A1", createdBy: user._id },
    { venueId: venueA._id, subjectId: subjects[1]._id, label: "Target A2", createdBy: user._id },
    { venueId: venueB._id, subjectId: subjects[2]._id, label: "Target B1", createdBy: user._id },
  ]);
  const physical = await createPublishedPhysicalVocabulary({ userId: user._id });
  const layoutA = await LayoutRevision.create({ venueId: venueA._id, version: 1, authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id, status: "published", createdBy: user._id, updatedBy: user._id });
  const layoutB = await LayoutRevision.create({ venueId: venueB._id, version: 1, authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id, status: "published", createdBy: user._id, updatedBy: user._id });
  const releaseA = await VenueRelease.create({
    venueId: venueA._id,
    version: 1,
    layoutRevisionId: layoutA._id,
    targetBindings: [targetA1, targetA2].map((target) => ({ venueTargetId: target._id, availability: "active", recognitionMedia: [] })),
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  const releaseB = await VenueRelease.create({
    venueId: venueB._id,
    version: 1,
    layoutRevisionId: layoutB._id,
    targetBindings: [{ venueTargetId: targetB1._id, availability: "active", recognitionMedia: [] }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  venueA.publishedReleaseId = releaseA._id;
  venueB.publishedReleaseId = releaseB._id;
  await venueA.save();
  await venueB.save();

  const anchorA1 = oid();
  const anchorA2 = oid();
  const anchorB1 = oid();
  const indoorConnection = oid();
  const plan = await GeneratedVisitPlanV2.create({
    userId: user._id,
    status: "accepted",
    requestSnapshot: {
      venueIds: [venueA._id, venueB._id],
      editorialSources: [{ resourceType: "editorial_context", resourceId: context._id }],
      timeBudgetSeconds: 900,
    },
    contextSnapshot: {
      editorialSources: [{
        requestedSourceRef: { resourceType: "editorial_context", resourceId: context._id },
        resolvedSourceRef: { resourceType: "editorial_context", resourceId: context._id },
        editorialContextId: context._id,
        editorialReleaseId: release._id,
        versionMode: "follow_current",
      }],
      venueIds: [venueA._id, venueB._id],
      depthPreference: 0.7,
      languageComplexityPreference: 0.4,
      locale: "it-IT",
    },
    sourceEditorialReleaseIds: [release._id],
    sourceVenueReleaseIds: [releaseA._id, releaseB._id],
    sourceLayoutRevisionIds: [layoutA._id, layoutB._id],
    adaptivePolicyVersion: 1,
    contentEntries: [{
      itemId: item._id,
      itemEditionId: edition._id,
      itemRevisionId: itemRevision._id,
      sourceEditorialReleaseIds: [release._id],
      role: "core",
      deliveryAnchorId: anchorA1,
      variantId,
      representationId,
      durationTypeDefinitionId: "duration-short",
      languageLevelDefinitionId: "language-medium",
      locale: "it-IT",
      estimatedContentSeconds: 60,
      utilityScore: 99,
      scoreBreakdown: { depthFit: 1 },
      reasons: [{ source: "test", message: "fixture", confidence: 1 }],
    }],
    visitAnchors: [
      { _id: anchorA1, venueTargetId: targetA1._id, venueId: venueA._id, placeId: oid(), estimatedObservationSeconds: 20 },
      { _id: anchorA2, venueTargetId: targetA2._id, venueId: venueA._id, placeId: oid(), estimatedObservationSeconds: 15 },
      { _id: anchorB1, venueTargetId: targetB1._id, venueId: venueB._id, placeId: oid(), estimatedObservationSeconds: 25 },
    ],
    physicalRoute: { legs: [
      {
        type: "indoor",
        fromAnchorId: anchorA1,
        toAnchorId: anchorA2,
        venueReleaseId: releaseA._id,
        layoutRevisionId: layoutA._id,
        path: [indoorConnection],
        estimatedSeconds: 30,
        preferencePenalty: 2,
        instruction: "Percorso indoor runtime",
      },
      {
        type: "inter_venue",
        fromAnchorId: anchorA2,
        toAnchorId: anchorB1,
        path: [],
        estimatedSeconds: 320,
        preferencePenalty: 0,
        instruction: "Raggiungi la seconda sede",
      },
    ] },
    estimatedTiming: { contentSeconds: 60, observationSeconds: 60, logisticsSeconds: 350, totalSeconds: 470, reservedSeconds: 30 },
    utilityScore: 99,
    explanation: { searchDiagnostics: { internal: true }, generatedBy: "test" },
    acceptedAt: new Date(),
  });

  return { user, plan, release, item, edition, itemRevision, targetA1, targetA2, targetB1, anchorA1, anchorA2, anchorB1, representationId, indoorConnection };
}

test("GeneratedPlan materialization creates one personal published Visit and preserves only durable semantics", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const { materializeGeneratedPlanV2 } = require("../services/generatedPlanMaterializationV2.service");
    const fixture = await createFixture();

    const first = await materializeGeneratedPlanV2({ planId: fixture.plan._id, userId: fixture.user._id, title: "La mia visita generata" });
    assert.equal(first.status, "published");
    assert.equal(first.alreadyMaterialized, false);

    const visit = await VisitV2.findById(first.visitId).lean();
    const revision = await VisitRevisionV2.findById(first.visitRevisionId).lean();
    assert.equal(visit.ownerType, "user");
    assert.equal(String(visit.ownerId), String(fixture.user._id));
    assert.equal(String(visit.materializedFromGeneratedPlanId), String(fixture.plan._id));
    assert.equal(String(visit.publishedRevisionId), String(revision._id));
    assert.equal(visit.workingRevisionId, null);

    assert.equal(revision.title, "La mia visita generata");
    assert.equal(revision.status, "published");
    assert.equal(revision.editorialSources.length, 1);
    assert.equal(String(revision.editorialSources[0].editorialReleaseId), String(fixture.release._id));
    assert.equal(revision.contentEntries.length, 1);
    assert.equal(String(revision.contentEntries[0].itemId), String(fixture.item._id));
    assert.equal(String(revision.contentEntries[0].itemEditionId), String(fixture.edition._id));
    assert.equal(String(revision.contentEntries[0].itemRevisionId), String(fixture.itemRevision._id));
    assert.equal(String(revision.contentEntries[0].editorialSourceId), String(revision.editorialSources[0]._id));

    assert.equal(revision.visitAnchors.length, 3);
    assert.notEqual(String(revision.visitAnchors[0]._id), String(fixture.anchorA1));
    assert.equal(String(revision.contentEntries[0].deliveryAnchorId), String(revision.visitAnchors[0]._id));
    assert.equal(String(revision.visitAnchors[0].venueTargetId), String(fixture.targetA1._id));
    assert.equal(String(revision.visitAnchors[1].venueTargetId), String(fixture.targetA2._id));
    assert.equal(String(revision.visitAnchors[2].venueTargetId), String(fixture.targetB1._id));

    assert.deepEqual(revision.presentationBaseline, {
      depthPreference: 0.7,
      languageComplexityPreference: 0.4,
      locale: "it-IT",
    });
    assert.equal(revision.logistics.routeHints.length, 1, "La leg indoor non deve diventare RouteHint persistente");
    assert.equal(revision.logistics.routeHints[0].type, "inter_venue");
    assert.equal(revision.logistics.routeHints[0].estimatedTransferSeconds, 320);
    assert.equal(revision.logistics.routeHints[0].instructionOverride, "Raggiungi la seconda sede");

    const serialized = JSON.stringify(revision);
    for (const forbidden of [
      "representationId", "variantId", "placeId", "venueReleaseId", "layoutRevisionId",
      "estimatedTiming", "utilityScore", "scoreBreakdown", String(fixture.indoorConnection),
    ]) {
      assert.equal(serialized.includes(forbidden), false, `VisitRevision non deve congelare ${forbidden}`);
    }

    const second = await materializeGeneratedPlanV2({ planId: fixture.plan._id, userId: fixture.user._id, title: "Titolo ignorato dopo materializzazione" });
    assert.equal(second.alreadyMaterialized, true);
    assert.equal(String(second.visitId), String(first.visitId));
    assert.equal(String(second.visitRevisionId), String(first.visitRevisionId));
    assert.equal(await VisitV2.countDocuments({ materializedFromGeneratedPlanId: fixture.plan._id }), 1);
  });
});
