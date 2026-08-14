const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const AppError = require("../utils/AppError");
const { assertMuseumRole } = require("./museumAuthorization.service");
const { findVisitOrFail, assertVisitEditor } = require("./visit.service");
const { computeVisitIntegrity } = require("./validation/visitIntegrity.validation");
const { computeBaselineTiming } = require("./baselineTiming.service");
const { requestReview, withdrawReview, requestChanges, markPublished } = require("./revisionWorkflow.service");

async function loadWorking(visitId) { const visit = await findVisitOrFail(visitId); if (!visit.workingRevisionId) throw new AppError("La visita non ha una revisione di lavoro", 409); const revision = await VisitRevision.findById(visit.workingRevisionId); if (!revision) throw new AppError("Revisione di lavoro non trovata", 409); return { visit, revision }; }

async function evaluateVisitConsistency({ visitId, actorUserId, allowInReview = false }) {
  const { visit, revision } = await loadWorking(visitId); await assertVisitEditor({ visit, actorUserId });
  if (revision.status === "in_review" && !allowInReview) throw new AppError("Ritirare la richiesta prima di ricontrollare", 409);
  const result = await computeVisitIntegrity({ visit: visit.toObject(), revision: revision.toObject() });
  const blocking = result.issues.some((entry) => entry.severity !== "warning");
  revision.integrity = { status: blocking ? "needs_review" : "valid", issues: result.issues, checkedAt: new Date(), checkedBy: actorUserId };
  revision.museumIds = result.museumIds;
  revision.baselineTiming = { ...(revision.baselineTiming?.toObject?.() || revision.baselineTiming || {}), estimatedContentSeconds: result.estimatedContentSeconds, computedAt: null };
  revision.updatedBy = actorUserId;
  await revision.save();
  return { visit, revision, ...result };
}

async function checkVisitConsistency({ visitId, actorUserId }) { return evaluateVisitConsistency({ visitId, actorUserId, allowInReview: false }); }
async function requestVisitReview({ visitId, actorUserId }) { const consistency = await checkVisitConsistency({ visitId, actorUserId }); if (consistency.visit.kind !== "official") throw new AppError("Le visite community non usano la revisione manageriale", 409); if (consistency.issues.some((entry) => entry.severity !== "warning")) throw new AppError("Impossibile richiedere la revisione con problemi di integrita", 400, consistency.issues); try { requestReview(consistency.revision, actorUserId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await consistency.revision.save(); return consistency; }
async function withdrawVisitReview({ visitId, actorUserId }) { const { visit, revision } = await loadWorking(visitId); await assertVisitEditor({ visit, actorUserId }); if (visit.kind !== "official") throw new AppError("Operazione non applicabile alle visite community", 409); try { withdrawReview(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { visit, revision }; }
async function requestVisitChanges({ visitId, actorUserId, message }) { const { visit, revision } = await loadWorking(visitId); if (visit.kind !== "official") throw new AppError("Operazione non applicabile alle visite community", 409); await assertMuseumRole({ userId: actorUserId, museumId: visit.ownerMuseumId, minimumRole: "manager" }); try { requestChanges(revision, actorUserId, message); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); } await revision.save(); return { visit, revision }; }

async function compensateVisitPublish({ visit, revision, previousPublishedId, previousRevisionState, previousSuperseded }) {
  const pointer = await Visit.updateOne(
    { _id: visit._id, publishedRevisionId: revision._id, workingRevisionId: null },
    { $set: { publishedRevisionId: previousPublishedId || null, workingRevisionId: revision._id } },
  );
  revision.status = previousRevisionState.status;
  revision.review = previousRevisionState.review;
  revision.publication = previousRevisionState.publication;
  await revision.save();
  let previous = { modifiedCount: 1 };
  if (previousPublishedId && previousSuperseded) previous = await VisitRevision.updateOne({ _id: previousPublishedId, status: "superseded" }, { $set: { status: "published" } });
  if (pointer.modifiedCount !== 1 || previous.modifiedCount !== 1) throw new AppError("Rollback pubblicazione Visit incompleto", 500, [{ code: "VISIT_PUBLISH_ROLLBACK_FAILED" }]);
}

async function publishVisit({ visitId, actorUserId }) {
  const initial = await loadWorking(visitId);
  if (initial.visit.kind === "official") await assertMuseumRole({ userId: actorUserId, museumId: initial.visit.ownerMuseumId, minimumRole: "manager" }); else await assertVisitEditor({ visit: initial.visit, actorUserId });
  const consistency = await evaluateVisitConsistency({ visitId, actorUserId, allowInReview: initial.visit.kind === "official" });
  const { visit, revision, issues, estimatedContentSeconds } = consistency;
  if (issues.some((entry) => entry.severity !== "warning")) throw new AppError("Impossibile pubblicare una visita con problemi di integrita", 400, issues);
  if (visit.kind === "community" && revision.status === "in_review") throw new AppError("Stato non valido per una visita community", 409);
  revision.baselineTiming = await computeBaselineTiming({ visit: visit.toObject ? visit.toObject() : visit, revision: revision.toObject ? revision.toObject() : revision, estimatedContentSeconds });
  const previousPublishedId = visit.publishedRevisionId;
  const previousRevisionState = { status: revision.status, review: revision.review?.toObject ? revision.review.toObject() : { ...revision.review }, publication: revision.publication?.toObject ? revision.publication.toObject() : { ...revision.publication } };
  try { markPublished(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  let pointerSwitched = false, previousSuperseded = false;
  try {
    const update = await Visit.updateOne({ _id: visit._id, workingRevisionId: revision._id, lifecycleStatus: "active" }, { $set: { publishedRevisionId: revision._id, workingRevisionId: null } });
    if (update.modifiedCount !== 1) throw new AppError("La revisione di lavoro e cambiata durante la pubblicazione", 409);
    pointerSwitched = true;
    if (previousPublishedId) {
      const previous = await VisitRevision.updateOne({ _id: previousPublishedId, status: "published" }, { $set: { status: "superseded" } });
      if (previous.modifiedCount !== 1) throw new Error("Impossibile supersedere la precedente VisitRevision");
      previousSuperseded = true;
    }
  } catch (error) {
    if (pointerSwitched) {
      try { await compensateVisitPublish({ visit, revision, previousPublishedId, previousRevisionState, previousSuperseded }); }
      catch (rollbackError) { if (rollbackError instanceof AppError) throw rollbackError; throw new AppError("Rollback pubblicazione Visit incompleto", 500, [{ code: "VISIT_PUBLISH_ROLLBACK_FAILED", message: rollbackError.message }, { code: "ORIGINAL_ERROR", message: error.message }]); }
    } else {
      revision.status = previousRevisionState.status; revision.review = previousRevisionState.review; revision.publication = previousRevisionState.publication; await revision.save().catch(() => {});
    }
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione Visit annullata per errore di consistenza", 500, [{ code: "VISIT_PUBLISH_FAILED", message: error.message }]);
  }
  visit.publishedRevisionId = revision._id; visit.workingRevisionId = null;
  return { visit, revision };
}

module.exports = { checkVisitConsistency, requestVisitReview, withdrawVisitReview, requestVisitChanges, compensateVisitPublish, publishVisit };
