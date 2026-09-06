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
const spatialOverlay = read("clients/marketplace/src/ui/venue-editor-spatial-overlay-mixin.js");
const targets = read("clients/marketplace/src/ui/venue-editor-targets-mixin.js");
const semanticGraph = read("clients/marketplace/src/ui/semantic-graph-editor.js");
const contentManager = read("clients/marketplace/src/ui/editorial-collection-content-manager.js");

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

test("i task autonomi usano modal e non vengono compressi negli inspector contestuali", () => {
  assert.doesNotMatch(spatial, /context-workspace-inspector-layer/);
  assert.match(spatial, /return this\.renderSpatialEditor\(editable\)/);
  assert.match(spatialOverlay, /venue-modal-backdrop venue-spatial-editor-backdrop/);
  assert.match(spatialOverlay, /role="dialog" aria-modal="true"/);
  assert.match(targets, /context-task-modal-layer venue-inventory-modal-layer/);
  assert.match(targets, /context-task-modal context-task-modal--large/);
  assert.match(targets, /role="dialog" aria-modal="true"/);
  assert.match(workspaceCss, /artaround-workspace-view \.context-workspace-inspector-layer/);
  assert.match(workspaceCss, /artaround-workspace-browser-view \.context-workspace-inspector-layer/);
  assert.match(workspaceCss, /\.studio-settings-grid>\.context-workspace-inspector-layer/);
  assert.match(workspaceCss, /backdrop-filter:blur\(10px\)/);
  assert.doesNotMatch(inventoryCss, /\.venue-inventory-inspector\{position:fixed/);
});

test("gli inspector restano laterali dove il contesto del workspace deve rimanere visibile", () => {
  assert.match(workspaceCss, /\.context-workspace-inspector-layer\{position:fixed/);
  assert.match(workspaceCss, /\.context-workspace-inspector,\.venue-inventory-inspector\{position:absolute/);
  assert.match(workspaceCss, /\.semantic-inventory-inspector\{width:min\(42rem/);
  assert.match(semanticGraph, /context-workspace-inspector-layer/);
  assert.match(semanticGraph, /semantic-relation-inspector/);
  assert.match(contentManager, /context-workspace-inspector-layer/);
  assert.match(contentManager, /aria-label="Dettagli contenuto"/);
  assert.match(inventoryCss, /\.venue-inventory-workspace\{display:block/);
  assert.doesNotMatch(inventoryCss, /venue-inventory-workspace\{[^}]*grid-template-columns/);
});

test("la shell non introduce una sidebar permanente negli editor contestuali", () => {
  assert.doesNotMatch(workspaceCss, /grid-template-columns\s*:\s*(?:[^;]*sidebar|[0-9.]+rem\s+minmax)/i);
  assert.match(workspaceCss, /context-workspace-tabs[^}]*overflow-x:auto/);
});
