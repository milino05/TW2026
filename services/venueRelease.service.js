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
const { LAYOUT_FIELDS, normalizeWorkingVenueReleasePayload, validateWorkingVenueReleasePayload } = require("./validation/venueRelease.validation");

function plain(value) { return value?.toObject ? value.toObject() : { ...(value || {}) }; }
function workflowSnapshot(release) { const source = plain(release); return { status: source.status, review: source.review, publication: source.publication, integrity: source.integrity, updatedBy: source.updatedBy }; }

function validateUpdatePayload(rawPayload) {
  const normalized = normalizeWorkingVenueReleasePayload(rawPayload || {});
  const issues = validateWorkingVenueReleasePayload({ payload: normalized, rawPayload: rawPayload || {} });
  if (issues.length) throw new AppError("Payload VenueRelease non valido", 400, issues);
  return normalized;
}

async function loadReleaseSnapshot(releaseId) {
  const release = await VenueRelease.findById(releaseId);
  if (!release) throw new AppError("VenueRelease non trovata", 404);
  const layout = await LayoutRevision.findById(release.layoutRevisionId);
  if (!layout) throw new AppError("LayoutRevision della VenueRelease non trovata", 409);
  return { release, layout };
}

async function createWorkingReleaseFromPublished({ venue, actorUserId }) {
  let version = 1;
  let basedOnReleaseId = null;
  let targetBindings = [];
  let preVisitInformation = [];
  let sourceLayout = null;
  if (venue.publishedReleaseId) {
    const published = await VenueRelease.findById(venue.publishedReleaseId).lean();
    if (!published || published.status !== "published") throw new AppError("VenueRelease pubblicata non disponibile", 409);
    sourceLayout = await LayoutRevision.findById(published.layoutRevisionId).lean();
    if (!sourceLayout) throw new AppError("LayoutRevision pubblicata non disponibile", 409);
    version = published.version + 1;
    basedOnReleaseId = published._id;
    targetBindings = published.targetBindings || [];
    preVisitInformation = published.preVisitInformation || [];
  }

  const layout = await LayoutRevision.create({
    ...(sourceLayout ? {
      placeTypes: sourceLayout.placeTypes,
      routingAttributes: sourceLayout.routingAttributes,
      routingPresets: sourceLayout.routingPresets,
      floors: sourceLayout.floors,
      places: sourceLayout.places,
      venueTargetPlacements: sourceLayout.venueTargetPlacements,
      connections: sourceLayout.connections,
      basedOnRevisionId: sourceLayout._id,
    } : {}),
    venueId: venue._id,
    version,
    status: "draft",
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });

  try {
    const release = await VenueRelease.create({
      venueId: venue._id,
      version,
      basedOnReleaseId,
      layoutRevisionId: layout._id,
      targetBindings,
      preVisitInformation,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    venue.workingReleaseId = release._id;
    await venue.save();
    return { venue, release, layout };
  } catch (error) {
    await LayoutRevision.deleteOne({ _id: layout._id }).catch(() => {});
    throw error;
  }
}

async function ensureWorkingVenueRelease({ venueId, actorUserId }) {
  const { venue } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (!venue.workingReleaseId) return createWorkingReleaseFromPublished({ venue, actorUserId });
  const { release, layout } = await loadReleaseSnapshot(venue.workingReleaseId);
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
  const targetIds = (release.targetBindings || []).map((binding) => binding.venueTargetId);
  const targets = await VenueTarget.find({ _id: { $in: targetIds } }).lean();
  return { venue: projectVenue(venue, { includeWorking: view === "working" }), release, layout, targets };
}

async function updateWorkingVenueRelease({ venueId, payload, actorUserId }) {
  const normalized = validateUpdatePayload(payload || {});
  const { venue, release, layout } = await ensureWorkingVenueRelease({ venueId, actorUserId });
  try { markRevisionEdited(release, actorUserId); }
  catch (error) { throw new AppError(error.message, 409); }
  if (Object.prototype.hasOwnProperty.call(normalized, "targetBindings")) release.targetBindings = normalized.targetBindings;
  if (Object.prototype.hasOwnProperty.call(normalized, "preVisitInformation")) release.preVisitInformation = normalized.preVisitInformation;
  if (normalized.layout) {
    for (const field of LAYOUT_FIELDS) if (Object.prototype.hasOwnProperty.call(normalized.layout, field)) layout[field] = normalized.layout[field];
    layout.updatedBy = actorUserId;
  }
  await layout.save();
  await release.save();
  return { venue, release, layout };
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
  updateWorkingVenueRelease,
  checkVenueReleaseConsistency,
  submitVenueReleaseReview,
  withdrawVenueReleaseReview,
  requestVenueReleaseChanges,
  publishVenueRelease,
};
