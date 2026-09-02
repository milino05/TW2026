const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = {
  shell: "clients/marketplace/src/ui/app-shell.js",
  create: "clients/marketplace/src/ui/create-hub-view.js",
  item: "clients/marketplace/src/ui/item-authoring-view.js",
  visit: "clients/marketplace/src/ui/visit-authoring-view.js",
  collection: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  studio: "clients/marketplace/src/ui/editorial-studio-view.js",
  workspace: "clients/marketplace/src/ui/workspace-browser-view.js",
  editorialRepository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const shell = read("shell");
const create = read("create");
const item = read("item");
const visit = read("visit");
const collection = read("collection");
const studio = read("studio");
const workspace = read("workspace");
const editorialRepository = read("editorialRepository");

test("create boundary passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("shell espone Crea dentro la IA contestuale", () => {
  for (const label of ["Home", "Esplora", "Libreria", "Crea", "Attività"]) assert.match(shell, new RegExp(`>${label}<`));
  assert.match(shell, /class="nav-create"/);
  assert.match(shell, /authoringIsCreation/);
  assert.doesNotMatch(shell, /venue-target-chooser|\/workspace\/venue-targets|context-release-composer|\/workspace\/context-compose/);
});

test("Create Hub deriva il principal dal contesto operativo e non lo serializza nei link principali", () => {
  assert.match(create, /readOperatingContext/);
  assert.match(create, /operatingPrincipal/);
  assert.match(create, /this\.principal\(\)/);
  assert.match(create, /marketplaceRepository\.workspaceContext\(principal\)/);
  assert.match(create, /marketplaceRepository\.authoringPreflight\(principal\)/);
  assert.doesNotMatch(create, /data-principal-form/);
});

test("Create Hub presenta Contenuto, Visita e Collega soggetti senza creare Raccolte dal menu Crea", () => {
  assert.match(create, /capabilities\?\.contentCreate/);
  assert.match(create, /capabilities\?\.visitCreate/);
  assert.match(create, /capabilities\?\.semanticGraphEdit/);
  assert.match(create, /Crea un contenuto/);
  assert.match(create, /Progetta una visita/);
  assert.match(create, /Collega soggetti/);
  assert.match(create, /\/workspace\/item-authoring/);
  assert.match(create, /\/workspace\/visit-authoring/);
  assert.match(create, /\/create\?mode=relations/);
  assert.doesNotMatch(create, /\/workspace\/editorial-collection-new/);
});

test("Collega soggetti seleziona una Raccolta modificabile e apre direttamente Relazioni", () => {
  assert.match(create, /editorialRepository\.relationChoices/);
  assert.match(create, /ownerType: this\.context\.type/);
  assert.match(create, /ownerId: this\.context\.id/);
  assert.match(create, /Scegli la raccolta/);
  assert.match(create, /semanticGraph\.sharedByCollections/);
  assert.match(create, /section=relations/);
  assert.match(editorialRepository, /\/v2\/marketplace\/editorial-relations/);
});

test("la creazione del contenuto parte dal Subject senza scegliere prima Venue o inventario", () => {
  assert.match(create, /Parti dal Subject di cui vuoi parlare/);
  assert.match(create, /senza obbligarti a scegliere prima un inventario/);
  assert.doesNotMatch(create, /Sede di riferimento|Nessuna sede specifica|venueTargetId|physicalIntent|organizationVenues\(/);
  assert.match(item, /preselectedSubjectId = params\(\)\.get\("subjectId"\)/);
  assert.match(item, /artaround-subject-presence/);
});

test("la semantica curatoriale usa lo Studio ma resta separata dai contenuti dell'Item", () => {
  assert.match(collection, /EditorialContext|editorialContext|Raccolta/);
  assert.match(studio, /semantic|Semantica|grafo|Relazioni/i);
  assert.match(create, /Il grafo semantico può essere condiviso con altre raccolte/);
  assert.doesNotMatch(item, /createItemConnection|removeItemConnection|data-add-connection|data-connection-search/);
});

test("Item e Visit editor non permettono di cambiare principal dall'editor", () => {
  assert.match(item, /readOperatingContext/);
  assert.match(visit, /readOperatingContext/);
  assert.doesNotMatch(item, /data-principal-form|changePrincipal\s*\(|searchParams\.set\("principalType"|searchParams\.set\("principalId"/);
  assert.doesNotMatch(visit, /data-new-principal|principalType:\s*params\.get|principalId:\s*params\.get/);
});

test("Libreria apre Crea senza serializzare il contesto nel link", () => {
  assert.match(workspace, /createHref\(\) \{ return "\/create"; \}/);
  assert.doesNotMatch(workspace, /\/create\?\$\{p\.toString\(\)\}/);
});
