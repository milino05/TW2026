const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isEditableRevision,
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  publishWithoutReview,
  approveReviewAndPublish,
} = require("../services/revisionWorkflow.service");

function draft() {
  return {
    status: "draft",
    integrity: { status: "valid", issues: [] },
    review: {},
    publication: {},
  };
}

test("una revisione valida passa da draft a in_review", () => {
  const revision = draft();
  requestReview(revision, "operator", new Date("2026-08-01T10:00:00Z"));
  assert.equal(revision.status, "in_review");
  assert.equal(revision.review.decision, "pending");
  assert.equal(revision.review.events[0].action, "review_requested");
  assert.equal(isEditableRevision(revision), false);
});

test("un manager puo richiedere modifiche con motivazione", () => {
  const revision = draft();
  requestReview(revision, "operator");
  requestChanges(revision, "manager", "Correggere la licenza");
  assert.equal(revision.status, "changes_requested");
  assert.equal(revision.review.message, "Correggere la licenza");
  assert.deepEqual(
    revision.review.events.map((event) => event.action),
    ["review_requested", "changes_requested"],
  );
  markRevisionEdited(revision, "operator");
  assert.equal(revision.status, "draft");
  assert.equal(revision.integrity.status, "needs_review");
});

test("la richiesta puo essere ritirata dall'editor", () => {
  const revision = draft();
  requestReview(revision, "operator");
  withdrawReview(revision, "operator");
  assert.equal(revision.status, "draft");
});

test("una revisione in_review integra puo essere approvata e pubblicata", () => {
  const revision = draft();
  requestReview(revision, "operator");
  approveReviewAndPublish(revision, "manager", new Date("2026-08-01T12:00:00Z"));
  assert.equal(revision.status, "published");
  assert.equal(revision.review.decision, "approved");
  assert.equal(revision.publication.publishedBy, "manager");
});

test("la pubblicazione diretta di un draft personale non crea una review fittizia", () => {
  const revision = draft();
  publishWithoutReview(revision, "author", new Date("2026-08-01T12:00:00Z"));
  assert.equal(revision.status, "published");
  assert.equal(revision.review.decision, undefined);
  assert.equal(revision.review.reviewedAt, undefined);
  assert.equal(revision.review.events, undefined);
  assert.equal(revision.publication.publishedBy, "author");
});

test("approvazione manageriale non puo saltare draft -> in_review", () => {
  const revision = draft();
  assert.throws(
    () => approveReviewAndPublish(revision, "manager"),
    (error) => error?.code === "INVALID_APPROVAL_PUBLISH_TRANSITION",
  );
  assert.equal(revision.status, "draft");
});

test("la pubblicazione diretta non puo aggirare una review gia avviata", () => {
  const revision = draft();
  requestReview(revision, "operator");
  assert.throws(
    () => publishWithoutReview(revision, "author"),
    (error) => error?.code === "INVALID_DIRECT_PUBLISH_TRANSITION",
  );
  assert.equal(revision.status, "in_review");
});
