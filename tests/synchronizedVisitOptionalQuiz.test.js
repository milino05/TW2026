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

async function createActiveGroup({ withQuiz }) {
  const User = require("../models/user");
  const VisitRevisionV2 = require("../models/visitRevisionV2.model");
  const VisitSessionV2 = require("../models/visitSessionV2.model");
  const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
  const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");

  const host = await User.create({ username: withQuiz ? "quiz-host" : "no-quiz-host", passwordHash: "test-hash" });
  const visitId = new mongoose.Types.ObjectId();
  const revision = await VisitRevisionV2.create({
    visitId,
    version: 1,
    title: withQuiz ? "Visita con quiz" : "Visita senza quiz",
    quiz: withQuiz ? {
      questions: [{ question: "Domanda?", options: ["A", "B"], correctOptionIndex: 0, points: 1 }],
    } : { questions: [] },
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
    joinAlias: withQuiz ? "QUIZ TEST" : "NO QUIZ TEST",
    joinLookupKey: withQuiz ? "quiz test" : "no quiz test",
    status: "active",
    currentEntryIndex: 0,
    sessionMovementSpeedMps: 1,
    adaptivePolicyVersion: 1,
    startedAt: new Date(),
  });
  const visitSession = await VisitSessionV2.create({
    userId: host._id,
    sourceType: "visit",
    visitId,
    visitRevisionId: revision._id,
    synchronizedSessionId: group._id,
    currentPlanRevisionId: null,
    currentEntryIndex: null,
    adaptivePolicyVersion: 1,
  });
  await SynchronizedVisitMembership.create({
    synchronizedSessionId: group._id,
    userId: host._id,
    role: "host",
    visitSessionId: visitSession._id,
    status: "active",
  });
  return { host, revision, group, visitSession };
}

test("una sessione sincronizzata senza quiz può completarsi direttamente da active", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const {
      synchronizedQuizAvailable,
      completeSynchronizedVisit,
    } = require("../services/synchronizedVisitSession.service");

    const runtime = await createActiveGroup({ withQuiz: false });
    assert.equal(await synchronizedQuizAvailable(runtime.group), false);

    const completed = await completeSynchronizedVisit({
      synchronizedSessionId: runtime.group._id,
      userId: runtime.host._id,
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.joinLookupKey, null);

    const membership = await SynchronizedVisitMembership.findOne({ synchronizedSessionId: runtime.group._id, userId: runtime.host._id }).lean();
    const personal = await VisitSessionV2.findById(runtime.visitSession._id).lean();
    assert.equal(membership.status, "completed");
    assert.equal(personal.status, "completed");
  });
});

test("una sessione con quiz deve attraversare lo stato quiz prima del completamento", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const {
      synchronizedQuizAvailable,
      startSynchronizedQuiz,
      completeSynchronizedVisit,
    } = require("../services/synchronizedVisitSession.service");

    const runtime = await createActiveGroup({ withQuiz: true });
    assert.equal(await synchronizedQuizAvailable(runtime.group), true);

    await assert.rejects(
      () => completeSynchronizedVisit({ synchronizedSessionId: runtime.group._id, userId: runtime.host._id }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "SYNCHRONIZED_QUIZ_REQUIRED_BEFORE_COMPLETE",
    );

    const quiz = await startSynchronizedQuiz({ synchronizedSessionId: runtime.group._id, userId: runtime.host._id });
    assert.equal(quiz.status, "quiz");
    const completed = await completeSynchronizedVisit({ synchronizedSessionId: runtime.group._id, userId: runtime.host._id });
    assert.equal(completed.status, "completed");
  });
});
