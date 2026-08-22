const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);

function workflowError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isEditableRevision(revision) {
  return Boolean(revision && EDITABLE_STATUSES.has(revision.status));
}

function assertIntegrityValid(revision) {
  if (revision.integrity?.status !== "valid") {
    throw workflowError("La revisione deve essere integra prima della pubblicazione", "INTEGRITY_REQUIRED");
  }
}

function markRevisionEdited(revision, actorUserId) {
  if (!isEditableRevision(revision)) {
    throw workflowError("La revisione non e modificabile nello stato corrente", "REVISION_NOT_EDITABLE");
  }
  if (revision.status === "changes_requested") revision.status = "draft";
  revision.updatedBy = actorUserId;
  revision.integrity = {
    status: "needs_review",
    issues: [],
    checkedAt: null,
    checkedBy: null,
  };
  return revision;
}

function appendReviewEvent(revision, action, actorUserId, now, message = null) {
  if (!revision.review) revision.review = {};
  if (!Array.isArray(revision.review.events)) revision.review.events = [];
  revision.review.events.push({ action, actorUserId, at: now, message });
}

function requestReview(revision, actorUserId, now = new Date()) {
  if (revision.status !== "draft") {
    throw workflowError("Solo una revisione draft puo essere inviata in revisione", "INVALID_REVIEW_TRANSITION");
  }
  assertIntegrityValid(revision);
  revision.status = "in_review";
  const events = Array.isArray(revision.review?.events) ? revision.review.events : [];
  revision.review = {
    requestedAt: now,
    requestedBy: actorUserId,
    reviewedAt: null,
    reviewedBy: null,
    decision: "pending",
    message: null,
    events,
  };
  appendReviewEvent(revision, "review_requested", actorUserId, now);
  return revision;
}

function withdrawReview(revision, actorUserId, now = new Date()) {
  if (revision.status !== "in_review") {
    throw workflowError("La revisione non e attualmente in revisione", "INVALID_REVIEW_TRANSITION");
  }
  revision.status = "draft";
  revision.updatedBy = actorUserId;
  revision.review.decision = null;
  revision.review.message = null;
  appendReviewEvent(revision, "review_withdrawn", actorUserId, now);
  return revision;
}

function requestChanges(revision, managerUserId, message, now = new Date()) {
  if (revision.status !== "in_review") {
    throw workflowError("Solo una revisione in_review puo ricevere una decisione", "INVALID_REVIEW_TRANSITION");
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    throw workflowError("La motivazione delle modifiche richieste e obbligatoria", "REVIEW_MESSAGE_REQUIRED");
  }
  revision.status = "changes_requested";
  revision.review.reviewedAt = now;
  revision.review.reviewedBy = managerUserId;
  revision.review.decision = "changes_requested";
  revision.review.message = message.trim();
  appendReviewEvent(revision, "changes_requested", managerUserId, now, message.trim());
  return revision;
}

function publishWithoutReview(revision, actorUserId, now = new Date()) {
  if (revision.status !== "draft") {
    throw workflowError("La pubblicazione diretta richiede una revisione draft", "INVALID_DIRECT_PUBLISH_TRANSITION");
  }
  assertIntegrityValid(revision);
  revision.status = "published";
  revision.publication = { publishedAt: now, publishedBy: actorUserId };
  return revision;
}

function approveReviewAndPublish(revision, managerUserId, now = new Date()) {
  if (revision.status !== "in_review") {
    throw workflowError("La pubblicazione manageriale richiede una revisione in_review", "INVALID_APPROVAL_PUBLISH_TRANSITION");
  }
  assertIntegrityValid(revision);
  revision.status = "published";
  if (!revision.review) revision.review = {};
  revision.review.reviewedAt = now;
  revision.review.reviewedBy = managerUserId;
  revision.review.decision = "approved";
  revision.review.message = null;
  appendReviewEvent(revision, "published", managerUserId, now);
  revision.publication = { publishedAt: now, publishedBy: managerUserId };
  return revision;
}

module.exports = {
  EDITABLE_STATUSES,
  isEditableRevision,
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  publishWithoutReview,
  approveReviewAndPublish,
};
