const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = { profile: "clients/marketplace/src/ui/profile-view.js", organization: "clients/marketplace/src/ui/organization-view.js" };
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const profile = read("profile");
const organization = read("organization");

test("Account e Organization passano il syntax gate", () => { for (const file of Object.values(files)) { const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" }); assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`); } });
test("Account usa IA user-facing e rende dirette Organizzazioni, Sedi e Regole editoriali", () => { assert.match(profile, /Account ArtAround/); assert.match(profile, /Preferenze visita/); assert.match(profile, /Organizzazioni/); assert.match(profile, /Regole editoriali personali/); assert.match(profile, /data-organization-section="venues"/); assert.match(profile, /data-organization-section="rules"/); assert.match(profile, /Modifica regole editoriali/); });
test("Organization è deep-linkabile per Panoramica, Persone, Sedi e Regole editoriali", () => { assert.match(organization, /new Set\(\["overview", "people", "venues", "rules"\]\)/); assert.match(organization, /sectionRoute/); assert.match(organization, /Panoramica/); assert.match(organization, /Persone/); assert.match(organization, /Sedi/); assert.match(organization, /Regole editoriali/); });
test("ruoli e membership restano backend-authoritative", () => { for (const operation of ["organization.member.promote", "organization.member.demote", "organization.member.remove", "organization.member.add", "venue.create", "namespace.create"]) assert.match(organization, new RegExp(operation.replaceAll(".", "\\."))); assert.doesNotMatch(organization, /actorRole|organizationCreatedBy|isManager\s*=/); });
test("rimozione membro usa conferma inline e non dialoghi nativi", () => { assert.match(organization, /memberRemoval/); assert.match(organization, /data-confirm-member-remove/); assert.match(organization, /data-cancel-member-remove/); assert.doesNotMatch(organization, /window\.confirm|window\.prompt/); });
test("Sedi e Regole editoriali restano domini distinti e usano gli editor esistenti", () => { assert.match(organization, /\/venues\/editor\?venueId=/); assert.match(organization, /\/namespaces\/editor\?namespaceId=/); assert.match(organization, /data-create-venue/); assert.match(organization, /data-create-namespace/); });
test("la slice riusa i boundary account e management esistenti", () => { assert.match(profile, /accountRepository\.workspace\(\)/); assert.match(organization, /managementRepository\.organization/); assert.match(organization, /accountRepository\.updateOrganizationMemberRole/); assert.match(organization, /accountRepository\.removeOrganizationMember/); assert.match(organization, /accountRepository\.createVenue/); assert.match(organization, /accountRepository\.createNamespace/); });
