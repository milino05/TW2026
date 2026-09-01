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
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const shell = read("shell");
const create = read("create");
const item = read("item");
const visit = read("visit");
const collection = read("collection");
const studio = read("studio");
const workspace = read("workspace");

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

test("Create Hub deriva il principal dal contesto operativo e non lo serializza nei link", () => {
  assert.match(create, /readOperatingContext/);
  assert.match(create, /operatingPrincipal/);
  assert.match(create, /this\.principal\(\)/);
  assert.match(create, /marketplaceRepository\.workspaceContext\(principal\)/);
  assert.match(create, /marketplaceRepository\.authoringPreflight\(principal\)/);
  assert.doesNotMatch(create, /principalType|principalId|data-principal-form/);
});

test("Create Hub presenta Contenuto, Raccolta e Visita come obiettivi distinti", () => {
  assert.match(create, /capabilities\?\.contentCreate/);
  assert.match(create, /capabilities\?\.editorialCollectionCreate/);
  assert.match(create, /capabilities\?\.visitCreate/);
  assert.match(create, /Crea un contenuto/);
  assert.match(create, /Organizza contenuti e semantica/);
  assert.match(create, /Progetta una visita/);
  assert.match(create, /\/workspace\/item-authoring/);
  assert.match(create, /\/workspace\/editorial-collection-new/);
  assert.match(create, /\/workspace\/visit-authoring/);
});

test("la creazione del contenuto parte dal Subject senza scegliere prima Venue o inventario", () => {
  assert.match(create, /Parti dal Subject di cui vuoi parlare/);
  assert.match(create, /senza obbligarti a scegliere prima un inventario/);
  assert.doesNotMatch(create, /Sede di riferimento|Nessuna sede specifica|venueTargetId|physicalIntent|organizationVenues\(/);
  assert.match(item, /preselectedSubjectId = params\(\)\.get\("subjectId"\)/);
  assert.match(item, /artaround-subject-presence/);
});

test("la semantica curatoriale appartiene alla Raccolta e allo Studio, non all'Item", () => {
  assert.match(create, /Definisci un contesto curatoriale con un proprio Namespace, una composizione di contenuti e un grafo semantico fra Subject/);
  assert.match(collection, /EditorialContext|editorialContext|Raccolta/);
  assert.match(studio, /semantic|Semantica|grafo/i);
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
