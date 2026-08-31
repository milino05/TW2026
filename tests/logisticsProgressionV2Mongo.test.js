const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_logistics_progression_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
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

function oid() { return new mongoose.Types.ObjectId(); }
function id(value) { return String(value?._id || value || ""); }

async function createEditorialFixture({ user }) {
  const Subject = require("../models/subject.model");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");

  const namespace = await Namespace.create({ name: "Logistics namespace", ownerType: "user", ownerId: user._id, createdBy: user._id });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 20 }],
    languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
    presentationAspects: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  async function item(label) {
    const subject = await Subject.create({ preferredLabel: label, createdBy: user._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const variantId = oid();
    const representationId = oid();
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label,
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        presentationAspects: [],
        representations: [{
          _id: representationId,
          durationTypeDefinitionId: "duration-short",
          languageLevelDefinitionId: "language-simple",
          locale: "it-IT",
          text: `Contenuto ${label}`,
        }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();
    return { subject, item, edition, revision, variantId, representationId };
  }

  return {
    namespaceRevision,
    first: await item("Opera A"),
    second: await item("Opera B"),
  };
}

async function createSessionFixture() {
  loadAllModels();
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const Venue = require("../models/venue.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const VenueRelease = require("../models/venueRelease.model");
  const VisitSessionV2 = require("../models/visitSessionV2.model");
  const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");

  const user = await User.create({ username: "logistics-runtime-user", passwordHash: "test-hash" });
  const organization = await Organization.create({ name: "Logistics runtime org", createdBy: user._id });
  const editorial = await createEditorialFixture({ user });
  const physical = await createPublishedPhysicalVocabulary({ userId: user._id });
  const roomType = physical.placeTypeByKey.get("room");

  const venue = await Venue.create({ name: "Logistics Venue", ownerOrganizationId: organization._id, createdBy: user._id });
  const floorId = oid();
  const placeA = oid();
  const placeMiddle = oid();
  const placeB = oid();
  const connectionA = oid();
  const connectionB = oid();
  const exhibitSlotA = oid();
  const exhibitSlotB = oid();
  const venueTargetA = oid();
  const venueTargetB = oid();

  const layout = await LayoutRevision.create({
    venueId: venue._id,
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
    floors: [{ _id: floorId, label: "Piano terra" }],
    places: [
      { _id: placeA, floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala A", position: { x: 0.1, y: 0.5 } },
      { _id: placeMiddle, floorId, placeTypeDefinitionId: roomType.definitionId, label: "Corridoio centrale", position: { x: 0.5, y: 0.5 } },
      { _id: placeB, floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala B", position: { x: 0.9, y: 0.5 } },
    ],
    exhibitSlots: [
      { exhibitSlotId: exhibitSlotA, placeId: placeA, label: "Parete A", approachGuidance: { defaultInstruction: "Guarda la parete A.", overrides: [] } },
      {
        exhibitSlotId: exhibitSlotB,
        placeId: placeB,
        label: "Parete B",
        approachGuidance: {
          defaultInstruction: "Guarda la parete B.",
          overrides: [{
            sourceKind: "incoming_connection",
            sourceConnectionId: connectionB,
            sourceExhibitSlotId: null,
            instruction: "Entrato nella Sala B, guarda la seconda opera sulla parete destra.",
          }],
        },
      },
    ],
    connections: [
      {
        _id: connectionA,
        fromPlaceId: placeA,
        toPlaceId: placeMiddle,
        directionality: "bidirectional",
        metricMode: "manual_override",
        distanceMeters: 12,
        additionalDelaySeconds: 0,
        instructions: { forward: "Esci dalla Sala A e percorri il corridoio.", backward: "Rientra nella Sala A." },
        attributeValues: [],
      },
      {
        _id: connectionB,
        fromPlaceId: placeMiddle,
        toPlaceId: placeB,
        directionality: "bidirectional",
        metricMode: "manual_override",
        distanceMeters: 8,
        additionalDelaySeconds: 0,
        instructions: { forward: "Prosegui fino alla Sala B.", backward: "Torna verso il corridoio centrale." },
        attributeValues: [],
      },
    ],
    status: "published",
    createdBy: user._id,
    updatedBy: user._id,
  });
  const release = await VenueRelease.create({
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layout._id,
    targetBindings: [
      { venueTargetId: venueTargetA, exhibitSlotId: exhibitSlotA, availability: "active", recognitionMedia: [] },
      { venueTargetId: venueTargetB, exhibitSlotId: exhibitSlotB, availability: "active", recognitionMedia: [] },
    ],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
    publication: { publishedAt: new Date(), publishedBy: user._id },
    createdBy: user._id,
    updatedBy: user._id,
  });
  venue.publishedReleaseId = release._id;
  await venue.save();

  const visitId = oid();
  const visitRevisionId = oid();
  const anchorA = oid();
  const anchorB = oid();
  const entryA = oid();
  const entryB = oid();
  const session = await VisitSessionV2.create({
    userId: user._id,
    sourceType: "visit",
    visitId,
    visitRevisionId,
    venuePins: [{ venueId: venue._id, venueReleaseId: release._id, layoutRevisionId: layout._id }],
    status: "active",
    currentEntryIndex: 0,
    runtimeVersion: 1,
    navigationSnapshot: { movementPacePreference: 0.5, routingProfileSelections: [], requirements: [] },
    sessionMovementSpeedMps: 1,
    adaptivePolicyVersion: 1,
  });
  const plan = await SessionPlanRevisionV2.create({
    sessionId: session._id,
    version: 1,
    status: "active",
    origin: { sourceType: "visit", visitRevisionId, generatedVisitPlanId: null },
    sourceEditorialReleaseIds: [],
    contentEntries: [
      {
        _id: entryA,
        itemId: editorial.first.item._id,
        itemEditionId: editorial.first.edition._id,
        itemRevisionId: editorial.first.revision._id,
        namespaceRevisionId: editorial.namespaceRevision._id,
        sourceEditorialReleaseIds: [],
        role: "core",
        deliveryAnchorId: anchorA,
        baselinePresentation: {
          variantId: editorial.first.variantId,
          representationId: editorial.first.representationId,
          durationTypeDefinitionId: "duration-short",
          languageLevelDefinitionId: "language-simple",
          locale: "it-IT",
          estimatedContentSeconds: 20,
        },
      },
      {
        _id: entryB,
        itemId: editorial.second.item._id,
        itemEditionId: editorial.second.edition._id,
        itemRevisionId: editorial.second.revision._id,
        namespaceRevisionId: editorial.namespaceRevision._id,
        sourceEditorialReleaseIds: [],
        role: "core",
        deliveryAnchorId: anchorB,
        baselinePresentation: {
          variantId: editorial.second.variantId,
          representationId: editorial.second.representationId,
          durationTypeDefinitionId: "duration-short",
          languageLevelDefinitionId: "language-simple",
          locale: "it-IT",
          estimatedContentSeconds: 20,
        },
      },
    ],
    visitAnchors: [
      { _id: anchorA, sourceAnchorId: anchorA, venueTargetId: venueTargetA, exhibitSlotId: exhibitSlotA, venueId: venue._id, placeId: placeA, estimatedObservationSeconds: 30, approachInstruction: "Guarda la parete A." },
      { _id: anchorB, sourceAnchorId: anchorB, venueTargetId: venueTargetB, exhibitSlotId: exhibitSlotB, venueId: venue._id, placeId: placeB, estimatedObservationSeconds: 30, approachInstruction: "Entrato nella Sala B, guarda la seconda opera sulla parete destra." },
    ],
    physicalRoute: {
      legs: [{
        type: "indoor",
        fromAnchorId: anchorA,
        toAnchorId: anchorB,
        venueReleaseId: release._id,
        layoutRevisionId: layout._id,
        path: [connectionA, connectionB],
        estimatedSeconds: 20,
        preferencePenalty: 0,
        instruction: null,
      }],
    },
    estimatedTiming: { contentSeconds: 40, observationSeconds: 60, logisticsSeconds: 20, totalSeconds: 120, reservedSeconds: 0 },
  });
  session.currentPlanRevisionId = plan._id;
  await session.save();

  return { user, session, entryA, entryB };
}

test("progress.next attraversa Connection e approach prima di rendere corrente l'Item successivo", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");
    const { currentSessionProjectionWithLogistics } = require("../services/sessionLogisticsProgressionV2.service");
    const { user, session, entryA, entryB } = await createSessionFixture();

    let current = await currentSessionProjectionWithLogistics({ sessionId: session._id, userId: user._id });
    assert.equal(current.current.presentation.kind, "visit_content");
    assert.equal(id(current.current.contentEntryId), id(entryA));

    let response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.next", expectedRuntimeVersion: 1, interactionChannel: "button" },
    });
    assert.equal(response.runtime.current.presentation.kind, "logistics");
    assert.equal(response.runtime.current.contentEntryId, null);
    assert.equal(response.runtime.current.logistics.kind, "connection");
    assert.equal(response.runtime.current.logistics.stepNumber, 1);
    assert.equal(response.runtime.current.logistics.stepCount, 3);
    assert.equal(response.runtime.current.presentation.text, "Esci dalla Sala A e percorri il corridoio.");
    assert.equal(response.runtime.availableActions.some((action) => action.family === "presentation" || action.family === "semantic"), false);
    assert.equal(response.runtime.availableActions.find((action) => action.type === "PROGRESS_NEXT").label, "Avanti");
    assert.equal(response.runtime.availableActions.find((action) => action.type === "PROGRESS_PREVIOUS").label, "Indietro");
    let persisted = await VisitSessionV2.findById(session._id).lean();
    assert.equal(persisted.currentEntryIndex, 0);
    assert.equal(persisted.logisticsProgress.stepIndex, 0);

    response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.next", expectedRuntimeVersion: 2, interactionChannel: "controlled_voice" },
    });
    assert.equal(response.runtime.current.logistics.stepNumber, 2);
    assert.equal(response.runtime.current.presentation.text, "Prosegui fino alla Sala B.");
    persisted = await VisitSessionV2.findById(session._id).lean();
    assert.equal(persisted.currentEntryIndex, 0);

    response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.previous", expectedRuntimeVersion: 3, interactionChannel: "button" },
    });
    assert.equal(response.runtime.current.logistics.stepNumber, 1);
    assert.equal(response.runtime.current.presentation.text, "Esci dalla Sala A e percorri il corridoio.");

    response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.next", expectedRuntimeVersion: 4, interactionChannel: "button" },
    });
    assert.equal(response.runtime.current.logistics.stepNumber, 2);

    response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.next", expectedRuntimeVersion: 5, interactionChannel: "button" },
    });
    assert.equal(response.runtime.current.logistics.kind, "approach");
    assert.equal(response.runtime.current.logistics.stepNumber, 3);
    assert.equal(response.runtime.current.presentation.text, "Entrato nella Sala B, guarda la seconda opera sulla parete destra.");
    persisted = await VisitSessionV2.findById(session._id).lean();
    assert.equal(persisted.currentEntryIndex, 0);

    response = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: { actionId: "progress.next", expectedRuntimeVersion: 6, interactionChannel: "button" },
    });
    assert.equal(response.runtime.current.presentation.kind, "visit_content");
    assert.equal(id(response.runtime.current.contentEntryId), id(entryB));
    persisted = await VisitSessionV2.findById(session._id).lean();
    assert.equal(persisted.currentEntryIndex, 1);
    assert.equal(persisted.logisticsProgress, null);
    const progressEvents = persisted.interactionEvents.filter((event) => event.actionId === "progress.next" || event.actionId === "progress.previous");
    assert.equal(progressEvents.length, 6);
    assert.equal(progressEvents.some((event) => event.interactionChannel === "controlled_voice" && event.result.status === "applied"), true);
  });
});
