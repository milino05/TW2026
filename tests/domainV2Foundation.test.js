const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const OrganizationMembership = require("../models/organizationMembership.model");
const { effectivePermissionsForMembership } = require("../services/organizationAuthorization.service");
const { permissionClosure, STARTER_ROLES } = require("../services/organizationPermissionRegistry.service");
const { userCanActForOwner } = require("../services/resourceOwnership.service");
const { normalizeOrganizationPayload, validateOrganizationPayload } = require("../services/validation/organization.validation");
const { normalizeSubjectPayload, validateSubjectPayload } = require("../services/validation/subject.validation");

const userId = "64b64b64b64b64b64b64b64b";
const organizationId = "74b74b74b74b74b74b74b74b";

test("i permessi effettivi sono l'unione dei ruoli e includono i prerequisiti", () => {
  const membership = { roleAssignments: [
    { roleId: { permissionCodes: ["item.edit"] } },
    { roleId: { permissionCodes: ["visit.publish"] } },
  ] };
  assert.deepEqual(effectivePermissionsForMembership(membership), ["item.edit", "item.view", "visit.publish", "visit.view"]);
  assert.deepEqual(permissionClosure(["organization.roles.assign"]), ["organization.members.view", "organization.roles.assign", "organization.roles.view"]);
});

test("i sei ruoli iniziali coprono le matrici approvate", () => {
  assert.deepEqual(STARTER_ROLES.map((role) => role.name), ["Administrator", "Curator", "Contributor", "Venue Manager", "Marketplace Manager", "Viewer"]);
  assert.ok(STARTER_ROLES.find((role) => role.key === "administrator").permissionCodes.includes("organization.roles.manage"));
  assert.equal(STARTER_ROLES.find((role) => role.key === "venue_manager").permissionCodes.every((code) => code.startsWith("venue.") || code.startsWith("physical_vocabulary.")), true);
  assert.ok(STARTER_ROLES.find((role) => role.key === "venue_manager").permissionCodes.includes("physical_vocabulary.publish"));
});

test("l'ownership personale resta distinta dall'autorità Organization", () => {
  const user = { _id: userId };
  assert.equal(userCanActForOwner(user, { ownerType: "user", ownerId: userId }), true);
  assert.equal(userCanActForOwner(user, { ownerType: "user", ownerId: organizationId }), false);
  assert.equal(userCanActForOwner(user, { ownerType: "organization", ownerId: organizationId }), false);
});

test("organization payload normalization is strict and predictable", () => {
  const raw = { name: "  Universita  ", description: "  Ricerca  " };
  const normalized = normalizeOrganizationPayload(raw);
  assert.deepEqual(normalized, { name: "Universita", description: "Ricerca" });
  assert.deepEqual(validateOrganizationPayload({ payload: normalized, rawPayload: raw, mode: "create" }), []);
  assert.ok(validateOrganizationPayload({ payload: {}, rawPayload: {}, mode: "create" }).some((issue) => issue.code === "REQUIRED"));
});

test("Subject locale rejects identity bindings outside the verified resolver command", () => {
  const raw = { preferredLabel: "  Parmigianino  ", description: "  Pittore  " };
  const normalized = normalizeSubjectPayload(raw);
  assert.equal(normalized.preferredLabel, "Parmigianino");
  assert.deepEqual(validateSubjectPayload({ payload: normalized, rawPayload: raw, mode: "create" }), []);
  const forbidden = validateSubjectPayload({ payload: normalizeSubjectPayload({ preferredLabel: "X", externalIdentities: [{ scheme: "wikidata", id: "Q1" }] }), rawPayload: { preferredLabel: "X", externalIdentities: [{ scheme: "wikidata", id: "Q1" }] }, mode: "create" });
  assert.ok(forbidden.some((issue) => issue.code === "UNKNOWN_FIELD" && issue.field === "externalIdentities"));
});

test("una membership attiva richiede almeno un ruolo e rifiuta duplicati", async () => {
  const actor = new mongoose.Types.ObjectId();
  const roleId = new mongoose.Types.ObjectId();
  const empty = new OrganizationMembership({ organizationId, userId, roleAssignments: [], createdBy: actor, updatedBy: actor });
  await assert.rejects(() => empty.validate(), (error) => Boolean(error?.errors?.roleAssignments));
  const duplicate = new OrganizationMembership({ organizationId, userId, roleAssignments: [
    { roleId, assignedBy: actor }, { roleId, assignedBy: actor },
  ], createdBy: actor, updatedBy: actor });
  await assert.rejects(() => duplicate.validate(), (error) => Boolean(error?.errors?.roleAssignments));
});
