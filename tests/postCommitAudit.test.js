const test = require("node:test");
const assert = require("node:assert/strict");
const { runPostCommitAudit } = require("../services/postCommitAudit.service");

test("post-commit audit reports complete results without changing commit semantics", async () => {
  const result = await runPostCommitAudit({ first: async () => ({ count: 2 }), second: async () => "ok" });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.results, { first: { count: 2 }, second: "ok" });
  assert.deepEqual(result.failures, []);
});

test("post-commit audit isolates failures and continues remaining tasks", async () => {
  let ranAfterFailure = false;
  const result = await runPostCommitAudit({
    broken: async () => { throw new Error("audit failed"); },
    later: async () => { ranAfterFailure = true; return 3; },
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.results.broken, null);
  assert.equal(result.results.later, 3);
  assert.equal(ranAfterFailure, true);
  assert.deepEqual(result.failures, [{ name: "broken", message: "audit failed" }]);
});
