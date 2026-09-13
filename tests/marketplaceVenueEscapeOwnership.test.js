const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const slotInventory = read("clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js");
const inventorySearch = read("clients/marketplace/src/ui/venue-editor-inventory-search-mixin.js");
const venueView = read("clients/marketplace/src/ui/venue-editor-view.js");
const modalLifecycle = read("clients/marketplace/src/ui/venue-modal-lifecycle-mixin.js");
const layerManager = read("clients/marketplace/src/application/layer-manager.js");

test("Venue modal Escape appartiene soltanto al LayerManager", () => {
  assert.doesNotMatch(slotInventory, /ensureGlobalEscapeHandler|_venueGlobalEscapeHandler/);
  assert.doesNotMatch(slotInventory, /window\.addEventListener\(["']keydown/);
  assert.doesNotMatch(venueView, /_venueGlobalEscapeHandler/);
  assert.match(modalLifecycle, /mountModalInteraction/);
  assert.match(layerManager, /document\.addEventListener\("keydown", onDocumentKeyDown\)/);
  assert.match(layerManager, /topEscapableLayer\(\)/);
});

test("tutti i modal Venue condividono un solo lifecycle portallato", () => {
  assert.match(modalLifecycle, /\.venue-modal-backdrop, \.venue-inventory-modal-layer/);
  assert.match(modalLifecycle, /\[data-modal-dismiss\]/);
  assert.doesNotMatch(inventorySearch, /mountModalInteraction|syncInventoryDialog|releaseInventoryDialog/);
  assert.doesNotMatch(venueView, /syncInventoryDialog|releaseInventoryDialog/);
});

test("Escape locale Venue resta limitato allo stato mappa non modale", () => {
  assert.match(venueView, /event\.key === "Escape" && !this\._venueModalLayers\?\.length && \(this\.pendingMapAction \|\| this\.draggingPlace\)/);
  assert.match(venueView, /this\.cancelMapAction\(\)/);
});
