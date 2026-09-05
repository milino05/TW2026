const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const browserSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/workspace-browser-view.js"), "utf8");
const catalogSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/catalog-view.js"), "utf8");
const detailSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/workspace-view.js"), "utf8");
const shellSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/app-shell.js"), "utf8");
const repositorySource = fs.readFileSync(path.join(root, "clients/marketplace/src/infrastructure/http/marketplace-repository.js"), "utf8");

 test("workspace route usa il browser paginato e mantiene il dettaglio separato", () => {
  assert.match(shellSource, /import "\.\/workspace-browser-view\.js"/);
  assert.match(shellSource, /if \(route === "\/workspace"\) return "<artaround-workspace-browser-view><\/artaround-workspace-browser-view>"/);
  assert.match(shellSource, /if \(route === "\/workspace\/resource"\) return "<artaround-workspace-view><\/artaround-workspace-view>"/);
});

test("workspace browser usa projection context/resources e non il dump legacy", () => {
  assert.match(browserSource, /marketplaceRepository\.workspaceContext\(/);
  assert.match(browserSource, /marketplaceRepository\.workspaceResources\(/);
  assert.doesNotMatch(browserSource, /marketplaceRepository\.workspace\(/);
  assert.match(repositorySource, /\/v2\/marketplace\/workspace\/context/);
  assert.match(repositorySource, /\/v2\/marketplace\/workspace\/resources/);
});

test("Libreria integra lavoro editoriale e risorse mantenendo esplicito lo spazio corrente", () => {
  assert.match(browserSource, /renderLibraryTabs\(\)/);
  assert.match(browserSource, /data-library-section="editorial"/);
  assert.match(browserSource, /data-library-section="resources"/);
  assert.match(browserSource, /Spazio editoriale corrente/);
  assert.match(browserSource, /editorialRepository\.spaceSummaries/);
  assert.match(browserSource, /editorialRepository\.spaceProjection/);
  assert.doesNotMatch(browserSource, /editorial-spaces-view|library-section-nav/);
});

test("workspace detail usa una projection puntuale e non carica workspace o distribution", () => {
  assert.match(detailSource, /marketplaceRepository\.workspaceResourceDetail\(/);
  assert.doesNotMatch(detailSource, /marketplaceRepository\.workspace\(/);
  assert.doesNotMatch(detailSource, /marketplaceRepository\.distribution\(/);
  assert.match(repositorySource, /\/v2\/marketplace\/workspace\/resources\/\$\{encodeURIComponent\(resourceType\)\}\/\$\{encodeURIComponent\(resourceId\)\}/);
});

test("le risorse cross-space restano separate da raccolte e contenuti dello spazio", () => {
  assert.match(browserSource, /const CROSS_SPACE_TYPES = \["visit", "namespace", "semantic_graph", "physical_vocabulary"\]/);
  assert.match(browserSource, /resourceTypes: this\.resourceType \? \[this\.resourceType\] : CROSS_SPACE_TYPES/);
  assert.match(browserSource, /Risorse cross-space/);
  assert.doesNotMatch(browserSource, /CROSS_SPACE_TYPES[^;]*item_edition/);
});

test("catalogo e workspace gestiscono la propria paginazione senza handler globale", () => {
  assert.doesNotMatch(shellSource, /closest\("button\[data-(?:catalog-)?page\]"\)/);
  assert.match(browserSource, /closest\("button\[data-content-page\]"\)/);
  assert.match(browserSource, /closest\("button\[data-resource-page\]"\)/);
  assert.match(catalogSource, /closest\("button\[data-catalog-page\]"\)/);
});
