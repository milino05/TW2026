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
  venueTargets: "clients/marketplace/src/ui/venue-target-chooser.js",
  workspace: "clients/marketplace/src/ui/workspace-browser-view.js",
};
function read(key) { return fs.readFileSync(path.join(root, files[key]), "utf8"); }
const shell = read("shell");
const create = read("create");
const item = read("item");
const visit = read("visit");
const venueTargets = read("venueTargets");
const workspace = read("workspace");

test("create boundary passa il syntax gate", () => {
  for (const file of Object.values(files)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("shell espone Crea dentro la IA contestuale", () => {
  for (const label of ["Home", "Esplora", "Libreria", "Crea", "Attività", "Account"]) assert.match(shell, new RegExp(`>${label}<`));
  assert.match(shell, /class="nav-create"/);
  assert.match(shell, /authoringIsCreation/);
});

test("Create Hub deriva l'owner dal contesto di sessione", () => {
  assert.match(create, /readOperatingContext/);
  assert.match(create, /operatingPrincipal/);
  assert.match(create, /this\.principal\(\)/);
  assert.match(create, /\/workspace\/item-authoring/);
  assert.match(create, /\/workspace\/visit-authoring/);
  assert.doesNotMatch(create, /principalType|principalId|data-principal-form/);
});

test("Create Hub mostra una sola remediation e non espone la gestione avanzata", () => {
  assert.match(create, /capabilities\?\.contentCreate/);
  assert.match(create, /capabilities\?\.visitCreate/);
  assert.match(create, /capabilities\?\.venueObjectContentCreate/);
  assert.match(create, /if \(!this\.preflight\?\.content\?\.allowed\) return ""/);
  assert.doesNotMatch(create, /blockerCard\(\{ physical:/);
  assert.doesNotMatch(create, /Gestione avanzata/);
});

test("Item e Visit editor non permettono di cambiare principal dall'editor", () => {
  assert.match(item, /readOperatingContext/);
  assert.match(visit, /readOperatingContext/);
  assert.doesNotMatch(item, /data-principal-form|changePrincipal\s*\(|searchParams\.set\("principalType"|searchParams\.set\("principalId"/);
  assert.doesNotMatch(visit, /data-new-principal|principalType:\s*params\.get|principalId:\s*params\.get/);
});

test("flusso da oggetto fisico propaga solo il VenueTarget necessario", () => {
  assert.match(venueTargets, /venueTargetId/);
  assert.match(venueTargets, /\/workspace\/item-authoring\?venueTargetId=/);
  assert.doesNotMatch(venueTargets, /principalType|principalId|principalQuery/);
});

test("Libreria apre Crea senza serializzare il contesto nel link", () => {
  assert.match(workspace, /createHref\(\) \{ return "\/create"; \}/);
  assert.doesNotMatch(workspace, /\/create\?\$\{p\.toString\(\)\}/);
});
