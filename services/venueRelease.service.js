const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const AppError = require("../utils/AppError");
const { assertVenuePermission, findVenueOrFail } = require("./venueAuthorization.service");
const { projectVenue } = require("./venue.service");
const {
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  approveReviewAndPublish,
} = require("./revisionWorkflow.service");
const { computeVenueReleaseIssues } = require("./venueReleaseIntegrity.service");
const { runPostCommitAudit } = require("./postCommitAudit.service");
const { auditVisitsAgainstVenueRelease } = require("./visitV2Dependency.service");
const { assertCanAuthorLayoutAgainstRevision, loadLayoutPhysicalVocabulary } = require("./layoutPhysicalVocabulary.service");

function plain(value) { return value?.toObject ? value.toObject() : { ...(value || {}) }; }
function workflowSnapshot(release) { const source = plain(release); return { status: source.status, review: source.review, publication: source.publication, integrity: source.integrity, updatedBy: source.updatedBy }; }

async function loadReleaseSnapshot(releaseId, { session = null } = {}) {
  const release = await VenueRelease.findById(releaseId).session(session);
  if (!release) throw new AppError("VenueRelease non trovata", 404);
  const layout = await LayoutRevision.findById(release.layoutRevisionId).session(session);
  if (!layout) throw new AppError("LayoutRevision della VenueRelease non trovata", 409);
  return { release, layout };
}

async function createWorkingReleaseFromPublished({ venue, physicalVocabularyRevisionId = null, actorUserId }) {
  if (!venue.publishedReleaseId) {
    if (!physicalVocabularyRevisionId) {
      throw new AppError("Seleziona un Physical Vocabulary prima di configurare la sede", 409, [{
        field: "physicalVocabularyRevisionId",
        code: "PHYSICAL_VOCABULARY_REVISION_REQUIRED",
      }]);
    }
    await assertCanAuthorLayoutAgainstRevision({ physicalVocabularyRevisionId, venue, actorUserId });
  }

  const currentVenue = await Venue.findOne({ _id: venue._id, lifecycleStatus: "active" });
  if (!currentVenue) throw new AppError("Venue non trovata", 404);
  if (currentVenue.workingReleaseId) {
    const existing = await loadReleaseSnapshot(currentVenue.workingReleaseId);
    if (physicalVocabularyRevisionId
      && String(physicalVocabularyRevisionId) !== String(existing.layout.authoredAgainstPhysicalVocabularyRevisionId)) {
      throw new AppError("La working release usa gia un'altra revisione del vocabolario fisico", 409, [{ code: "LAYOUT_PHYSICAL_VOCABULARY_IMMUTABLE" }]);
    }
    return { venue: currentVenue, ...existing };
  }

  let version = 1;
  let basedOnReleaseId = null;
  let targetBindings = [];
  let preVisitInformation = [];
  let sourceLayout = null;
  if (currentVenue.publishedReleaseId) {
    const published = await VenueRelease.findById(currentVenue.publishedReleaseId).lean();
    if (!published || published.status !== "published") throw new AppError("VenueRelease pubblicata non disponibile", 409);
    sourceLayout = await LayoutRevision.findById(published.layoutRevisionId).lean();
    if (!sourceLayout) throw new AppError("LayoutRevision pubblicata non disponibile", 409);
    version = published.version + 1;
    basedOnReleaseId = published._id;
    targetBindings = published.targetBindings || [];
    preVisitInformation = published.preVisitInformation || [];
  }

  let layout = await LayoutRevision.findOne({ venueId: currentVenue._id, version });
  if (!layout) {
    try {
      layout = await LayoutRevision.create({
        ...(sourceLayout ? {
          authoredAgainstPhysicalVocabularyRevisionId: sourceLayout.authoredAgainstPhysicalVocabularyRevisionId,
          floors: sourceLayout.floors,
          places: sourceLayout.places,
          exhibitSlots: sourceLayout.exhibitSlots,
          connections: sourceLayout.connections,
          basedOnRevisionId: sourceLayout._id,
        } : { authoredAgainstPhysicalVocabularyRevisionId: physicalVocabularyRevisionId }),
        venueId: currentVenue._id,
        version,
        status: "draft",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      layout = await LayoutRevision.findOne({ venueId: currentVenue._id, version });
      if (!layout) throw error;
    }
  }
  if (physicalVocabularyRevisionId
    && String(physicalVocabularyRevisionId) !== String(layout.authoredAgainstPhysicalVocabularyRevisionId)) {
    throw new AppError("La working release usa gia un'altra revisione del vocabolario fisico", 409, [{ code: "LAYOUT_PHYSICAL_VOCABULARY_IMMUTABLE" }]);
  }

  let release = await VenueRelease.findOne({ venueId: currentVenue._id, version });
  if (!release) {
    try {
      release = await VenueRelease.create({
        venueId: currentVenue._id,
        version,
        basedOnReleaseId,
        layoutRevisionId: layout._id,
        targetBindings,
        preVisitInformation,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      release = await VenueRelease.findOne({ venueId: currentVenue._id, version });
      if (!release) throw error;
    }
  }

  const claimed = await Venue.findOneAndUpdate(
    { _id: currentVenue._id, lifecycleStatus: "active", workingReleaseId: null },
    { $set: { workingReleaseId: release._id } },
    { new: true },
  );
  if (claimed) return { venue: claimed, release, layout };

  const winnerVenue = await Venue.findOne({ _id: currentVenue._id, lifecycleStatus: "active" });
  if (!winnerVenue) throw new AppError("Venue non trovata", 404);
  if (!winnerVenue.workingReleaseId) throw new AppError("Creazione della working VenueRelease non completata", 500);
  const existing = await loadReleaseSnapshot(winnerVenue.workingReleaseId);
  if (physicalVocabularyRevisionId
    && String(physicalVocabularyRevisionId) !== String(existing.layout.authoredAgainstPhysicalVocabularyRevisionId)) {
    throw new AppError("La working release usa gia un'altra revisione del vocabolario fisico", 409, [{ code: "LAYOUT_PHYSICAL_VOCABULARY_IMMUTABLE" }]);
  }
  return { venue: winnerVenue, ...existing };
}

async function ensureWorkingVenueRelease({ venueId, physicalVocabularyRevisionId = null, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (!venue.workingReleaseId) return createWorkingReleaseFromPublished({ venue, physicalVocabularyRevisionId, actorUserId });
  const { release, layout } = await loadReleaseSnapshot(venue.workingReleaseId);
  if (physicalVocabularyRevisionId && String(physicalVocabularyRevisionId) !== String(layout.authoredAgainstPhysicalVocabularyRevisionId)) {
    throw new AppError("La working release usa gia un'altra revisione del vocabolario fisico", 409, [{ code: "LAYOUT_PHYSICAL_VOCABULARY_IMMUTABLE" }]);
  }
  if (!["draft", "changes_requested", "in_review"].includes(release.status)) throw new AppError("Working VenueRelease in stato non valido", 409);
  return { venue, release, layout };
}

async function getVenuePhysicalState({ venueId, view = "published", actorUserId = null }) {
  const venue = await findVenueOrFail({ venueId });
  let releaseId;
  if (view === "working") {
    await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
    releaseId = venue.workingReleaseId;
  } else if (view === "published") releaseId = venue.publishedReleaseId;
  else throw new AppError("view deve essere published o working", 400);
  if (!releaseId) throw new AppError(view === "published" ? "VenueRelease pubblicata non disponibile" : "Working VenueRelease non disponibile", 404);
  const { release, layout } = await loadReleaseSnapshot(releaseId);
  const { physicalVocabulary, revision: physicalVocabularyRevision } = await loadLayoutPhysicalVocabulary(layout);
  const targetIds = (release.targetBindings || []).map((binding) => binding.venueTargetId);
  const targets = await VenueTarget.find({ _id: { $in: targetIds } }).lean();
  return { venue: projectVenue(venue, { includeWorking: view === "working" }), release, layout, physicalVocabulary, physicalVocabularyRevision, targets };
}

async function checkVenueReleaseConsistency({ venueId, actorUserId }) {
  const { venue, release, layout } = await ensureWorkingVenueRelease({ venueId, actorUserId });
  const issues = await computeVenueReleaseIssues({ venue, release, layout });
  release.integrity = {
    status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid",
    issues,
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  await release.save();
  return { venue, release, layout };
}

async function submitVenueReleaseReview({ venueId, actorUserId }) {
  const snapshot = await checkVenueReleaseConsistency({ venueId, actorUserId });
  try { requestReview(snapshot.release, actorUserId); }
  catch (error) { throw new AppError(error.message, 409); }
  await snapshot.release.save();
  return snapshot;
}

async function withdrawVenueReleaseReview({ venueId, actorUserId }) {
  const { venue, release, layout } = await ensureWorkingVenueRelease({ venueId, actorUserId });
  try { withdrawReview(release, actorUserId); }
  catch (error) { throw new AppError(error.message, 409); }
  await release.save();
  return { venue, release, layout };
}

async function requestVenueReleaseChanges({ venueId, actorUserId, message }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.review" });
  if (!venue.workingReleaseId) throw new AppError("Working VenueRelease non disponibile", 404);
  const { release, layout } = await loadReleaseSnapshot(venue.workingReleaseId);
  try { requestChanges(release, actorUserId, message); }
  catch (error) { throw new AppError(error.message, 409); }
  await release.save();
  return { venue, release, layout };
}

async function compensateVenueReleasePublish({ venue, release, layout, oldRelease, oldLayout, previousReleaseState }) {
  await Venue.updateOne({ _id: venue._id, publishedReleaseId: release._id }, { $set: { publishedReleaseId: oldRelease?._id || null, workingReleaseId: release._id } });
  await VenueRelease.updateOne({ _id: release._id }, { $set: previousReleaseState });
  await LayoutRevision.updateOne({ _id: layout._id }, { $set: { status: "draft" } });
  if (oldRelease) await VenueRelease.updateOne({ _id: oldRelease._id }, { $set: { status: "published" } });
  if (oldLayout) await LayoutRevision.updateOne({ _id: oldLayout._id }, { $set: { status: "published" } });
}

async function publishVenueRelease({ venueId, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.publish" });
  if (!venue.workingReleaseId) throw new AppError("Nessuna VenueRelease da pubblicare", 404);
  const { release, layout } = await loadReleaseSnapshot(venue.workingReleaseId);
  const issues = await computeVenueReleaseIssues({ venue, release, layout });
  release.integrity = { status: issues.some((issue) => issue.severity !== "warning") ? "needs_review" : "valid", issues, checkedAt: new Date(), checkedBy: actorUserId };
  if (release.integrity.status !== "valid") { await release.save(); throw new AppError("VenueRelease non consistente", 409, issues); }
  const previousReleaseState = workflowSnapshot(release);
  try { approveReviewAndPublish(release, actorUserId); }
  catch (error) { throw new AppError(error.message, 409); }
  await release.save();
  layout.status = "published";
  layout.updatedBy = actorUserId;
  await layout.save();

  const oldRelease = venue.publishedReleaseId ? await VenueRelease.findById(venue.publishedReleaseId) : null;
  const oldLayout = oldRelease ? await LayoutRevision.findById(oldRelease.layoutRevisionId) : null;
  try {
    const pointer = await Venue.updateOne(
      { _id: venue._id, workingReleaseId: release._id, lifecycleStatus: "active" },
      { $set: { publishedReleaseId: release._id, workingReleaseId: null } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La working VenueRelease e cambiata durante la pubblicazione", 409);
    if (oldRelease) {
      oldRelease.status = "superseded";
      await oldRelease.save();
    }
    if (oldLayout) {
      oldLayout.status = "superseded";
      await oldLayout.save();
    }
  } catch (error) {
    await compensateVenueReleasePublish({ venue, release, layout, oldRelease, oldLayout, previousReleaseState }).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione VenueRelease annullata", 500, [{ code: "VENUE_RELEASE_PUBLISH_FAILED", message: error.message }]);
  }
  venue.publishedReleaseId = release._id;
  venue.workingReleaseId = null;
  const auditResult = await runPostCommitAudit({
    visitV2DependencyAudit: () => auditVisitsAgainstVenueRelease({ venueId: venue._id, venueReleaseId: release._id }),
  });
  return {
    venue,
    release,
    layout,
    dependencyAudit: auditResult.results.visitV2DependencyAudit,
    audit: { status: auditResult.status, failures: auditResult.failures },
  };
}

module.exports = {
  ensureWorkingVenueRelease,
  getVenuePhysicalState,
  checkVenueReleaseConsistency,
  submitVenueReleaseReview,
  withdrawVenueReleaseReview,
  requestVenueReleaseChanges,
  publishVenueRelease,
};
