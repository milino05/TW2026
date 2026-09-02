const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const workspaceCss = read("clients/marketplace/src/styles/context-workspace.css");
const inventoryCss = read("clients/marketplace/src/styles/venue-inventory-search.css");
const venueSection = read("clients/marketplace/src/ui/venue-editor-section-mixin.js");
const studio = read("clients/marketplace/src/ui/editorial-studio-view.js");
const spatial = read("clients/marketplace/src/ui/venue-editor-contextual-workspace-mixin.js");

test("Venue e Raccolta condividono la stessa shell Context Workspace full-width", () => {
  assert.match(workspaceCss, /\.context-workspace-page,\.venue-editor-page/);
  assert.match(workspaceCss, /\.context-workspace-bar,\.venue-context-bar/);
  assert.match(workspaceCss, /\.context-workspace-tabs,\.venue-editor-tabs/);
  assert.match(venueSection, /class="venue-context-bar"/);
  assert.match(venueSection, /class="venue-editor-tabs"/);
  assert.match(studio, /context-workspace-page/);
  assert.match(studio, /context-workspace-bar/);
  assert.match(studio, /context-workspace-tabs/);
});

test("canvas e inventario usano inspector sovrapposti senza sacrificare la superficie di lavoro", () => {
  assert.match(spatial, /context-workspace-inspector-layer/);
  assert.match(spatial, /context-workspace-inspector venue-context-inspector/);
  assert.match(workspaceCss, /\.context-workspace-inspector,\.venue-inventory-inspector/);
  assert.match(inventoryCss, /\.venue-inventory-workspace\{display:block/);
  assert.match(inventoryCss, /\.venue-inventory-detail\.empty\{display:none\}/);
  assert.match(inventoryCss, /\.venue-inventory-inspector\{position:fixed/);
  assert.doesNotMatch(inventoryCss, /venue-inventory-workspace\{[^}]*grid-template-columns/);
});

test("la shell non introduce una sidebar permanente negli editor contestuali", () => {
  assert.doesNotMatch(workspaceCss, /grid-template-columns\s*:\s*(?:[^;]*sidebar|[0-9.]+rem\s+minmax)/i);
  assert.match(workspaceCss, /context-workspace-tabs[^}]*overflow-x:auto/);
});
