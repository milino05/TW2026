const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);

function isEditableRevision(revision) {
  return Boolean(revision && EDITABLE_STATUSES.has(revision.status));
}

function markRevisionEdited(revision, actorUserId) {
  if (!isEditableRevision(revision)) {
    const error = new Error("La revisione non e modificabile nello stato corrente");
    error.code = "REVISION_NOT_EDITABLE";
    throw error;
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
    const error = new Error("Solo una revisione draft puo essere inviata in revisione");
    error.code = "INVALID_REVIEW_TRANSITION";
    throw error;
  }
  if (revision.integrity?.status !== "valid") {
    const error = new Error("La revisione deve superare il controllo di consistenza");
    error.code = "INTEGRITY_REQUIRED";
    throw error;
  }
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

function withdrawReview(revision, actorUserId) {
  if (revision.status !== "in_review") {
    const error = new Error("La revisione non e attualmente in revisione");
    error.code = "INVALID_REVIEW_TRANSITION";
    throw error;
  }
  revision.status = "draft";
  revision.updatedBy = actorUserId;
  revision.review.decision = null;
  revision.review.message = null;
  appendReviewEvent(revision, "review_withdrawn", actorUserId, new Date());
  return revision;
}

function requestChanges(revision, managerUserId, message, now = new Date()) {
  if (revision.status !== "in_review") {
    const error = new Error("Solo una revisione in_review puo ricevere una decisione");
    error.code = "INVALID_REVIEW_TRANSITION";
    throw error;
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    const error = new Error("La motivazione delle modifiche richieste e obbligatoria");
    error.code = "REVIEW_MESSAGE_REQUIRED";
    throw error;
  }
  revision.status = "changes_requested";
  revision.review.reviewedAt = now;
  revision.review.reviewedBy = managerUserId;
  revision.review.decision = "changes_requested";
  revision.review.message = message.trim();
  appendReviewEvent(revision, "changes_requested", managerUserId, now, message.trim());
  return revision;
}

function markPublished(revision, managerUserId, now = new Date()) {
  if (!["in_review", "draft"].includes(revision.status)) {
    const error = new Error("La revisione non puo essere pubblicata nello stato corrente");
    error.code = "INVALID_PUBLISH_TRANSITION";
    throw error;
  }
  if (revision.integrity?.status !== "valid") {
    const error = new Error("La revisione deve essere integra prima della pubblicazione");
    error.code = "INTEGRITY_REQUIRED";
    throw error;
  }
  revision.status = "published";
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
  markPublished,
};
