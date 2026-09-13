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

test("la projection host espone cosa ha richiesto ogni partecipante dagli InteractionEvent esistenti", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
    const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
    const { projectSynchronizedVisitSession } = require("../services/synchronizedVisitSession.service");

    const [host, participant] = await User.create([
      { username: "requests-host", passwordHash: "test-hash" },
      { username: "requests-participant", passwordHash: "test-hash" },
    ]);
    const visitId = new mongoose.Types.ObjectId();
    const revision = await VisitRevisionV2.create({
      visitId,
      version: 1,
      title: "Visita osservabile",
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
      joinAlias: "RICHIESTE TEST",
      joinLookupKey: "richieste test",
      status: "active",
      currentEntryIndex: 0,
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
      startedAt: new Date(),
    });
    const sharedPlan = await SessionPlanRevisionV2.create({
      planOwnerType: "synchronized_visit_session",
      planOwnerId: group._id,
      version: 1,
      origin: { sourceType: "visit", visitRevisionId: revision._id },
      contentEntries: [],
      visitAnchors: [],
      physicalRoute: { legs: [] },
      estimatedTiming: {},
      explanation: {},
    });
    group.currentPlanRevisionId = sharedPlan._id;
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
      interactionEvents: [
        {
          category: "action",
          actorUserId: participant._id,
          actionId: "presentation.depth.increase",
          actionType: "PRESENTATION_DEPTH_INCREASE",
          actionFamily: "presentation",
          interactionChannel: "button",
          result: { status: "applied", code: null },
          at: new Date("2026-09-13T19:00:00.000Z"),
        },
        {
          category: "action",
          actorUserId: participant._id,
          actionId: "semantic.dynamic",
          actionType: "EXPLORE_SEMANTIC_RELATION",
          actionFamily: "semantic",
          interactionChannel: "controlled_voice",
          result: { status: "applied", code: null },
          metadata: { actionLabel: "Chi è l'autore?" },
          at: new Date("2026-09-13T19:01:00.000Z"),
        },
        {
          category: "action",
          actorUserId: participant._id,
          actionId: "semantic.return",
          actionType: "SEMANTIC_RETURN",
          actionFamily: "semantic",
          interactionChannel: "button",
          result: { status: "applied", code: null },
          at: new Date("2026-09-13T19:02:00.000Z"),
        },
        {
          category: "action",
          actorUserId: participant._id,
          actionId: "presentation.depth.decrease",
          actionType: "PRESENTATION_DEPTH_DECREASE",
          actionFamily: "presentation",
          interactionChannel: "button",
          result: { status: "rejected", code: "ACTION_NOT_AVAILABLE" },
          at: new Date("2026-09-13T19:03:00.000Z"),
        },
      ],
    });
    await SynchronizedVisitMembership.create([
      { synchronizedSessionId: group._id, userId: host._id, role: "host", visitSessionId: hostSession._id, status: "active" },
      { synchronizedSessionId: group._id, userId: participant._id, role: "participant", visitSessionId: participantSession._id, status: "active" },
    ]);

    const projection = await projectSynchronizedVisitSession({ synchronizedSessionId: group._id, userId: host._id });
    const projectedParticipant = projection.participants.find((entry) => String(entry.userId) === String(participant._id));
    assert.ok(projectedParticipant);
    assert.deepEqual(
      projectedParticipant.requests.map((request) => ({
        type: request.actionType,
        label: request.label,
        channel: request.interactionChannel,
      })),
      [
        { type: "EXPLORE_SEMANTIC_RELATION", label: "Chi è l'autore?", channel: "controlled_voice" },
        { type: "PRESENTATION_DEPTH_INCREASE", label: "Dimmi di più", channel: "button" },
      ],
    );
  });
});
