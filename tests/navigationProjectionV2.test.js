const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_navigation_projection_v2`;
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

test("MapProjection hides routing internals and obstacle Action uses canonical metadata", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Venue = require("../models/venue.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const { deriveRuntimeActions, currentSessionProjection } = require("../services/visitSessionV2.service");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");
    const { projectSessionMap } = require("../services/navigationProjectionV2.service");

    const user = await User.create({ username: "navigation-projection-user", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Navigation projection org", createdBy: user._id });
    const venue = await Venue.create({ name: "Navigation projection Venue", ownerOrganizationId: organization._id, createdBy: user._id });

    const firstPlaceId = new mongoose.Types.ObjectId();
    const secondPlaceId = new mongoose.Types.ObjectId();
    const connectionId = new mongoose.Types.ObjectId();
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      placeTypes: [{ key: "gallery", label: "Sala", userIntents: [] }],
      routingAttributes: [{
        key: "stairs_here",
        label: "Scale sul percorso",
        dataType: "boolean",
        canonicalKey: "stairs",
        appliesTo: "connection",
      }],
      floors: [{
        key: "ground",
        label: "Piano terra",
        map: { imageUrl: "/maps/navigation-test.svg", width: 1200, height: 800 },
      }],
      places: [
        { _id: firstPlaceId, typeKey: "gallery", label: "Sala A", floorKey: "ground", position: { x: 0.2, y: 0.3 } },
        { _id: secondPlaceId, typeKey: "gallery", label: "Sala B", floorKey: "ground", position: { x: 0.8, y: 0.3 } },
      ],
      venueTargetPlacements: [],
      connections: [{
        _id: connectionId,
        fromPlaceId: firstPlaceId,
        toPlaceId: secondPlaceId,
        directionality: "bidirectional",
        distanceMeters: 25,
        additionalDelaySeconds: 0,
        attributes: { stairs_here: true },
        instructions: { forward: "Prosegui verso Sala B" },
      }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const release = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = release._id;
    await venue.save();

    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: new mongoose.Types.ObjectId(),
      version: 1,
      durationTypes: [{ definitionId: "duration-standard", key: "standard", label: "Standard", targetSeconds: 30 }],
      languageLevels: [{ definitionId: "language-standard", key: "standard", label: "Standard" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    const itemEditionId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    const representationId = new mongoose.Types.ObjectId();
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto navigazione",
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        representations: [{
          _id: representationId,
          durationTypeDefinitionId: "duration-standard",
          languageLevelDefinitionId: "language-standard",
          locale: "it-IT",
          text: "Testo mostrato e letto dal Navigator",
        }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });

    const session = await VisitSessionV2.create({
      userId: user._id,
      sourceType: "generated_plan",
      generatedVisitPlanId: new mongoose.Types.ObjectId(),
      venuePins: [{ venueId: venue._id, venueReleaseId: release._id, layoutRevisionId: layout._id }],
      status: "active",
      currentEntryIndex: 0,
      runtimeVersion: 1,
      navigationSnapshot: { movementPacePreference: 0.5, requirements: [] },
      sessionMovementSpeedMps: 1.2,
      adaptivePolicyVersion: 1,
    });

    const firstAnchorId = new mongoose.Types.ObjectId();
    const secondAnchorId = new mongoose.Types.ObjectId();
    const firstTargetId = new mongoose.Types.ObjectId();
    const secondTargetId = new mongoose.Types.ObjectId();
    const contentEntryId = new mongoose.Types.ObjectId();
    const plan = await SessionPlanRevisionV2.create({
      sessionId: session._id,
      version: 1,
      status: "active",
      origin: { sourceType: "generated_plan", generatedVisitPlanId: session.generatedVisitPlanId },
      sourceEditorialReleaseIds: [],
      contentEntries: [{
        _id: contentEntryId,
        itemId: new mongoose.Types.ObjectId(),
        itemEditionId,
        itemRevisionId: itemRevision._id,
        namespaceRevisionId: namespaceRevision._id,
        sourceEditorialReleaseIds: [],
        role: "core",
        deliveryAnchorId: firstAnchorId,
        baselinePresentation: {
          variantId,
          representationId,
          durationTypeDefinitionId: "duration-standard",
          languageLevelDefinitionId: "language-standard",
          locale: "it-IT",
          estimatedContentSeconds: 30,
        },
      }],
      visitAnchors: [
        { _id: firstAnchorId, venueTargetId: firstTargetId, venueId: venue._id, placeId: firstPlaceId, estimatedObservationSeconds: 30 },
        { _id: secondAnchorId, venueTargetId: secondTargetId, venueId: venue._id, placeId: secondPlaceId, estimatedObservationSeconds: 30 },
      ],
      physicalRoute: {
        legs: [{
          type: "indoor",
          fromAnchorId: firstAnchorId,
          toAnchorId: secondAnchorId,
          venueReleaseId: release._id,
          layoutRevisionId: layout._id,
          path: [connectionId],
          estimatedSeconds: 20,
          preferencePenalty: 0,
          instruction: null,
        }],
      },
      estimatedTiming: { contentSeconds: 30, observationSeconds: 60, logisticsSeconds: 20, totalSeconds: 110, reservedSeconds: 0 },
    });
    session.currentPlanRevisionId = plan._id;
    await session.save();

    const derived = await deriveRuntimeActions({ sessionId: session._id, userId: user._id });
    assert.ok(derived.actions.some((action) => action.actionId === "navigation.obstacles.next_route"));

    const map = await projectSessionMap({ sessionId: session._id, userId: user._id });
    assert.equal(map.venues[0].floors[0].map.imageUrl, "/maps/navigation-test.svg");
    assert.equal(map.logicalCurrentStop.visitAnchorId.toString(), firstAnchorId.toString());
    assert.equal(map.venues[0].route.overlays[0].floorKey, "ground");
    const serializedMap = JSON.stringify(map);
    assert.equal(serializedMap.includes("placeId"), false);
    assert.equal(serializedMap.includes("connectionId"), false);
    assert.equal(serializedMap.includes("layoutRevisionId"), false);

    const result = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: {
        actionId: "navigation.obstacles.next_route",
        expectedRuntimeVersion: 1,
        interactionChannel: "controlled_voice",
      },
    });
    assert.equal(result.effect.type, "obstacle_check");
    assert.equal(result.effect.obstacleCheck.verified, true);
    assert.deepEqual(result.effect.obstacleCheck.obstacles.map((entry) => entry.code), ["stairs"]);
    assert.match(result.effect.obstacleCheck.message, /ostacoli dichiarati/);
    assert.equal(result.runtime.session.runtimeVersion, 2);

    const persisted = await VisitSessionV2.findById(session._id).lean();
    const event = persisted.interactionEvents.at(-1);
    assert.equal(event.actionId, "navigation.obstacles.next_route");
    assert.equal(event.interactionChannel, "controlled_voice");
    assert.equal(event.result.status, "applied");

    await ItemRevisionV2.deleteOne({ _id: itemRevision._id });
    await VisitSessionV2.updateOne({ _id: session._id }, { $set: { status: "route_completed" } });

    const routeCompleted = await currentSessionProjection({ sessionId: session._id, userId: user._id });
    assert.equal(routeCompleted.session.status, "route_completed");
    assert.equal(routeCompleted.current, null);
    assert.ok(routeCompleted.availableActions.some((action) => action.actionId === "lifecycle.complete"));

    const completion = await dispatchAction({
      sessionId: session._id,
      userId: user._id,
      payload: {
        actionId: "lifecycle.complete",
        expectedRuntimeVersion: 2,
        interactionChannel: "button",
      },
    });
    assert.equal(completion.runtime.session.status, "completed");
  });
});
