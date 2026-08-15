const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isEditableRevision,
  markRevisionEdited,
  requestReview,
  withdrawReview,
  requestChanges,
  markPublished,
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

test("una revisione in_review integra puo essere pubblicata", () => {
  const revision = draft();
  requestReview(revision, "operator");
  markPublished(revision, "manager", new Date("2026-08-01T12:00:00Z"));
  assert.equal(revision.status, "published");
  assert.equal(revision.review.decision, "approved");
  assert.equal(revision.publication.publishedBy, "manager");
});

test("un manager puo pubblicare direttamente un proprio draft integro", () => {
  const revision = draft();
  markPublished(revision, "manager");
  assert.equal(revision.status, "published");
});
