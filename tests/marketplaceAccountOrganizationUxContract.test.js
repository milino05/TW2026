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
  resourceCreate: "clients/marketplace/src/ui/resource-create-dialog.js",
  organizationDialogs: "clients/marketplace/src/ui/organization-management-dialogs.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const profile = read("profile");
const organization = read("organization");
const publicOrganization = read("publicOrganization");
const contextHub = read("contextHub");
const resourceCreate = read("resourceCreate");
const organizationDialogs = read("organizationDialogs");

test("Account, Organization management e profilo pubblico passano il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("Account e Organization condividono la stessa grammatica di management", () => {
  for (const token of ["organization-page", "organization-header", "organization-tabs", "organization-section", "organization-overview"]) {
    assert.match(profile, new RegExp(token));
    assert.match(organization, new RegExp(token));
  }
  assert.match(profile, /Account ArtAround/);
  assert.match(profile, /Preferenze visita/);
  assert.match(profile, /Organizzazioni/);
  assert.match(profile, /Regole editoriali/);
  assert.match(profile, /Vocabolari fisici/);
});

test("le sezioni Account usano lo stesso modello a tab della gestione Organization", () => {
  for (const section of ["account-overview", "account-preferences", "account-organizations", "account-rules", "account-physical"]) {
    assert.match(profile, new RegExp(`data-account-section=\\"\\$\\{section\\.code\\}\\"|${section}`));
  }
  assert.match(profile, /setSection\(section\)/);
  assert.match(profile, /renderCurrentSection\(\)/);
  assert.match(profile, /pushSameDocumentHistory\(nextUrl\)/);
  assert.doesNotMatch(profile, /window\.history\.pushState/);
  assert.match(profile, /accountSectionFromHash/);
});

test("la sezione Organizzazioni dell'account è informativa e obbliga al cambio area", () => {
  assert.match(profile, /Cambia o crea area/);
  assert.match(profile, /data-context-hub/);
  assert.match(profile, /non modificare dati dell'organizzazione mentre sei nell'area personale/);
  assert.doesNotMatch(profile, /data-organization=/);
  assert.doesNotMatch(profile, /data-organization-section=/);
  assert.doesNotMatch(profile, /organizationUrl\(/);
});

test("la creazione Organization è centralizzata nel Context Hub", () => {
  assert.doesNotMatch(profile, /data-create-organization/);
  assert.match(profile, /data-context-hub/);
  assert.match(contextHub, /data-create-organization/);
  assert.match(contextHub, /accountRepository\.createOrganization/);
});

test("Organization management è deep-linkabile e capability-adaptive", () => {
  assert.match(organization, /new Set\(\["overview", "people", "roles", "venues", "rules", "physical", "settings"\]\)/);
  assert.match(organization, /sectionRoute/);
  assert.match(organization, /availableSections/);
  for (const label of ["Panoramica", "Persone", "Ruoli", "Sedi", "Regole editoriali", "Impostazioni"]) assert.match(organization, new RegExp(label));
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
  for (const operation of ["organization.member.roles.update", "organization.member.remove", "organization.member.add", "organization.owner.grant", "organization.role.update", "venue.create", "namespace.create"]) {
    assert.match(organization, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(organization, /actorRole|organizationCreatedBy|isManager\s*=/);
});

test("operazioni sensibili Organization usano Action Dialog globale e non conferme inline o native", () => {
  assert.match(organization, /openActionDialog/);
  assert.match(organization, /confirmSensitiveAction/);
  assert.match(organization, /member\.remove/);
  assert.match(organization, /owner\.grant/);
  assert.match(organization, /owner\.revoke/);
  assert.match(organization, /role\.remove/);
  assert.doesNotMatch(organization, /confirmation-panel|data-confirm-action|data-confirm-cancel/);
  assert.doesNotMatch(organization, /window\.confirm|window\.prompt/);
});

test("Sedi e Regole editoriali restano domini distinti e usano gli editor esistenti", () => {
  assert.match(organization, /\/venues\/editor\?venueId=/);
  assert.match(organization, /\/namespaces\/editor\?namespaceId=/);
  assert.match(organization, /artaround-venue-create-dialog/);
  assert.doesNotMatch(organization, /data-create-venue/);
  assert.match(organization, /data-create-namespace-open/);
});

test("Namespace e Physical Vocabulary usano il creator condiviso e aprono subito l'editor della risorsa creata", () => {
  for (const source of [profile, organization]) {
    assert.match(source, /openResourceCreateDialog/);
    assert.match(source, /onCreated:\s*\(\{ id: createdId \}\)\s*=>/);
    assert.match(source, /\/namespaces\/editor\?namespaceId=/);
    assert.match(source, /\/physical-vocabularies\/editor\?physicalVocabularyId=/);
  }
  assert.match(resourceCreate, /Crea e configura/);
  assert.match(resourceCreate, /accountRepository\.createNamespace/);
  assert.match(resourceCreate, /accountRepository\.createPhysicalVocabulary/);
  assert.match(resourceCreate, /onCreated\?\.\(\{ id: resourceId, resource, response: created \}\)/);
});

test("la UI distingue ruoli multipli, Owner e permission builder", () => {
  assert.match(organization, /roleNames/);
  assert.match(organization, /owner-badge/);
  assert.match(organization, /permissionCodes/);
  assert.match(organizationDialogs, /permissionCatalog/);
  assert.match(organizationDialogs, /Impatto elevato/);
  assert.match(organizationDialogs, /openOrganizationRoleDialog/);
  assert.doesNotMatch(organization, /operator|actorRole|isManager/);
});
