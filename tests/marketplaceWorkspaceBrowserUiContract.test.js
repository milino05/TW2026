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

test("workspace detail usa una projection puntuale e non carica workspace o distribution", () => {
  assert.match(detailSource, /marketplaceRepository\.workspaceResourceDetail\(/);
  assert.doesNotMatch(detailSource, /marketplaceRepository\.workspace\(/);
  assert.doesNotMatch(detailSource, /marketplaceRepository\.distribution\(/);
  assert.match(repositorySource, /\/v2\/marketplace\/workspace\/resources\/\$\{encodeURIComponent\(resourceType\)\}\/\$\{encodeURIComponent\(resourceId\)\}/);
});

test("tab ownership e metadata del dettaglio usano attributi distinti", () => {
  assert.match(browserSource, /button\[data-ownership\]/);
  assert.match(browserSource, /data-resource-ownership=/);
  assert.match(browserSource, /detail\.dataset\.resourceOwnership/);
  assert.doesNotMatch(browserSource, /data-resource-detail[^>]*data-ownership=/);
});

test("catalogo e workspace gestiscono la propria paginazione senza handler globale", () => {
  assert.doesNotMatch(shellSource, /closest\("button\[data-(?:catalog-)?page\]"\)/);
  assert.match(browserSource, /closest\("button\[data-page\]"\)/);
  assert.match(catalogSource, /closest\("button\[data-catalog-page\]"\)/);
});
