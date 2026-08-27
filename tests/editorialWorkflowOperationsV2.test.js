const test = require("node:test");
const assert = require("node:assert/strict");
const { projectEditorialWorkflowOperations } = require("../services/editorialWorkflowOperationsV2.service");

function revision(status, integrityStatus = "valid") { return { status, integrity: { status: integrityStatus } }; }
function codes(input) { return projectEditorialWorkflowOperations(input).map((entry) => entry.code); }

test("una revisione personale valida espone la pubblicazione diretta", () => {
  assert.deepEqual(codes({ ownerType: "user", revision: revision("draft") }), ["workflow.check", "workflow.publish"]);
});

test("il flusso contenuti che finalizza come privato espone soltanto il controllo", () => {
  assert.deepEqual(codes({ ownerType: "user", revision: revision("draft"), finalizePrivatelyOnCheck: true }), ["workflow.check"]);
  assert.deepEqual(codes({
    ownerType: "organization",
    capabilities: { edit: true, review: true, publish: true },
    revision: revision("draft"),
    finalizePrivatelyOnCheck: true,
  }), ["workflow.check"]);
  assert.deepEqual(codes({ ownerType: "user", revision: revision("published"), finalizePrivatelyOnCheck: true }), []);
});

test("un editor Organization può inviare in review senza poter pubblicare", () => {
  assert.deepEqual(codes({ ownerType: "organization", capabilities: { edit: true }, revision: revision("draft") }), ["workflow.check", "workflow.request_review"]);
});

test("review e publish sono capability indipendenti", () => {
  const operations = projectEditorialWorkflowOperations({ ownerType: "organization", capabilities: { edit: true, review: true, publish: true }, revision: revision("in_review") });
  assert.deepEqual(operations.map((entry) => entry.code), ["workflow.withdraw_review", "workflow.request_changes", "workflow.publish"]);
  assert.equal(operations.find((entry) => entry.code === "workflow.request_changes").requiresMessage, true);
  assert.deepEqual(codes({ ownerType: "organization", capabilities: { publish: true }, revision: revision("in_review") }), ["workflow.publish"]);
});

test("senza capability la proiezione non espone operazioni editoriali", () => {
  assert.deepEqual(codes({ ownerType: "organization", capabilities: {}, revision: revision("draft") }), []);
});
