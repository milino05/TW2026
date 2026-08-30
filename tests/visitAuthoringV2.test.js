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
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const { IDS, seedExamDataset } = require("../scripts/examDatasetV2");
    const visitService = require("../services/visitV2.service");
    const { getVisitAuthoringProjection, searchVisitAuthoringContent, searchVisitAuthoringCandidates } = require("../services/visitAuthoringV2.service");
    const { addContentToVisit } = require("../services/visitAuthoringCommandV2.service");
    const { visitRevisionSourceSnapshotV2, materializeContentEntries } = require("../services/sessionPlanV2.service");
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
    const candidates = await searchVisitAuthoringCandidates({ actorUserId: manager._id, visitId, page: 1, limit: 20 });
    assert.ok(candidates.total >= 10);
    assert.equal(new Set(candidates.results.map((entry) => String(entry.itemEditionId))).size, candidates.results.length, "lo stesso contenuto compare una volta anche con più fonti");
    assert.equal(candidates.filters.sources.some((entry) => entry.kind === "editorial_release"), true);
    assert.equal(candidates.results.some((entry) => (entry.availability || []).length > 1), true, "la card conserva tutte le provenienze disponibili");

    const ownedOnly = await searchVisitAuthoringCandidates({ actorUserId: manager._id, visitId, source: "owned", page: 1, limit: 5 });
    assert.ok(ownedOnly.results.length > 0);
    assert.equal(ownedOnly.results.every((entry) => entry.contentSource.sourceType === "item_revision"), true);

    const directVisit = await visitService.createVisitV2({
      actorUserId: manager._id,
      payload: { ownerType: "organization", ownerId: IDS.organization, title: "Visita con contenuto diretto" },
    });
    const emptyVisitProjection = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId: directVisit.visit._id });
    assert.equal(emptyVisitProjection.visit.revision.routeReview.status, "blocked");
    assert.equal(emptyVisitProjection.visit.revision.routeReview.blockers[0].code, "VISIT_PHYSICAL_STOP_REQUIRED");
    const directCandidates = await searchVisitAuthoringCandidates({ actorUserId: manager._id, visitId: directVisit.visit._id, source: "owned", page: 1, limit: 1 });
    const directCandidate = directCandidates.results[0];
    const added = await addContentToVisit({
      actorUserId: manager._id,
      visitId: directVisit.visit._id,
      payload: {
        contentSource: directCandidate.contentSource,
        itemEditionId: directCandidate.itemEditionId,
        itemRevisionId: directCandidate.itemRevisionId,
        role: "core",
      },
    });
    assert.equal(added.revision.contentSources.length, 1);
    assert.equal(added.revision.contentSources[0].sourceType, "item_revision");
    assert.equal(added.revision.editorialSources.length, 0, "un contenuto diretto non crea raccolte fittizie");
    assert.equal(String(added.revision.contentEntries[0].contentSourceId), String(added.revision.contentSources[0]._id));
    const directConsistency = await publication.evaluateVisitV2Consistency({ visitId: directVisit.visit._id, actorUserId: manager._id });
    assert.equal(directConsistency.revision.integrity.status, "valid");
    const directSnapshot = visitRevisionSourceSnapshotV2({ visit: directVisit.visit, revision: directConsistency.revision });
    assert.deepEqual(directSnapshot.sourceEditorialReleaseIds, []);
    const sessionEntries = await materializeContentEntries({ source: directSnapshot });
    assert.equal(sessionEntries.length, 1);
    assert.ok(sessionEntries[0].namespaceRevisionId, "il Navigator risolve le regole direttamente dalla ItemRevision");

    const licensedAuthor = await User.create({ username: "visit-direct-license", passwordHash: "test-hash" });
    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: licensedAuthor._id,
      resourceType: "item_revision",
      resourceId: directCandidate.itemRevisionId,
      capability: "content.use_in_visit",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "item_revision", resourceId: directCandidate.itemRevisionId },
    });
    const licensedVisit = await visitService.createVisitV2({
      actorUserId: licensedAuthor._id,
      payload: { ownerType: "user", ownerId: licensedAuthor._id, title: "Visita con contenuto acquistato" },
    });
    const acquiredCandidates = await searchVisitAuthoringCandidates({ actorUserId: licensedAuthor._id, visitId: licensedVisit.visit._id, access: "acquired" });
    assert.equal(acquiredCandidates.total, 1);
    assert.equal(acquiredCandidates.results[0].availability[0].label, "Acquistato singolarmente");
    await addContentToVisit({
      actorUserId: licensedAuthor._id,
      visitId: licensedVisit.visit._id,
      payload: {
        contentSource: acquiredCandidates.results[0].contentSource,
        itemEditionId: acquiredCandidates.results[0].itemEditionId,
        itemRevisionId: acquiredCandidates.results[0].itemRevisionId,
      },
    });
    assert.equal(await Adoption.countDocuments({ adoptedBy: licensedAuthor._id, action: "content_visit" }), 1);

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
