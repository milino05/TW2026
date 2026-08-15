const test = require("node:test");
const assert = require("node:assert/strict");
const { contributorHash } = require("../services/contributorIdentity.service");

test("contributor HMAC is stable and does not expose the user id", () => {
  const previous = process.env.ADAPTIVE_CONTRIBUTOR_SECRET;
  process.env.ADAPTIVE_CONTRIBUTOR_SECRET = "test-secret-long-enough-for-hmac";
  try {
    const first = contributorHash("user-123");
    const second = contributorHash("user-123");
    const other = contributorHash("user-456");
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(first.length, 64);
    assert.equal(first.includes("user-123"), false);
  } finally {
    if (previous === undefined) delete process.env.ADAPTIVE_CONTRIBUTOR_SECRET;
    else process.env.ADAPTIVE_CONTRIBUTOR_SECRET = previous;
  }
});

test("collective identity refuses to run without a configured secret", () => {
  const previous = process.env.ADAPTIVE_CONTRIBUTOR_SECRET;
  delete process.env.ADAPTIVE_CONTRIBUTOR_SECRET;
  try {
    assert.throws(() => contributorHash("user-123"), /ADAPTIVE_CONTRIBUTOR_SECRET/);
  } finally {
    if (previous !== undefined) process.env.ADAPTIVE_CONTRIBUTOR_SECRET = previous;
  }
});
