const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const { findVisitV2OrFail, assertCanManageVisitV2, getWorkingVisitRevisionV2 } = require("./visitV2.service");
const { computeVisitV2Integrity } = require("./visitV2Integrity.service");
const { projectVisitAuthoringRouteReview } = require("./visitAuthoringRouteReviewV2.service");
const {
  requestReview,
  withdrawReview,
  requestChanges,
  publishWithoutReview,
  approveReviewAndPublish,
} = require("./revisionWorkflow.service");

async function loadWorking({ visitId, actorUserId, permissionCode = "visit.edit" }) {
  const visit = await findVisitV2OrFail(visitId);
  await assertCanManageVisitV2({ visit, actorUserId, permissionCode });
  const revision = await getWorkingVisitRevisionV2({ visit, actorUserId, createFromPublished: false });
  return { visit, revision };
}

function routeIssue(issue, field = "routeReview") {
  const context = Object.fromEntries(Object.entries(issue || {}).filter(([key, value]) => (
    !["code", "message", "severity"].includes(key) && value !== undefined
  )));
  return {
    field,
    code: issue.code || "VISIT_ROUTE_NOT_READY",
    message: issue.message || "Il percorso della visita non è verificabile.",
    severity: issue.severity === "warning" ? "warning" : "error",
    ...(Object.keys(context).length ? { context } : {}),
  };
}
function issueSignature(issue) {
  const context = issue.context || {};
  return [
    issue.code,
    issue.field,
    context.anchorId || context.fromAnchorId || "",
    context.toAnchorId || "",
    context.venueId || "",
  ].join("::");
}
function mergeIssues(...groups) {
  const merged = [];
  const seen = new Set();
  for (const issue of groups.flat()) {
    const signature = issueSignature(issue);
    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(issue);
  }
  return merged;
}

async function evaluateVisitV2Consistency({ visitId, actorUserId, allowInReview = false }) {
  const { visit, revision } = await loadWorking({ visitId, actorUserId });
  if (revision.status === "in_review" && !allowInReview) throw new AppError("Ritirare la richiesta di review prima di ricontrollare", 409);
  const [domainIntegrity, routeReview] = await Promise.all([
    computeVisitV2Integrity(revision.toObject()),
    projectVisitAuthoringRouteReview(revision.toObject()),
  ]);
  const routeIssues = [
    ...(routeReview.blockers || []).map((entry) => routeIssue(entry)),
    ...(routeReview.warnings || []).map((entry) => routeIssue(entry)),
  ];
  const issues = mergeIssues(domainIntegrity.issues || [], routeIssues);
  const blocking = issues.some((entry) => entry.severity !== "warning");
  revision.integrity = {
    status: blocking ? "needs_review" : "valid",
    issues,
    checkedAt: new Date(),
    checkedBy: actorUserId,
  };
  revision.updatedBy = actorUserId;
  await revision.save();
  return { visit, revision, ...domainIntegrity, issues, routeReview };
}

async function requestVisitV2Review({ visitId, actorUserId }) {
  const consistency = await evaluateVisitV2Consistency({ visitId, actorUserId });
  if (consistency.visit.ownerType !== "organization") throw new AppError("Le Visit personali non richiedono review manageriale", 409);
  if (consistency.issues.some((entry) => entry.severity !== "warning")) throw new AppError("La Visit contiene problemi bloccanti", 409, consistency.issues);
  try { requestReview(consistency.revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await consistency.revision.save();
  return consistency;
}

async function withdrawVisitV2Review({ visitId, actorUserId }) {
  const { visit, revision } = await loadWorking({ visitId, actorUserId });
  if (visit.ownerType !== "organization") throw new AppError("Operazione non applicabile a una Visit personale", 409);
  try { withdrawReview(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { visit, revision };
}

async function requestVisitV2Changes({ visitId, actorUserId, message }) {
  const { visit, revision } = await loadWorking({ visitId, actorUserId, permissionCode: "visit.review" });
  if (visit.ownerType !== "organization") throw new AppError("Operazione non applicabile a una Visit personale", 409);
  try { requestChanges(revision, actorUserId, message); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  await revision.save();
  return { visit, revision };
}

async function compensatePublish({ visit, revision, previousPublishedId, previousRevisionState, previousSuperseded }) {
  const pointer = await VisitV2.updateOne(
    { _id: visit._id, publishedRevisionId: revision._id, workingRevisionId: null },
    { $set: { publishedRevisionId: previousPublishedId || null, workingRevisionId: revision._id } },
  );
  await VisitRevisionV2.updateOne({ _id: revision._id }, { $set: previousRevisionState });
  let previous = { modifiedCount: 1 };
  if (previousPublishedId && previousSuperseded) previous = await VisitRevisionV2.updateOne({ _id: previousPublishedId, status: "superseded" }, { $set: { status: "published" } });
  if (pointer.modifiedCount !== 1 || previous.modifiedCount !== 1) throw new AppError("Rollback pubblicazione Visit v2 incompleto", 500, [{ code: "VISIT_V2_PUBLISH_ROLLBACK_FAILED" }]);
}

async function publishVisitV2({ visitId, actorUserId }) {
  const initialVisit = await findVisitV2OrFail(visitId);
  await assertCanManageVisitV2({
    visit: initialVisit,
    actorUserId,
    permissionCode: "visit.publish",
  });
  const consistency = await evaluateVisitV2Consistency({ visitId, actorUserId, allowInReview: true });
  const { visit, revision, issues } = consistency;
  if (issues.some((entry) => entry.severity !== "warning")) throw new AppError("Impossibile pubblicare una Visit con problemi di integrita", 409, issues);

  const previousPublishedId = visit.publishedRevisionId;
  const previousRevisionState = {
    status: revision.status,
    review: revision.review?.toObject ? revision.review.toObject() : revision.review,
    publication: revision.publication?.toObject ? revision.publication.toObject() : revision.publication,
  };
  try {
    if (visit.ownerType === "organization") approveReviewAndPublish(revision, actorUserId);
    else publishWithoutReview(revision, actorUserId);
  } catch (error) {
    throw new AppError(error.message, 409, [{ code: error.code }]);
  }
  await revision.save();
  let pointerSwitched = false;
  let previousSuperseded = false;
  try {
    const pointer = await VisitV2.updateOne(
      { _id: visit._id, workingRevisionId: revision._id, lifecycleStatus: "active" },
      { $set: { publishedRevisionId: revision._id, workingRevisionId: null } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La working VisitRevision e cambiata durante la pubblicazione", 409);
    pointerSwitched = true;
    if (previousPublishedId) {
      const previous = await VisitRevisionV2.updateOne({ _id: previousPublishedId, status: "published" }, { $set: { status: "superseded" } });
      if (previous.modifiedCount !== 1) throw new Error("Impossibile supersedere la VisitRevision precedente");
      previousSuperseded = true;
    }
  } catch (error) {
    if (pointerSwitched) await compensatePublish({ visit, revision, previousPublishedId, previousRevisionState, previousSuperseded });
    else await VisitRevisionV2.updateOne({ _id: revision._id }, { $set: previousRevisionState }).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError("Pubblicazione Visit v2 annullata", 500, [{ code: "VISIT_V2_PUBLISH_FAILED", message: error.message }]);
  }
  visit.publishedRevisionId = revision._id;
  visit.workingRevisionId = null;
  return { visit, revision };
}

module.exports = {
  evaluateVisitV2Consistency,
  requestVisitV2Review,
  withdrawVisitV2Review,
  requestVisitV2Changes,
  publishVisitV2,
};