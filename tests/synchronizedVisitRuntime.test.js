const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_synchronized_visit_runtime`;
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

function emptySharedPlan(visitRevisionId) {
  return {
    origin: { sourceType: "visit", visitRevisionId, generatedVisitPlanId: null },
    createdReason: "initial",
    fidelity: "preserve",
    executedThroughEntryIndex: -1,
    sourceEditorialReleaseIds: [],
    semanticGraphPins: [],
    semanticContentPins: [],
    contentEntries: [],
    visitAnchors: [],
    physicalRoute: { legs: [] },
    estimatedTiming: {},
    explanation: {},
  };
}

test("runtime sincronizzato usa un solo piano, join idempotente e policy host backend-side", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
    const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
    const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
    const SynchronizedVisitQuizAttempt = require("../models/synchronizedVisitQuizAttempt.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const {
      createSynchronizedVisitRuntime,
      joinSynchronizedVisitSession,
      startSynchronizedVisit,
      startSynchronizedQuiz,
      controlSynchronizedPlayback,
    } = require("../services/synchronizedVisitSession.service");
    const {
      participantQuizProjection,
      confirmQuizEvaluation,
    } = require("../services/synchronizedVisitQuiz.service");
    const { getCurrentSessionPlanV2 } = require("../services/sessionPlanV2.service");
    const { currentSessionProjection } = require("../services/visitSessionV2.service");
    const { dispatchAction } = require("../services/actionDispatcherV2.service");

    const [host, participant] = await User.create([
      { username: "docente-sync", passwordHash: "test-hash" },
      { username: "studente-sync", passwordHash: "test-hash" },
    ]);
    const visitId = new mongoose.Types.ObjectId();
    const visitRevisionId = new mongoose.Types.ObjectId();
    const first = await createSynchronizedVisitRuntime({
      hostUserId: host._id,
      visitId,
      visitRevisionId,
      preferredAlias: "  Fenice   rossa ",
      plan: emptySharedPlan(visitRevisionId),
      venuePins: [],
      navigationSnapshot: { movementPacePreference: 0.5, routingProfileSelections: [], requirements: [] },
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
    });

    assert.equal(first.synchronizedSession.joinAlias, "Fenice rossa");
    assert.equal(first.hostVisitSession.currentPlanRevisionId, null);
    assert.equal(first.hostVisitSession.currentEntryIndex, null);
    assert.equal(await SessionPlanRevisionV2.countDocuments({
      planOwnerType: "synchronized_visit_session",
      planOwnerId: first.synchronizedSession._id,
    }), 1);

    const secondVisitRevisionId = new mongoose.Types.ObjectId();
    const second = await createSynchronizedVisitRuntime({
      hostUserId: host._id,
      visitId: new mongoose.Types.ObjectId(),
      visitRevisionId: secondVisitRevisionId,
      preferredAlias: "FENICE ROSSA",
      plan: emptySharedPlan(secondVisitRevisionId),
      venuePins: [],
      navigationSnapshot: { movementPacePreference: 0.5, routingProfileSelections: [], requirements: [] },
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
    });
    assert.equal(second.synchronizedSession.joinAlias, "FENICE ROSSA 2");

    const joined = await joinSynchronizedVisitSession({ userId: participant._id, alias: "  FENICE    ROSSA " });
    const rejoined = await joinSynchronizedVisitSession({ userId: participant._id, alias: "fenice rossa" });
    assert.equal(joined.rejoined, false);
    assert.equal(rejoined.rejoined, true);
    assert.equal(String(rejoined.membership._id), String(joined.membership._id));
    assert.equal(String(rejoined.visitSession._id), String(joined.visitSession._id));
    assert.equal(await SynchronizedVisitMembership.countDocuments({ synchronizedSessionId: first.synchronizedSession._id, userId: participant._id }), 1);
    assert.equal(await VisitSessionV2.countDocuments({ synchronizedSessionId: first.synchronizedSession._id, userId: participant._id }), 1);
    assert.equal(joined.visitSession.currentPlanRevisionId, null);
    assert.equal(joined.visitSession.currentEntryIndex, null);

    const participantRuntime = await currentSessionProjection({ sessionId: joined.visitSession._id, userId: participant._id });
    assert.equal(participantRuntime.synchronization.role, "participant");
    assert.equal(participantRuntime.synchronization.status, "lobby");
    assert.equal(participantRuntime.availableActions.some((action) => ["PROGRESS_NEXT", "PROGRESS_PREVIOUS"].includes(action.type)), false);
    assert.equal(participantRuntime.availableActions.some((action) => action.type === "SYNCHRONIZED_START"), false);

    const hostRuntime = await currentSessionProjection({ sessionId: first.hostVisitSession._id, userId: host._id });
    const startAction = hostRuntime.availableActions.find((action) => action.type === "SYNCHRONIZED_START");
    assert.ok(startAction);
    assert.equal(startAction.runtimeScope, "synchronized_visit_session");
    await dispatchAction({
      sessionId: first.hostVisitSession._id,
      userId: host._id,
      payload: { actionId: startAction.actionId, expectedRuntimeVersion: startAction.runtimeVersion, interactionChannel: "button" },
    });

    const groupAfterStart = await SynchronizedVisitSession.findById(first.synchronizedSession._id).lean();
    assert.equal(groupAfterStart.status, "active");
    assert.equal(groupAfterStart.runtimeVersion, 2);
    const participantState = await getCurrentSessionPlanV2({ sessionId: joined.visitSession._id, userId: participant._id });
    assert.equal(participantState.planOwnerType, "synchronized_visit_session");
    assert.equal(String(participantState.plan._id), String(first.plan._id));
    assert.equal(participantState.currentEntryIndex, 0);
    assert.equal(participantState.effectiveStatus, "active");

    const playbackEntryId = new mongoose.Types.ObjectId();
    await SessionPlanRevisionV2.collection.updateOne(
      { _id: first.plan._id },
      { $set: { contentEntries: [{ _id: playbackEntryId }] } },
    );
    const playingGroup = await controlSynchronizedPlayback({
      synchronizedSessionId: first.synchronizedSession._id,
      userId: host._id,
      command: "play",
    });
    assert.equal(playingGroup.playback.state, "playing");
    assert.equal(String(playingGroup.playback.contentEntryId), String(playbackEntryId));
    assert.equal(playingGroup.playback.commandVersion, 1);
    await assert.rejects(
      () => controlSynchronizedPlayback({
        synchronizedSessionId: first.synchronizedSession._id,
        userId: participant._id,
        command: "pause",
      }),
      (error) => error.status === 403,
    );
    const pausedGroup = await controlSynchronizedPlayback({
      synchronizedSessionId: first.synchronizedSession._id,
      userId: host._id,
      command: "pause",
    });
    assert.equal(pausedGroup.playback.state, "paused");
    assert.equal(pausedGroup.playback.commandVersion, 2);
    const resumedGroup = await controlSynchronizedPlayback({
      synchronizedSessionId: first.synchronizedSession._id,
      userId: host._id,
      command: "resume",
    });
    assert.equal(resumedGroup.playback.state, "playing");
    assert.equal(resumedGroup.playback.commandVersion, 3);
    const stoppedGroup = await controlSynchronizedPlayback({
      synchronizedSessionId: first.synchronizedSession._id,
      userId: host._id,
      command: "stop",
    });
    assert.equal(stoppedGroup.playback.state, "idle");
    assert.equal(stoppedGroup.playback.contentEntryId, null);
    assert.equal(stoppedGroup.playback.commandVersion, 4);

    const quizVisitId = new mongoose.Types.ObjectId();
    const quizRevision = await VisitRevisionV2.create({
      visitId: quizVisitId,
      version: 1,
      title: "Visita sincronizzata con quiz",
      deliveryMode: "synchronized",
      synchronization: { joinAlias: "Giglio blu" },
      quiz: {
        questions: [
          { question: "Chi ha dipinto la Gioconda?", options: ["Leonardo", "Raffaello"], correctOptionIndex: 0, points: 2 },
          { question: "Dove si trova?", options: ["Louvre", "Prado"], correctOptionIndex: 0 },
        ],
      },
      createdBy: host._id,
      updatedBy: host._id,
    });
    const quizGroup = await createSynchronizedVisitRuntime({
      hostUserId: host._id,
      visitId: quizVisitId,
      visitRevisionId: quizRevision._id,
      preferredAlias: "Giglio blu",
      plan: emptySharedPlan(quizRevision._id),
      venuePins: [],
      navigationSnapshot: { movementPacePreference: 0.5, routingProfileSelections: [], requirements: [] },
      sessionMovementSpeedMps: 1,
      adaptivePolicyVersion: 1,
    });
    const quizParticipant = await joinSynchronizedVisitSession({ userId: participant._id, alias: "giglio blu" });

    assert.equal(await MarketplaceAcquisition.countDocuments(), 0);
    assert.equal(await Entitlement.countDocuments(), 0);
    await startSynchronizedVisit({ synchronizedSessionId: quizGroup.synchronizedSession._id, userId: host._id });
    await startSynchronizedQuiz({ synchronizedSessionId: quizGroup.synchronizedSession._id, userId: host._id });

    const quizParticipantRuntime = await currentSessionProjection({ sessionId: quizParticipant.visitSession._id, userId: participant._id });
    const submitAction = quizParticipantRuntime.availableActions.find((action) => action.type === "SYNCHRONIZED_SUBMIT_QUIZ");
    assert.ok(submitAction);
    assert.equal(quizParticipantRuntime.availableActions.some((action) => ["PROGRESS_NEXT", "PROGRESS_PREVIOUS"].includes(action.type)), false);
    await dispatchAction({
      sessionId: quizParticipant.visitSession._id,
      userId: participant._id,
      payload: {
        actionId: submitAction.actionId,
        expectedRuntimeVersion: submitAction.runtimeVersion,
        interactionChannel: "button",
        input: {
          answers: quizRevision.quiz.questions.map((question) => ({ questionId: question._id, selectedOptionIndex: 0 })),
        },
      },
    });

    const attempt = await SynchronizedVisitQuizAttempt.findOne({ synchronizedSessionId: quizGroup.synchronizedSession._id, userId: participant._id }).lean();
    assert.equal(attempt.score, 3);
    assert.equal(attempt.maxScore, 3);
    const afterSubmission = await currentSessionProjection({ sessionId: quizParticipant.visitSession._id, userId: participant._id });
    assert.equal(afterSubmission.availableActions.some((action) => action.type === "SYNCHRONIZED_SUBMIT_QUIZ"), false);

    const hostResults = await participantQuizProjection({ synchronizedSessionId: quizGroup.synchronizedSession._id, userId: host._id });
    assert.equal(hostResults.role, "host");
    assert.equal(hostResults.submittedCount, 1);
    assert.equal(hostResults.results[0].score, 3);
    await confirmQuizEvaluation({
      synchronizedSessionId: quizGroup.synchronizedSession._id,
      userId: host._id,
      participantUserId: participant._id,
      value: "Ottimo lavoro",
    });
    const participantQuiz = await participantQuizProjection({ synchronizedSessionId: quizGroup.synchronizedSession._id, userId: participant._id });
    assert.equal(participantQuiz.attempt.evaluation.confirmedByHost, true);
    assert.equal(participantQuiz.attempt.evaluation.value, "Ottimo lavoro");

    const hostQuizRuntime = await currentSessionProjection({ sessionId: quizGroup.hostVisitSession._id, userId: host._id });
    const completeAction = hostQuizRuntime.availableActions.find((action) => action.type === "SYNCHRONIZED_COMPLETE");
    assert.ok(completeAction);
    await dispatchAction({
      sessionId: quizGroup.hostVisitSession._id,
      userId: host._id,
      payload: { actionId: completeAction.actionId, expectedRuntimeVersion: completeAction.runtimeVersion, interactionChannel: "button" },
    });
    const completedGroup = await SynchronizedVisitSession.findById(quizGroup.synchronizedSession._id).lean();
    assert.equal(completedGroup.status, "completed");
    assert.equal(completedGroup.joinLookupKey, null);
    assert.equal(await SynchronizedVisitMembership.countDocuments({ synchronizedSessionId: quizGroup.synchronizedSession._id, status: "completed" }), 2);
    assert.equal(await VisitSessionV2.countDocuments({ synchronizedSessionId: quizGroup.synchronizedSession._id, status: "completed" }), 2);
    await assert.rejects(
      () => joinSynchronizedVisitSession({ userId: participant._id, alias: "Giglio blu" }),
      (error) => error.status === 404,
    );

    const cancelRuntime = await currentSessionProjection({ sessionId: second.hostVisitSession._id, userId: host._id });
    const cancelAction = cancelRuntime.availableActions.find((action) => action.type === "SYNCHRONIZED_CANCEL");
    assert.ok(cancelAction);
    await dispatchAction({
      sessionId: second.hostVisitSession._id,
      userId: host._id,
      payload: { actionId: cancelAction.actionId, expectedRuntimeVersion: cancelAction.runtimeVersion, interactionChannel: "button" },
    });
    const cancelledGroup = await SynchronizedVisitSession.findById(second.synchronizedSession._id).lean();
    assert.equal(cancelledGroup.status, "cancelled");
    assert.equal(cancelledGroup.joinLookupKey, null);
    assert.equal(await VisitSessionV2.countDocuments({ synchronizedSessionId: second.synchronizedSession._id, status: "abandoned" }), 1);
  });
});
