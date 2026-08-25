const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_visit_authoring_v2`;
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

test("visit authoring projects scalable content and obeys revision workflow", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const { IDS, seedExamDataset } = require("../scripts/examDatasetV2");
    const visitService = require("../services/visitV2.service");
    const { getVisitAuthoringProjection, searchVisitAuthoringContent } = require("../services/visitAuthoringV2.service");
    const publication = require("../services/visitV2Publication.service");

    const seeded = await seedExamDataset();
    const manager = await User.findOne({ username: "autore1" }).lean();
    assert.ok(manager);

    const newProjection = await getVisitAuthoringProjection({
      actorUserId: manager._id,
      principalType: "organization",
      principalId: IDS.organization,
    });
    assert.equal(String(newProjection.principal.id), String(IDS.organization));
    assert.equal(newProjection.availableOperations.some((entry) => entry.code === "visit.create"), true);
    assert.equal(newProjection.editorialSources.some((entry) => String(entry.editorialReleaseId) === String(IDS.editorialRelease)), true);
    assert.equal(newProjection.venueSelector.organizations.some((organization) => (organization.venues || []).some((venue) => String(venue.id) === String(IDS.venue))), true);

    const page = await searchVisitAuthoringContent({
      actorUserId: manager._id,
      editorialReleaseId: IDS.editorialRelease,
      principalType: "organization",
      principalId: IDS.organization,
      page: 1,
      limit: 5,
    });
    assert.equal(page.limit, 5);
    assert.ok(page.total >= 10);
    assert.equal(page.results.length, 5);
    assert.equal(page.results.every((entry) => entry.presentationProfiles.length >= 2), true);
    assert.equal(page.results.every((entry) => entry.primarySubjectId), true);

    const visitId = seeded.visitRecords[0].visit._id;
    const publishedProjection = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId });
    assert.equal(publishedProjection.visit.revision.status, "published");
    assert.equal(publishedProjection.visit.revision.entries.every((entry) => entry.primarySubjectId), true);
    assert.equal(publishedProjection.availableOperations.some((entry) => entry.code === "visit.edit"), true);
    assert.equal(publishedProjection.availableOperations.some((entry) => entry.code === "workflow.check"), false);

    await visitService.updateVisitV2({
      visitId,
      actorUserId: manager._id,
      payload: { description: publishedProjection.visit.revision.description },
    });
    const draftProjection = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId });
    assert.equal(draftProjection.visit.revision.status, "draft");
    assert.equal(draftProjection.availableOperations.some((entry) => entry.code === "visit.edit"), true);
    assert.equal(draftProjection.availableOperations.some((entry) => entry.code === "workflow.check"), true);

    await publication.evaluateVisitV2Consistency({ visitId, actorUserId: manager._id });
    await publication.requestVisitV2Review({ visitId, actorUserId: manager._id });
    const reviewProjection = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId });
    assert.equal(reviewProjection.visit.revision.status, "in_review");
    assert.equal(reviewProjection.availableOperations.some((entry) => entry.code === "visit.edit"), false);
    assert.equal(reviewProjection.availableOperations.some((entry) => entry.code === "workflow.withdraw_review"), true);
    assert.equal(reviewProjection.availableOperations.some((entry) => entry.code === "workflow.publish"), true);

    await publication.withdrawVisitV2Review({ visitId, actorUserId: manager._id });
    const editableAgain = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId });
    assert.equal(editableAgain.visit.revision.status, "draft");
    assert.equal(editableAgain.availableOperations.some((entry) => entry.code === "visit.edit"), true);
  });
});