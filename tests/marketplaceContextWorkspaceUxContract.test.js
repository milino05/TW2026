const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const workspaceCss = read("clients/marketplace/src/styles/context-workspace.css");
const inventoryCss = read("clients/marketplace/src/styles/venue-inventory-search.css");
const slotInventoryCss = read("clients/marketplace/src/styles/venue-slot-inventory-browser.css");
const spatialDetailCss = read("clients/marketplace/src/styles/venue-spatial-detail.css");
const venueSection = read("clients/marketplace/src/ui/venue-editor-section-mixin.js");
const studio = read("clients/marketplace/src/ui/editorial-studio-view.js");
const spatial = read("clients/marketplace/src/ui/venue-editor-contextual-workspace-mixin.js");
const spatialOverlay = read("clients/marketplace/src/ui/venue-editor-spatial-overlay-mixin.js");
const venueModalLifecycle = read("clients/marketplace/src/ui/venue-modal-lifecycle-mixin.js");
const targets = read("clients/marketplace/src/ui/venue-editor-targets-mixin.js");
const semanticGraph = read("clients/marketplace/src/ui/semantic-graph-editor.js");
const contentManager = read("clients/marketplace/src/ui/editorial-collection-content-manager.js");
const collectionItemAddDialog = read("clients/marketplace/src/ui/collection-item-add-dialog.js");

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

test("i task autonomi usano modal applicativi e non inspector contestuali", () => {
  assert.doesNotMatch(spatial, /context-workspace-inspector-layer/);
  assert.match(spatial, /return this\.renderSpatialEditor\(editable\)/);
  assert.match(spatialOverlay, /venue-modal-backdrop venue-spatial-editor-backdrop/);
  assert.match(spatialOverlay, /role="dialog" aria-modal="true"/);
  assert.match(venueModalLifecycle, /mountModalInteraction/);
  assert.match(targets, /artaround-modal-layer venue-inventory-modal-layer/);
  assert.match(targets, /artaround-task-modal artaround-task-modal--large/);
  assert.match(collectionItemAddDialog, /artaround-modal-layer collection-item-add-modal-layer/);
  assert.match(collectionItemAddDialog, /artaround-task-modal artaround-task-modal--large collection-item-add-modal/);
  assert.match(contentManager, /document\.createElement\("artaround-collection-item-add-dialog"\)/);
  assert.doesNotMatch(contentManager, /data-content-mode=['"]external['"]/);
  assert.doesNotMatch(workspaceCss, /context-workspace-inspector|context-task-modal|workspace-sidecar/);
  assert.doesNotMatch(inventoryCss, /\.venue-inventory-inspector\{position:fixed/);
});

test("Venue normalizza i task bounded sulla Task Modal condivisa e inoltra gli eventi dei picker portalled", () => {
  assert.match(venueModalLifecycle, /taskPanel\.classList\.add\("artaround-task-modal"\)/);
  assert.match(venueModalLifecycle, /artaround-task-modal__body venue-modal-card__body/);
  assert.match(venueModalLifecycle, /artaround-task-modal__footer/);
  assert.match(venueModalLifecycle, /data-close-inventory-browser/);
  assert.match(venueModalLifecycle, /data-close-inventory-subject-picker/);
  assert.match(venueModalLifecycle, /layer\.addEventListener\("subject-selected", subjectSelected\)/);
  assert.match(venueModalLifecycle, /forwardVenueEvent\(this, this\.onSubjectSelected, event\)/);
  assert.match(venueModalLifecycle, /canDismiss: \(\) => true/);
});

test("Venue mantiene un solo scroll owner verticale per ogni superficie applicativa", () => {
  assert.doesNotMatch(slotInventoryCss, /\.venue-inventory-browser-grid\{[^}]*max-height/);
  assert.doesNotMatch(slotInventoryCss, /\.venue-inventory-browser-grid\{[^}]*overflow(?:-y)?:\s*(?:auto|scroll)/);
  for (const selector of ["venue-inventory-browser-dialog", "venue-inventory-detail-dialog", "venue-inventory-subject-dialog"]) {
    assert.doesNotMatch(slotInventoryCss, new RegExp(`\\.${selector}\\{[^}]*overflow(?:-y)?:\\s*(?:auto|scroll)`));
    assert.doesNotMatch(slotInventoryCss, new RegExp(`\\.${selector}\\{[^}]*max-height`));
  }
  assert.match(spatialDetailCss, /\.venue-spatial-dialog-frame\{[^}]*100dvh[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
  assert.match(spatialDetailCss, /safe-area-inset-top/);
  assert.match(spatialDetailCss, /safe-area-inset-bottom/);
});

test("il grafo mantiene il workspace pieno e usa modal condivisi soltanto per task bounded", () => {
  assert.match(semanticGraph, /semantic-graph-workspace/);
  assert.match(semanticGraph, /mountModalInteraction/);
  assert.match(semanticGraph, /artaround-modal-layer semantic-graph-modal-layer/);
  assert.match(semanticGraph, /artaround-task-modal/);
  assert.doesNotMatch(semanticGraph, /context-workspace-inspector-layer|semantic-relation-inspector|semantic-subject-inspector|context-task-modal/);
  assert.doesNotMatch(collectionItemAddDialog, /context-workspace-inspector-layer|context-task-modal/);
  assert.match(inventoryCss, /\.venue-inventory-workspace\{display:block/);
  assert.doesNotMatch(inventoryCss, /venue-inventory-workspace\{[^}]*grid-template-columns/);
});

test("la shell non introduce una sidebar permanente negli editor contestuali", () => {
  assert.doesNotMatch(workspaceCss, /grid-template-columns\s*:\s*(?:[^;]*sidebar|[0-9.]+rem\s+minmax)/i);
  assert.match(workspaceCss, /context-workspace-tabs[^}]*overflow-x:auto/);
});
