const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_exam_presentation_matrix`;
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

test("rich exam seed exposes all four presentation controls in a real VisitSession", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const { acquireOffer } = require("../services/marketplaceV2.service");
    const { createExecutionPreparation, startExecutionPreparation } = require("../services/executionPreparationV2.service");
    const { DEF, seedExamDataset } = require("../scripts/examDatasetV2");
    const { enrichExamPresentationMatrix, verifyExamPresentationMatrix } = require("../scripts/examPresentationMatrix");

    const seeded = await seedExamDataset();
    await enrichExamPresentationMatrix();
    const matrixVerification = await verifyExamPresentationMatrix();
    assert.equal(matrixVerification.ok, true, JSON.stringify(matrixVerification.failures));
    assert.equal(matrixVerification.summary.itemRevisions, 12);
    assert.equal(matrixVerification.summary.variants, 36);
    assert.equal(matrixVerification.summary.representations, 324);

    const visitor = await User.findOne({ username: "visitatore1" });
    const middleVisit = seeded.visitRecords.find((entry) => entry.definition.key === "rinascimento-seicento");
    assert.ok(visitor);
    assert.ok(middleVisit);

    await acquireOffer({
      offerId: middleVisit.offer._id,
      actorUserId: visitor._id,
      beneficiaryType: "user",
      beneficiaryId: visitor._id,
    });

    const preparation = await createExecutionPreparation({
      userId: visitor._id,
      payload: { visitId: middleVisit.visit._id },
    });
    assert.equal(preparation.readiness.status, "ready");

    const started = await startExecutionPreparation({
      preparationId: preparation.id,
      userId: visitor._id,
      expectedVersion: preparation.version,
    });
    const current = started.current.current.presentation;
    assert.equal(String(current.durationTypeDefinitionId), String(DEF.durationMedium));
    assert.equal(String(current.languageLevelDefinitionId), String(DEF.languageStandard));

    const actionIds = new Set(started.current.availableActions.map((action) => action.actionId));
    for (const actionId of [
      "presentation.depth.increase",
      "presentation.depth.decrease",
      "presentation.complexity.increase",
      "presentation.complexity.decrease",
    ]) {
      assert.equal(actionIds.has(actionId), true, `Azione runtime mancante: ${actionId}`);
    }
  });
});
