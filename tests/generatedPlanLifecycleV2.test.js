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

async function createPlan({ userId, status }) {
  const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
  return GeneratedVisitPlanV2.create({
    userId,
    status,
    requestSnapshot: {},
    contextSnapshot: {},
    sourceEditorialReleaseIds: [],
    sourceVenueReleaseIds: [],
    sourceLayoutRevisionIds: [],
    adaptivePolicyVersion: 1,
    acceptedAt: status === "accepted" ? new Date() : null,
  });
}

test("GeneratedPlan acceptance is idempotent and cannot reactivate a superseded plan", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const { acceptGeneratedPlanForUserV2 } = require("../services/generatedPlanLifecycleV2.service");
    const user = await User.create({ username: "generated-plan-lifecycle", passwordHash: "hash" });

    const proposed = await createPlan({ userId: user._id, status: "proposed" });
    const accepted = await acceptGeneratedPlanForUserV2({ planId: proposed._id, userId: user._id });
    assert.equal(accepted.status, "accepted");
    assert.ok(accepted.acceptedAt);
    const firstAcceptedAt = accepted.acceptedAt.getTime();
    const repeated = await acceptGeneratedPlanForUserV2({ planId: proposed._id, userId: user._id });
    assert.equal(repeated.acceptedAt.getTime(), firstAcceptedAt);

    const superseded = await createPlan({ userId: user._id, status: "superseded" });
    await assert.rejects(
      () => acceptGeneratedPlanForUserV2({ planId: superseded._id, userId: user._id }),
      (error) => error?.status === 409 && error?.details?.some((issue) => issue.code === "GENERATED_PLAN_NOT_ACCEPTABLE"),
    );
  });
});
