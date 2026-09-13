const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

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

function projectedParticipant(projection, participantId) {
  return projection.participants.find((entry) => String(entry.userId) === String(participantId));
}

test("la telemetria di ascolto aggiorna end-to-end la projection docente della sessione sincronizzata", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
    const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
    const { recordContentEntryExperience } = require("../services/visitSessionV2.service");
    const { projectSynchronizedVisitSession } = require("../services/synchronizedVisitSession.service");
    const { notifySynchronizedVisitChangedForVisitSession } = require("../services/synchronizedVisitRealtime.service");

    const [host, participant] = await User.create([
      { username: "experience-host", passwordHash: "test-hash" },
      { username: "experience-participant", passwordHash: "test-hash" },
    ]);

    const visitId = new mongoose.Types.ObjectId();
    const revision = await VisitRevisionV2.create({
      visitId,
      version: 1,
      title: "Visita osservabile end-to-end",
      quiz: { questions: [] },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: host._id },
      publication: { publishedAt: new Date(), publishedBy: host._id },
      createdBy: host._id,
      updatedBy: host._id,
    });

    const group = await SynchronizedVisitSession.create({
      visitId,
      visitRevisionId: revision._id,
      hostUserId: host._id,
      joinAlias: "ASCOLTO TEST",
      joinLookupKey: "ascolto test",
      status: "active",
      currentEntryIndex: 0,
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
      startedAt: new Date(),
    });

    const contentEntryId = new mongoose.Types.ObjectId();
    const plan = await SessionPlanRevisionV2.create({
      planOwnerType: "synchronized_visit_session",
      planOwnerId: group._id,
      version: 1,
      origin: { sourceType: "visit", visitRevisionId: revision._id },
      contentEntries: [{
        _id: contentEntryId,
        itemId: new mongoose.Types.ObjectId(),
        itemEditionId: new mongoose.Types.ObjectId(),
        itemRevisionId: new mongoose.Types.ObjectId(),
        namespaceRevisionId: new mongoose.Types.ObjectId(),
        sourceEditorialReleaseIds: [],
        role: "core",
        deliveryAnchorId: null,
        baselinePresentation: {
          variantId: new mongoose.Types.ObjectId(),
          representationId: new mongoose.Types.ObjectId(),
          durationTypeDefinitionId: "standard",
          languageLevelDefinitionId: "standard",
          locale: "it-IT",
          estimatedContentSeconds: 60,
        },
      }],
      visitAnchors: [],
      physicalRoute: { legs: [] },
      estimatedTiming: { contentSeconds: 60, totalSeconds: 60 },
      explanation: {},
    });
    group.currentPlanRevisionId = plan._id;
    await group.save();

    const hostSession = await VisitSessionV2.create({
      userId: host._id,
      sourceType: "visit",
      visitId,
      visitRevisionId: revision._id,
      synchronizedSessionId: group._id,
      currentPlanRevisionId: null,
      currentEntryIndex: null,
      adaptivePolicyVersion: 1,
    });
    const participantSession = await VisitSessionV2.create({
      userId: participant._id,
      sourceType: "visit",
      visitId,
      visitRevisionId: revision._id,
      synchronizedSessionId: group._id,
      currentPlanRevisionId: null,
      currentEntryIndex: null,
      adaptivePolicyVersion: 1,
    });
    await SynchronizedVisitMembership.create([
      { synchronizedSessionId: group._id, userId: host._id, role: "host", visitSessionId: hostSession._id, status: "active" },
      { synchronizedSessionId: group._id, userId: participant._id, role: "participant", visitSessionId: participantSession._id, status: "active" },
    ]);

    const before = projectedParticipant(
      await projectSynchronizedVisitSession({ synchronizedSessionId: group._id, userId: host._id }),
      participant._id,
    );
    assert.equal(before.experience.status, "not_started");
    assert.equal(before.experience.completionRatio, 0);

    await recordContentEntryExperience({
      sessionId: participantSession._id,
      userId: participant._id,
      payload: { contentEntryId, contentSeconds: 60, experiencedSeconds: 0, completionRatio: 0 },
    });
    assert.equal(await notifySynchronizedVisitChangedForVisitSession({
      visitSessionId: participantSession._id,
      userId: participant._id,
    }), true);

    const following = projectedParticipant(
      await projectSynchronizedVisitSession({ synchronizedSessionId: group._id, userId: host._id }),
      participant._id,
    );
    assert.equal(following.experience.status, "in_progress");
    assert.equal(following.experience.completionRatio, 0);

    await recordContentEntryExperience({
      sessionId: participantSession._id,
      userId: participant._id,
      payload: { contentEntryId, contentSeconds: 60, experiencedSeconds: 52, completionRatio: 1 },
    });

    const completed = projectedParticipant(
      await projectSynchronizedVisitSession({ synchronizedSessionId: group._id, userId: host._id }),
      participant._id,
    );
    assert.equal(completed.experience.status, "completed");
    assert.equal(completed.experience.completionRatio, 1);

    const persisted = await VisitSessionV2.findById(participantSession._id).lean();
    assert.equal(persisted.contentEntryExperiences.length, 2);
    assert.equal(persisted.interactionEvents.some((event) => event.actionType === "CONTENT_ENTRY_COMPLETED"), true);
  });
});
