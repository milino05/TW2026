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
    const { addContentToVisit, setContentPlacement } = require("../services/visitAuthoringCommandV2.service");
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
    assert.equal(candidates.results.every((entry) => Array.isArray(entry.placementOptions?.occurrences)), true, "ogni card riceve opzioni fisiche come read model");

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
    const directOccurrence = directCandidate.placementOptions.occurrences[0];
    assert.ok(directOccurrence?.venueTargetId, "il contenuto del seed espone una collocazione fisica pubblicata");

    const contextualVisit = await visitService.createVisitV2({
      actorUserId: manager._id,
      payload: { ownerType: "organization", ownerId: IDS.organization, title: "Visita contestuale esplicita" },
    });
    const contextualAdded = await addContentToVisit({
      actorUserId: manager._id,
      visitId: contextualVisit.visit._id,
      payload: {
        entries: [{
          contentSource: directCandidate.contentSource,
          itemEditionId: directCandidate.itemEditionId,
          itemRevisionId: directCandidate.itemRevisionId,
          role: "recommended",
          placement: { mode: "contextual" },
        }],
      },
    });
    assert.equal(contextualAdded.revision.visitAnchors.length, 0, "una occurrence disponibile non crea automaticamente una tappa");
    assert.equal(contextualAdded.revision.contentEntries[0].deliveryAnchorId, null);
    assert.equal(contextualAdded.command.added[0].placement.mode, "contextual");

    const contextualEntryId = contextualAdded.revision.contentEntries[0]._id;
    const contextualProjection = await getVisitAuthoringProjection({ actorUserId: manager._id, visitId: contextualVisit.visit._id });
    const projectedContextualEntry = contextualProjection.visit.revision.entries.find((entry) => String(entry.id) === String(contextualEntryId));
    assert.ok(projectedContextualEntry);
    assert.equal(Array.isArray(projectedContextualEntry.placementOptions?.occurrences), true);
    assert.equal(projectedContextualEntry.placementOptions.occurrences.some((entry) => String(entry.venueTargetId) === String(directOccurrence.venueTargetId)), true, "la card di un contenuto già presente può ricreare la tappa");

    const promoted = await setContentPlacement({
      actorUserId: manager._id,
      visitId: contextualVisit.visit._id,
      contentEntryId: contextualEntryId,
      placement: { mode: "physical", venueTargetId: directOccurrence.venueTargetId },
    });
    assert.equal(promoted.revision.contentEntries.length, 1);
    assert.equal(String(promoted.revision.contentEntries[0]._id), String(contextualEntryId), "rendere fisico il contenuto non ricrea la ContentEntry");
    assert.equal(promoted.revision.visitAnchors.length, 1);
    assert.ok(promoted.revision.contentEntries[0].deliveryAnchorId);
    assert.equal(promoted.command.placement.mode, "physical");
    assert.equal(promoted.command.placement.anchorCreated, true);

    const demoted = await setContentPlacement({
      actorUserId: manager._id,
      visitId: contextualVisit.visit._id,
      contentEntryId: contextualEntryId,
      placement: { mode: "contextual" },
    });
    assert.equal(demoted.revision.contentEntries.length, 1);
    assert.equal(String(demoted.revision.contentEntries[0]._id), String(contextualEntryId), "rendere contestuale il contenuto non lo rimuove dalla visita");
    assert.equal(demoted.revision.contentEntries[0].deliveryAnchorId, null);
    assert.equal(demoted.revision.visitAnchors.length, 0, "l'anchor non più usato viene rimosso");
    assert.equal(demoted.command.placement.mode, "contextual");
    assert.equal(demoted.command.placement.anchorRemoved, true);

    const restoredPhysical = await setContentPlacement({
      actorUserId: manager._id,
      visitId: contextualVisit.visit._id,
      contentEntryId: contextualEntryId,
      placement: { mode: "physical", venueTargetId: directOccurrence.venueTargetId },
    });
    assert.equal(restoredPhysical.revision.contentEntries.length, 1);
    assert.equal(String(restoredPhysical.revision.contentEntries[0]._id), String(contextualEntryId), "contestuale -> tappa riusa la stessa ContentEntry");
    assert.equal(restoredPhysical.revision.visitAnchors.length, 1);

    const added = await addContentToVisit({
      actorUserId: manager._id,
      visitId: directVisit.visit._id,
      payload: {
        entries: [{
          contentSource: directCandidate.contentSource,
          itemEditionId: directCandidate.itemEditionId,
          itemRevisionId: directCandidate.itemRevisionId,
          role: "core",
          placement: { mode: "physical", venueTargetId: directOccurrence.venueTargetId },
        }],
      },
    });
    assert.equal(added.revision.contentSources.length, 1);
    assert.equal(added.revision.contentSources[0].sourceType, "item_revision");
    assert.equal(added.revision.editorialSources.length, 0, "un contenuto diretto non crea raccolte fittizie");
    assert.equal(String(added.revision.contentEntries[0].contentSourceId), String(added.revision.contentSources[0]._id));
    assert.equal(added.revision.visitAnchors.length, 1);
    assert.equal(String(added.revision.contentEntries[0].deliveryAnchorId), String(added.revision.visitAnchors[0]._id));
    assert.equal(added.command.added[0].placement.mode, "physical");
    assert.equal(added.command.added[0].placement.anchorCreated, true);
    const directConsistency = await publication.evaluateVisitV2Consistency({ visitId: directVisit.visit._id, actorUserId: manager._id });
    assert.equal(directConsistency.revision.integrity.status, "valid");
    const directSnapshot = visitRevisionSourceSnapshotV2({ visit: directVisit.visit, revision: directConsistency.revision });
    assert.deepEqual(directSnapshot.sourceEditorialReleaseIds, []);
    const sessionEntries = await materializeContentEntries({ source: directSnapshot });
    assert.equal(sessionEntries.length, 1);
    assert.ok(sessionEntries[0].namespaceRevisionId, "il Navigator risolve le regole direttamente dalla ItemRevision");

    const batchVisit = await visitService.createVisitV2({
      actorUserId: manager._id,
      payload: { ownerType: "organization", ownerId: IDS.organization, title: "Visita batch" },
    });
    const batched = await addContentToVisit({
      actorUserId: manager._id,
      visitId: batchVisit.visit._id,
      payload: {
        entries: ["core", "optional"].map((role) => ({
          contentSource: directCandidate.contentSource,
          itemEditionId: directCandidate.itemEditionId,
          itemRevisionId: directCandidate.itemRevisionId,
          role,
          placement: { mode: "physical", venueTargetId: directOccurrence.venueTargetId },
        })),
      },
    });
    assert.equal(batched.revision.contentEntries.length, 2, "il comando aggiunge più contenuti in una sola mutazione applicativa");
    assert.equal(batched.revision.visitAnchors.length, 1, "due contenuti sullo stesso target riusano una sola tappa");
    assert.equal(batched.command.added.length, 2);
    assert.equal(batched.command.added[0].placement.anchorCreated, true);
    assert.equal(batched.command.added[1].placement.anchorCreated, false);

    const sharedFirstContextual = await setContentPlacement({
      actorUserId: manager._id,
      visitId: batchVisit.visit._id,
      contentEntryId: batched.revision.contentEntries[0]._id,
      placement: { mode: "contextual" },
    });
    assert.equal(sharedFirstContextual.revision.visitAnchors.length, 1, "una tappa condivisa resta se un altro contenuto la usa");
    assert.equal(sharedFirstContextual.command.placement.anchorRemoved, false);

    const sharedSecondContextual = await setContentPlacement({
      actorUserId: manager._id,
      visitId: batchVisit.visit._id,
      contentEntryId: batched.revision.contentEntries[1]._id,
      placement: { mode: "contextual" },
    });
    assert.equal(sharedSecondContextual.revision.visitAnchors.length, 0, "la tappa condivisa sparisce quando anche l'ultimo contenuto diventa contestuale");
    assert.equal(sharedSecondContextual.command.placement.anchorRemoved, true);

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
        entries: [{
          contentSource: acquiredCandidates.results[0].contentSource,
          itemEditionId: acquiredCandidates.results[0].itemEditionId,
          itemRevisionId: acquiredCandidates.results[0].itemRevisionId,
          placement: { mode: "contextual" },
        }],
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
