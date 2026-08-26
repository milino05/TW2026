const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  profile: "clients/marketplace/src/ui/profile-view.js",
  organization: "clients/marketplace/src/ui/organization-view.js",
  publicOrganization: "clients/marketplace/src/ui/public-organization-view.js",
  contextHub: "clients/marketplace/src/ui/context-hub-view.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const profile = read("profile");
const organization = read("organization");
const publicOrganization = read("publicOrganization");
const contextHub = read("contextHub");

test("Account, Organization management e profilo pubblico passano il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Account usa IA user-facing per preferenze e strumenti personali", () => {
  assert.match(profile, /Account ArtAround/);
  assert.match(profile, /Preferenze visita/);
  assert.match(profile, /Organizzazioni/);
  assert.match(profile, /Regole editoriali personali/);
  assert.match(profile, /data-organization-section="venues"/);
  assert.match(profile, /data-organization-section="rules"/);
});

test("le scorciatoie Account navigano alle sezioni e mantengono il deep link", () => {
  for (const section of ["account-overview", "account-preferences", "account-organizations", "account-rules"]) {
    assert.match(profile, new RegExp(`data-account-section="${section}"`));
    assert.match(profile, new RegExp(`id="${section}" tabindex="-1"`));
  }
  assert.match(profile, /event\.preventDefault\(\);[\s\S]*?scrollToSection\(accountSection\.dataset\.accountSection/);
  assert.match(profile, /window\.history\.pushState/);
  assert.match(profile, /section\.scrollIntoView\(\{ behavior, block: "start" \}\)/);
  assert.match(profile, /section\.focus\(\{ preventScroll: true \}\)/);
  assert.match(profile, /accountSectionFromHash/);
});

test("la creazione Organization è centralizzata nel Context Hub", () => {
  assert.doesNotMatch(profile, /data-create-organization/);
  assert.match(profile, /data-context-hub/);
  assert.match(contextHub, /data-create-organization/);
  assert.match(contextHub, /accountRepository\.createOrganization/);
});

test("Organization management è deep-linkabile per Panoramica, Persone, Sedi e Regole", () => {
  assert.match(organization, /new Set\(\["overview", "people", "venues", "rules"\]\)/);
  assert.match(organization, /sectionRoute/);
  for (const label of ["Panoramica", "Persone", "Sedi", "Regole editoriali"]) assert.match(organization, new RegExp(label));
});

test("profilo pubblico e console di gestione sono responsabilità distinte", () => {
  assert.match(organization, /Gestione organizzazione/);
  assert.match(organization, /data-public-profile/);
  assert.match(organization, /\/organizations\/public\?organizationId=/);
  assert.match(publicOrganization, /Organizzazione/);
  assert.match(publicOrganization, /Pubblicazioni dell'organizzazione/);
  assert.doesNotMatch(publicOrganization, /organization\.member\.add|data-add-member|data-create-venue/);
});

test("ruoli e membership restano backend-authoritative", () => {
  for (const operation of ["organization.member.promote", "organization.member.demote", "organization.member.remove", "organization.member.add", "venue.create", "namespace.create"]) {
    assert.match(organization, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(organization, /actorRole|organizationCreatedBy|isManager\s*=/);
});

test("rimozione membro usa conferma inline e non dialoghi nativi", () => {
  assert.match(organization, /memberRemoval/);
  assert.match(organization, /data-confirm-member-remove/);
  assert.match(organization, /data-cancel-member-remove/);
  assert.doesNotMatch(organization, /window\.confirm|window\.prompt/);
});

test("Sedi e Regole editoriali restano domini distinti e usano gli editor esistenti", () => {
  assert.match(organization, /\/venues\/editor\?venueId=/);
  assert.match(organization, /\/namespaces\/editor\?namespaceId=/);
  assert.match(organization, /data-create-venue/);
  assert.match(organization, /data-create-namespace/);
});

test("dopo la creazione delle regole si entra subito nell'editor guidato", () => {
  for (const source of [profile, organization]) {
    assert.match(source, /const created = await this\.execute/);
    assert.match(source, /created\?\.namespace\?\._id/);
    assert.match(source, /\/namespaces\/editor\?namespaceId=/);
    assert.match(source, /Crea e configura/);
    assert.match(source, /tutorial e un modello già pronto facoltativo/);
  }
});
