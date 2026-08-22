const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../models/user");
const {
  getOrganizationMembership,
  hasOrganizationRole,
} = require("../services/organizationAuthorization.service");
const { userCanActForOwner } = require("../services/resourceOwnership.service");
const {
  normalizeOrganizationPayload,
  validateOrganizationPayload,
} = require("../services/validation/organization.validation");
const {
  normalizeSubjectPayload,
  validateSubjectPayload,
} = require("../services/validation/subject.validation");

const userId = "64b64b64b64b64b64b64b64b";
const organizationId = "74b74b74b74b74b74b74b74b";
const otherOrganizationId = "84b84b84b84b84b84b84b84b";

test("organization roles preserve operator/manager hierarchy", () => {
  const operator = { organizationMemberships: [{ organizationId, role: "operator" }] };
  const manager = { organizationMemberships: [{ organizationId, role: "manager" }] };

  assert.equal(hasOrganizationRole(operator, organizationId, "operator"), true);
  assert.equal(hasOrganizationRole(operator, organizationId, "manager"), false);
  assert.equal(hasOrganizationRole(manager, organizationId, "operator"), true);
  assert.equal(hasOrganizationRole(manager, organizationId, "manager"), true);
  assert.equal(getOrganizationMembership(manager, otherOrganizationId), null);
});

test("generic ownership distinguishes personal and organization authority", () => {
  const user = {
    _id: userId,
    organizationMemberships: [{ organizationId, role: "operator" }],
  };

  assert.equal(userCanActForOwner(user, { ownerType: "user", ownerId: userId }), true);
  assert.equal(userCanActForOwner(user, { ownerType: "user", ownerId: "94b94b94b94b94b94b94b94b" }), false);
  assert.equal(userCanActForOwner(user, { ownerType: "organization", ownerId: organizationId }), true);
  assert.equal(userCanActForOwner(user, { ownerType: "organization", ownerId: otherOrganizationId }), false);
});

test("organization payload normalization is strict and predictable", () => {
  const raw = { name: "  Universita  ", description: "  Ricerca  " };
  const normalized = normalizeOrganizationPayload(raw);
  assert.deepEqual(normalized, { name: "Universita", description: "Ricerca" });
  assert.deepEqual(validateOrganizationPayload({ payload: normalized, rawPayload: raw, mode: "create" }), []);
  assert.ok(validateOrganizationPayload({ payload: {}, rawPayload: {}, mode: "create" }).some((issue) => issue.code === "REQUIRED"));
  assert.ok(validateOrganizationPayload({
    payload: normalizeOrganizationPayload({ name: "Org", ownerId: "forbidden" }),
    rawPayload: { name: "Org", ownerId: "forbidden" },
    mode: "create",
  }).some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field === "ownerId"));
});

test("Subject external identities are normalized without fuzzy label merging", () => {
  const raw = {
    preferredLabel: "  Parmigianino  ",
    externalRefs: [{ scheme: " WIKIDATA ", id: " Q123 ", matchType: "EXACT" }],
  };
  const normalized = normalizeSubjectPayload(raw);

  assert.equal(normalized.preferredLabel, "Parmigianino");
  assert.deepEqual(normalized.externalRefs, [{ scheme: "wikidata", id: "Q123", matchType: "exact" }]);
  assert.deepEqual(validateSubjectPayload({ payload: normalized, rawPayload: raw, mode: "create" }), []);

  const duplicate = validateSubjectPayload({
    payload: {
      preferredLabel: "X",
      externalRefs: [
        { scheme: "wikidata", id: "Q1", matchType: "exact" },
        { scheme: "wikidata", id: "Q1", matchType: "close" },
      ],
    },
    rawPayload: {
      preferredLabel: "X",
      externalRefs: [
        { scheme: "wikidata", id: "Q1", matchType: "exact" },
        { scheme: "wikidata", id: "Q1", matchType: "close" },
      ],
    },
    mode: "create",
  });
  assert.ok(duplicate.some((issue) => issue.code === "DUPLICATE_EXTERNAL_REF"));

  const unknown = validateSubjectPayload({
    payload: normalizeSubjectPayload({ preferredLabel: "X", venueId: "forbidden" }),
    rawPayload: { preferredLabel: "X", venueId: "forbidden" },
    mode: "create",
  });
  assert.ok(unknown.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field === "venueId"));
});

test("User rejects duplicate Organization memberships independently from legacy museum memberships", async () => {
  const user = new User({
    username: "org-membership-validation",
    passwordHash: "test-hash",
    organizationMemberships: [
      { organizationId, role: "operator" },
      { organizationId, role: "manager" },
    ],
  });

  await assert.rejects(
    () => user.validate(),
    (error) => Boolean(error?.errors?.organizationMemberships),
  );
});
