const test = require("node:test");
const assert = require("node:assert/strict");
const { projectEditorialWorkflowOperations } = require("../services/editorialWorkflowOperationsV2.service");

function revision(status, integrityStatus = "valid") {
  return { status, integrity: { status: integrityStatus } };
}

function codes(input) {
  return projectEditorialWorkflowOperations(input).map((entry) => entry.code);
}

test("una revisione personale draft valida espone publish diretto senza review", () => {
  assert.deepEqual(codes({ ownerType: "user", actorRole: "owner", revision: revision("draft") }), [
    "workflow.check",
    "workflow.publish",
  ]);
});

test("una revisione personale non integra non espone publish", () => {
  assert.deepEqual(codes({ ownerType: "user", actorRole: "owner", revision: revision("draft", "needs_review") }), [
    "workflow.check",
  ]);
});

test("un operator Organization puo inviare in review ma non pubblicare un draft", () => {
  assert.deepEqual(codes({ ownerType: "organization", actorRole: "operator", revision: revision("draft") }), [
    "workflow.check",
    "workflow.request_review",
  ]);
});

test("neppure un manager Organization puo saltare draft -> in_review", () => {
  assert.deepEqual(codes({ ownerType: "organization", actorRole: "manager", revision: revision("draft") }), [
    "workflow.check",
    "workflow.request_review",
  ]);
});

test("un manager Organization in_review riceve decisione e publication operations", () => {
  const operations = projectEditorialWorkflowOperations({
    ownerType: "organization",
    actorRole: "manager",
    revision: revision("in_review"),
  });
  assert.deepEqual(operations.map((entry) => entry.code), [
    "workflow.withdraw_review",
    "workflow.request_changes",
    "workflow.publish",
  ]);
  assert.equal(operations.find((entry) => entry.code === "workflow.request_changes").requiresMessage, true);
});

test("un operator Organization in_review non riceve decisioni manageriali", () => {
  assert.deepEqual(codes({ ownerType: "organization", actorRole: "operator", revision: revision("in_review") }), [
    "workflow.withdraw_review",
  ]);
});
