const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_runtime_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);
function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}
async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}
function id(value) { return String(value?._id || value || ""); }

test("ExecutionPreparation pins physical state and Action runtime keeps the Session snapshot stable", { skip: !mongoUri }, async () => {
  process.env.ADAPTIVE_CONTRIBUTOR_SECRET = process.env.ADAPTIVE_CONTRIBUTOR_SECRET || "runtime-v2-test-secret-value";
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
    const UserContentExposureV2 = require("../models/userContentExposureV2.model");
    const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
    const {
      currentSessionProjection,
      recordContentEntryExperience,
      recordVenueTargetObservationV2,
      recordTransitionV2,
      routeToIntentV2,
    } = require("../services/visitSessionV2.service");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");
    const {
      createExecutionPreparation,
      startExecutionPreparation,
    } = require("../services/executionPreparationV2.service");

    const user = await User.create({
      username: "runtime-v2-test",
      passwordHash: "test-hash",
      learningPreferences: { personalHistory: true, collectiveContribution: true, decidedAt: new Date() },
    });
    const organization = await Organization.create({ name: "Runtime venue org", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera runtime", createdBy: user._id });
    const namespace = await Namespace.create({ name: "Runtime namespace", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [
        { definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 20 },
        { definitionId: "duration-long", key: "long", label: "Lunga", targetSeconds: 60 },
      ],
      languageLevels: [
        { definitionId: "language-simple", key: "simple", label: "Semplice" },
        { definitionId: "language-advanced", key: "advanced", label: "Avanzato" },
      ],
      presentationAspects: [{ definitionId: "aspect-history", key: "history", label: "Storico" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const contentSpace = await ContentSpace.create({ name: "Runtime content", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const context = await EditorialContext.create({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, displayName: "Runtime context", shortDescription: "Runtime", createdBy: user._id });
    const graphRevision = await SemanticGraphRevision.create({ editorialContextId: context._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id, createdBy: user._id });

    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const variantId = new mongoose.Types.ObjectId();
    const shortSimpleId = new mongoose.Types.ObjectId();
    const longSimpleId = new mongoose.Types.ObjectId();
    const shortAdvancedId = new mongoose.Types.ObjectId();
    const longAdvancedId = new mongoose.Types.ObjectId();
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Opera per runtime",
      authorCredits: ["Autore Runtime"],
      metadata: { license: "CC BY" },
      illustrativeMedia: [{
        url: "https://upload.wikimedia.org/runtime-thumb.jpg",
        originalUrl: "https://upload.wikimedia.org/runtime-original.jpg",
        altText: "Opera runtime vista frontalmente",
        source: { provider: "wikimedia_commons", wikidataEntityId: "Q42", pageUrl: "https://commons.wikimedia.org/wiki/File:Runtime.jpg" },
        rights: { creator: "Autore immagine", licenseName: "CC BY 4.0" },
      }],
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        presentationAspects: [{ definitionId: "aspect-history", weight: 1 }],
        representations: [
          { _id: shortSimpleId, durationTypeDefinitionId: "duration-short", languageLevelDefinitionId: "language-simple", locale: "it-IT", text: "Testo breve semplice" },
          { _id: longSimpleId, durationTypeDefinitionId: "duration-long", languageLevelDefinitionId: "language-simple", locale: "it-IT", text: "Testo lungo semplice" },
          { _id: shortAdvancedId, durationTypeDefinitionId: "duration-short", languageLevelDefinitionId: "language-advanced", locale: "it-IT", text: "Testo breve avanzato" },
          { _id: longAdvancedId, durationTypeDefinitionId: "duration-long", languageLevelDefinitionId: "language-advanced", locale: "it-IT", text: "Testo lungo avanzato" },
        ],
      }],
      defaultPresentation: { variantId, representationId: shortSimpleId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();

    const editorialRelease = await EditorialRelease.create({
      editorialContextId: context._id,
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graphRevision._id,
      itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      releasedAt: new Date(),
      releasedBy: user._id,
    });
    context.publishedReleaseId = editorialRelease._id;
    await context.save();

    const venue = await Venue.create({ name: "Runtime Venue", ownerOrganizationId: organization._id, primaryEditorialContextId: context._id, createdBy: user._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, label: "Opera fisica", createdBy: user._id });

    const targetPlaceR1 = new mongoose.Types.ObjectId();
    const toiletPlaceR1 = new mongoose.Types.ObjectId();
    const connectionR1 = new mongoose.Types.ObjectId();
    const layoutR1 = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      placeTypes: [
        { key: "gallery", label: "Sala", userIntents: [] },
        { key: "toilet", label: "Toilette", userIntents: ["FIND_TOILET"] },
      ],
      floors: [{ key: "ground", label: "Piano terra", map: { imageUrl: "/maps/runtime-r1-ground.svg", width: 1000, height: 800 } }],
      places: [
        { _id: targetPlaceR1, typeKey: "gallery", label: "Sala A", floorKey: "ground", position: { x: 0.1, y: 0.1 } },
        { _id: toiletPlaceR1, typeKey: "toilet", label: "Toilette R1", floorKey: "ground", position: { x: 0.4, y: 0.1 } },
      ],
      venueTargetPlacements: [{ venueTargetId: target._id, primaryPlaceId: targetPlaceR1, placeIds: [targetPlaceR1] }],
      connections: [{ _id: connectionR1, fromPlaceId: targetPlaceR1, toPlaceId: toiletPlaceR1, directionality: "bidirectional", distanceMeters: 10, additionalDelaySeconds: 0, attributes: {} }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const releaseR1 = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layoutR1._id,
      targetBindings: [{ venueTargetId: target._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = releaseR1._id;
    await venue.save();

    const visit = await VisitV2.create({ ownerType: "user", ownerId: user._id, createdBy: user._id });
    const sourceId = new mongoose.Types.ObjectId();
    const anchorId = new mongoose.Types.ObjectId();
    const contentEntryId = new mongoose.Types.ObjectId();
    const visitRevision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Runtime visit",
      editorialSources: [{ _id: sourceId, editorialReleaseId: editorialRelease._id }],
      contentEntries: [{ _id: contentEntryId, editorialSourceId: sourceId, itemId: item._id, itemEditionId: edition._id, itemRevisionId: itemRevision._id, deliveryAnchorId: anchorId, role: "core" }],
      visitAnchors: [{ _id: anchorId, venueTargetId: target._id }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    visit.publishedRevisionId = visitRevision._id;
    await visit.save();

    const generatedAnchorId = new mongoose.Types.ObjectId();
    const generatedPlan = await GeneratedVisitPlanV2.create({
      userId: user._id,
      status: "accepted",
      acceptedAt: new Date(),
      requestSnapshot: { venueIds: [venue._id], timeBudgetSeconds: 600 },
      contextSnapshot: {},
      sourceEditorialReleaseIds: [editorialRelease._id],
      sourceVenueReleaseIds: [releaseR1._id],
      sourceLayoutRevisionIds: [layoutR1._id],
      adaptivePolicyVersion: 7,
      contentEntries: [{
        _id: new mongoose.Types.ObjectId(),
        itemId: item._id,
        itemEditionId: edition._id,
        itemRevisionId: itemRevision._id,
        sourceEditorialReleaseIds: [editorialRelease._id],
        role: "core",
        deliveryAnchorId: generatedAnchorId,
        variantId,
        representationId: shortSimpleId,
        durationTypeDefinitionId: "duration-short",
        languageLevelDefinitionId: "language-simple",
        locale: "it-IT",
        estimatedContentSeconds: 20,
      }],
      visitAnchors: [{ _id: generatedAnchorId, venueTargetId: target._id, venueId: venue._id, placeId: targetPlaceR1, estimatedObservationSeconds: 45 }],
      physicalRoute: { legs: [] },
      estimatedTiming: { contentSeconds: 20, observationSeconds: 45, logisticsSeconds: 0, totalSeconds: 65, reservedSeconds: 0 },
    });

    const visitPreparation = await createExecutionPreparation({ userId: user._id, payload: { visitId: visit._id } });
    const staleGeneratedPreparation = await createExecutionPreparation({ userId: user._id, payload: { generatedVisitPlanId: generatedPlan._id } });
    assert.equal(id(visitPreparation.source.visitRevisionId), id(visitRevision._id));
    assert.equal(visitPreparation.readiness.status, "ready");
    assert.equal(visitPreparation.logisticsPreview.routeSummary.venueCount, 1);

    const started = await startExecutionPreparation({
      preparationId: visitPreparation.id,
      userId: user._id,
      expectedVersion: visitPreparation.version,
    });
    const sessionId = started.session._id;
    assert.equal(started.alreadyStarted, false);
    assert.equal(id(started.session.venuePins[0].venueReleaseId), id(releaseR1._id));
    assert.equal(id(started.session.venuePins[0].layoutRevisionId), id(layoutR1._id));
    assert.equal(id(started.current.current.anchor.venueTargetId), id(target._id));
    assert.equal(started.current.current.presentation.text, "Testo breve semplice");
    assert.equal(started.current.current.illustrativeMedia[0].url, "https://upload.wikimedia.org/runtime-thumb.jpg");
    assert.equal(started.current.current.illustrativeMedia[0].altText, "Opera runtime vista frontalmente");
    assert.ok(started.current.availableActions.some((entry) => entry.actionId === "presentation.depth.increase"));
    assert.ok(started.current.availableActions.some((entry) => entry.actionId === "navigation.place.find_toilet"));

    const deeper = await dispatchAction({
      sessionId,
      userId: user._id,
      payload: {
        actionId: "presentation.depth.increase",
        expectedRuntimeVersion: started.current.session.runtimeVersion,
        interactionChannel: "button",
      },
    });
    assert.equal(deeper.runtime.current.presentation.text, "Testo lungo semplice");
    assert.equal(deeper.runtime.current.presentation.estimatedContentSeconds, 60);
    assert.equal(deeper.runtime.session.runtimeVersion, 2);
    await recordContentEntryExperience({ sessionId, userId: user._id, payload: { experiencedSeconds: 55, completionRatio: 1 } });
    await recordVenueTargetObservationV2({ sessionId, userId: user._id, payload: { observedSeconds: 60 } });

    const targetPlaceR2 = new mongoose.Types.ObjectId();
    const toiletPlaceR2 = new mongoose.Types.ObjectId();
    const layoutR2 = await LayoutRevision.create({
      venueId: venue._id,
      version: 2,
      basedOnRevisionId: layoutR1._id,
      placeTypes: [
        { key: "gallery", label: "Sala", userIntents: [] },
        { key: "toilet", label: "Toilette", userIntents: ["FIND_TOILET"] },
      ],
      floors: [{ key: "ground", label: "Piano terra", map: { imageUrl: "/maps/runtime-r2-ground.svg", width: 1000, height: 800 } }],
      places: [
        { _id: targetPlaceR2, typeKey: "gallery", label: "Sala B", floorKey: "ground", position: { x: 0.7, y: 0.2 } },
        { _id: toiletPlaceR2, typeKey: "toilet", label: "Toilette R2", floorKey: "ground", position: { x: 0.9, y: 0.2 } },
      ],
      venueTargetPlacements: [{ venueTargetId: target._id, primaryPlaceId: targetPlaceR2, placeIds: [targetPlaceR2] }],
      connections: [{ fromPlaceId: targetPlaceR2, toPlaceId: toiletPlaceR2, directionality: "bidirectional", distanceMeters: 6, additionalDelaySeconds: 0, attributes: {} }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const releaseR2 = await VenueRelease.create({
      venueId: venue._id,
      version: 2,
      basedOnReleaseId: releaseR1._id,
      layoutRevisionId: layoutR2._id,
      targetBindings: [{ venueTargetId: target._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = releaseR2._id;
    await venue.save();
    await VenueRelease.updateOne({ _id: releaseR1._id }, { $set: { status: "superseded" } });
    await LayoutRevision.updateOne({ _id: layoutR1._id }, { $set: { status: "superseded" } });

    await assert.rejects(
      () => startExecutionPreparation({
        preparationId: staleGeneratedPreparation.id,
        userId: user._id,
        expectedVersion: staleGeneratedPreparation.version,
      }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "PREPARATION_PHYSICAL_STATE_CHANGED",
    );

    const afterMove = await currentSessionProjection({ sessionId, userId: user._id });
    assert.equal(id(afterMove.current.anchor.venueTargetId), id(target._id), "existing Session keeps its logical anchor while routing remains pinned to R1");
    const route = await routeToIntentV2({ sessionId, userId: user._id, intent: "FIND_TOILET" });
    assert.equal(id(route.venueReleaseId), id(releaseR1._id));
    assert.equal(id(route.layoutRevisionId), id(layoutR1._id));
    assert.equal(id(route.destination._id), id(toiletPlaceR1));
    const transition = await recordTransitionV2({ sessionId, userId: user._id, payload: { connectionId: connectionR1, observedSeconds: 10 } });
    assert.equal(id(transition.observation.layoutRevisionId), id(layoutR1._id));

    const completed = await dispatchAction({
      sessionId,
      userId: user._id,
      payload: {
        actionId: "lifecycle.complete",
        expectedRuntimeVersion: afterMove.session.runtimeVersion,
        interactionChannel: "button",
      },
    });
    assert.equal(completed.runtime.session.status, "completed");
    assert.equal(completed.effect.learning.contentExposures, 1);
    assert.equal(completed.effect.learning.physicalObservations, 1);
    const exposure = await UserContentExposureV2.findOne({ userId: user._id, itemEditionId: edition._id }).lean();
    assert.equal(id(exposure.representationId), id(longSimpleId));
    const targetProfile = await VenueTargetObservationProfile.findOne({ venueTargetId: target._id }).lean();
    assert.equal(targetProfile.typicalObservationSeconds, 60);

    const freshGeneratedPreparation = await createExecutionPreparation({ userId: user._id, payload: { generatedVisitPlanId: generatedPlan._id } });
    const generatedStarted = await startExecutionPreparation({
      preparationId: freshGeneratedPreparation.id,
      userId: user._id,
      expectedVersion: freshGeneratedPreparation.version,
    });
    assert.equal(id(generatedStarted.session.venuePins[0].venueReleaseId), id(releaseR2._id), "new preparation must resolve current VenueRelease, not GeneratedPlan generation-time release");
    assert.equal(id(generatedStarted.session.venuePins[0].layoutRevisionId), id(layoutR2._id));
    assert.equal(id(generatedStarted.current.current.anchor.venueTargetId), id(target._id));
    assert.equal(generatedStarted.current.current.presentation.text, "Testo breve semplice");
  });
});
