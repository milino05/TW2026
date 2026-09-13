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

test("la stessa VisitRevision può essere preparata come personale o sincronizzata", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const {
      createExecutionPreparation,
      updateExecutionPreparation,
    } = require("../services/executionPreparationV2.service");

    const owner = await User.create({ username: "execution-mode-owner", passwordHash: "test-hash" });
    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Una visita, due modalità runtime",
      groupSessionDefaults: { preferredJoinAlias: "Fenice rossa" },
      quiz: { questions: [] },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const personal = await createExecutionPreparation({
      userId: owner._id,
      payload: { visitId: visit._id, executionMode: "self_guided" },
    });
    assert.equal(personal.executionMode, "self_guided");
    assert.deepEqual(personal.availableExecutionModes, ["self_guided", "synchronized"]);
    assert.equal(personal.groupSessionSetup.requestedJoinAlias, null);
    assert.equal(String(personal.source.visitRevisionId), String(revision._id));
    assert.equal(Object.hasOwn(personal.source, "deliveryMode"), false);

    const group = await createExecutionPreparation({
      userId: owner._id,
      payload: { visitId: visit._id, executionMode: "synchronized" },
    });
    assert.equal(group.executionMode, "synchronized");
    assert.equal(group.groupSessionSetup.requestedJoinAlias, "Fenice rossa");
    assert.equal(String(group.source.visitRevisionId), String(revision._id));

    const switched = await updateExecutionPreparation({
      preparationId: personal.id,
      userId: owner._id,
      expectedVersion: personal.version,
      payload: {
        executionMode: "synchronized",
        groupSessionSetup: { requestedJoinAlias: "Atena blu" },
      },
    });
    assert.equal(switched.executionMode, "synchronized");
    assert.equal(switched.groupSessionSetup.requestedJoinAlias, "Atena blu");
    assert.equal(switched.version, personal.version + 1);
    assert.equal(String(switched.source.visitRevisionId), String(revision._id));
  });
});

test("ExecutionPreparation rifiuta modalità runtime non supportate", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
    const { createExecutionPreparation } = require("../services/executionPreparationV2.service");

    const user = await User.create({ username: "execution-mode-generated", passwordHash: "test-hash" });
    const plan = await GeneratedVisitPlanV2.create({
      userId: user._id,
      status: "accepted",
      requestSnapshot: {},
      contextSnapshot: {},
      sourceEditorialReleaseIds: [],
      contentEntries: [],
      visitAnchors: [],
      physicalRoute: { legs: [] },
      estimatedTiming: {},
      explanation: {},
    });

    await assert.rejects(
      () => createExecutionPreparation({
        userId: user._id,
        payload: { generatedVisitPlanId: plan._id, executionMode: "synchronized" },
      }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "EXECUTION_MODE_NOT_SUPPORTED",
    );
  });
});
