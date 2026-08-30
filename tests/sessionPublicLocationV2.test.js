const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_session_public_location_v2`;
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

test("slot QR resolves current publication while an active Session keeps its pinned snapshot", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Venue = require("../models/venue.model");
    const Subject = require("../models/subject.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const { resolvePublicCodeLocation, resolveCurrentPublishedPublicCode } = require("../services/sessionPublicLocationV2.service");

    const user = await User.create({ username: "slot-qr-user", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Slot QR org", createdBy: user._id });
    const venue = await Venue.create({ name: "Slot QR Venue", ownerOrganizationId: organization._id, createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera QR", createdBy: user._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, createdBy: user._id });
    const slot = await ExhibitSlot.create({ venueId: venue._id, createdBy: user._id });
    const vocabularyRevisionId = new mongoose.Types.ObjectId();
    const floorId = new mongoose.Types.ObjectId();
    const originalPlaceId = new mongoose.Types.ObjectId();
    const layout1 = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: vocabularyRevisionId,
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: originalPlaceId, floorId, placeTypeDefinitionId: "room", label: "Sala storica", position: { x: 0.2, y: 0.3 } }],
      exhibitSlots: [{ exhibitSlotId: slot._id, placeId: originalPlaceId, label: "Parete storica" }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const release1 = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout1._id,
      targetBindings: [{ venueTargetId: target._id, exhibitSlotId: slot._id, availability: "active" }],
      status: "published",
      integrity: { status: "valid", checkedAt: new Date(), checkedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = release1._id;
    await venue.save();

    const current = await resolveCurrentPublishedPublicCode({ publicCode: slot.publicCode });
    assert.equal(current.location.placeId, String(originalPlaceId));
    assert.equal(current.location.venueTargetId, String(target._id));

    const session = await VisitSessionV2.create({
      userId: user._id,
      sourceType: "generated_plan",
      generatedVisitPlanId: new mongoose.Types.ObjectId(),
      venuePins: [{ venueId: venue._id, venueReleaseId: release1._id, layoutRevisionId: layout1._id }],
      status: "active",
      sessionMovementSpeedMps: 1.2,
      adaptivePolicyVersion: 1,
    });
    const plan = await SessionPlanRevisionV2.create({
      sessionId: session._id,
      version: 1,
      origin: { sourceType: "generated_plan", generatedVisitPlanId: session.generatedVisitPlanId },
      status: "active",
    });
    session.currentPlanRevisionId = plan._id;
    await session.save();

    const pinned = await resolvePublicCodeLocation({ sessionId: session._id, userId: user._id, publicCode: slot.publicCode });
    assert.equal(pinned.location.placeId, String(originalPlaceId));

    const replacementPlaceId = new mongoose.Types.ObjectId();
    const layout2 = await LayoutRevision.create({
      venueId: venue._id,
      version: 2,
      basedOnRevisionId: layout1._id,
      authoredAgainstPhysicalVocabularyRevisionId: vocabularyRevisionId,
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: replacementPlaceId, floorId, placeTypeDefinitionId: "room", label: "Sala nuova", position: { x: 0.8, y: 0.3 } }],
      exhibitSlots: [{ exhibitSlotId: slot._id, placeId: replacementPlaceId, label: "Parete nuova" }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const release2 = await VenueRelease.create({
      venueId: venue._id,
      version: 2,
      basedOnReleaseId: release1._id,
      layoutRevisionId: layout2._id,
      targetBindings: [{ venueTargetId: target._id, exhibitSlotId: slot._id, availability: "unavailable" }],
      status: "published",
      integrity: { status: "valid", checkedAt: new Date(), checkedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    await LayoutRevision.updateOne({ _id: layout1._id }, { $set: { status: "superseded" } });
    await VenueRelease.updateOne({ _id: release1._id }, { $set: { status: "superseded" } });
    venue.publishedReleaseId = release2._id;
    await venue.save();

    await assert.rejects(
      () => resolveCurrentPublishedPublicCode({ publicCode: slot.publicCode }),
      (error) => error?.details?.some((detail) => detail.code === "PUBLIC_LOCATION_NOT_EXPOSED"),
    );
    const stillPinned = await resolvePublicCodeLocation({ sessionId: session._id, userId: user._id, publicCode: slot.publicCode });
    assert.equal(stillPinned.location.placeId, String(originalPlaceId));

    slot.lifecycleStatus = "trashed";
    slot.trashedAt = new Date();
    slot.trashedBy = user._id;
    await slot.save();
    await assert.rejects(
      () => resolveCurrentPublishedPublicCode({ publicCode: slot.publicCode }),
      (error) => error?.status === 404,
    );
    const historical = await resolvePublicCodeLocation({ sessionId: session._id, userId: user._id, publicCode: slot.publicCode });
    assert.equal(historical.location.placeId, String(originalPlaceId));
  });
});
