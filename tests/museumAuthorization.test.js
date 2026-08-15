const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getMuseumMembership,
  hasMuseumRole,
} = require("../services/museumAuthorization.service");

const museumId = "64b64b64b64b64b64b64b64b";

const operator = {
  memberships: [{ museumId, role: "operator" }],
};

const manager = {
  memberships: [{ museumId, role: "manager" }],
};

test("operator soddisfa il requisito operator ma non manager", () => {
  assert.equal(hasMuseumRole(operator, museumId, "operator"), true);
  assert.equal(hasMuseumRole(operator, museumId, "manager"), false);
});

test("manager eredita i privilegi dell operator", () => {
  assert.equal(hasMuseumRole(manager, museumId, "operator"), true);
  assert.equal(hasMuseumRole(manager, museumId, "manager"), true);
});

test("una membership vale soltanto per il museo corrispondente", () => {
  const otherMuseumId = "74b74b74b74b74b74b74b74b";

  assert.equal(hasMuseumRole(manager, otherMuseumId, "operator"), false);
  assert.equal(getMuseumMembership(manager, otherMuseumId), null);
});
