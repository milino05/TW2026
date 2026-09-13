const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const contextualWorkspace = source("clients/marketplace/src/ui/venue-editor-contextual-workspace-mixin.js");
const inventoryProposals = source("clients/marketplace/src/ui/venue-editor-inventory-proposals-mixin.js");
const slotInventory = source("clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js");
const venueActions = source("clients/marketplace/src/ui/venue-editor-action-mixin.js");

test("Venue espone un solo Inventario canonico fuori dall'editor spaziale", () => {
  assert.match(inventoryProposals, /data-inventory-workspace-tab="entities"/);
  assert.match(inventoryProposals, /data-inventory-workspace-tab="proposals"/);
  assert.match(inventoryProposals, /renderInventoryBrowserSurface/);
  assert.doesNotMatch(contextualWorkspace, /\["inventory",\s*"Inventario"\]/);
  assert.doesNotMatch(contextualWorkspace, /activeTab === "inventory"/);
  assert.doesNotMatch(venueActions, /activeSpatialTab\s*=\s*"inventory"/);
});

test("Inventario avvia una collocazione map-first persistente fino allo slot", () => {
  assert.match(slotInventory, /startTargetPlacement\(targetId\)/);
  assert.match(slotInventory, /data-start-target-placement/);
  assert.match(slotInventory, /renderTargetPlacementBanner/);
  assert.match(slotInventory, /showSection\?\.\("map"\)/);
  assert.match(slotInventory, /openSpatialEditor\?\.\("place",\s*placeNode\.dataset\.mapPlace,\s*\{ tab: "slots" \}\)/);
  assert.match(slotInventory, /completeTargetPlacement\(exhibitSlotId\)/);
  assert.match(slotInventory, /Sostituisci e colloca/);
  assert.match(slotInventory, /data-cancel-target-placement/);
});

test("La collocazione può creare uno slot e assegnare subito l'entità", () => {
  assert.match(slotInventory, /createExhibitSlot/);
  assert.match(slotInventory, /assignVenueTargetToExhibitSlot/);
  assert.match(slotInventory, /Nuovo slot creato ed entità collocata/);
  assert.match(slotInventory, /Crea slot e colloca qui/);
});

test("Lo slot resta un entry point simmetrico verso l'inventario", () => {
  assert.match(slotInventory, /data-open-inventory-browser/);
  assert.match(slotInventory, /Scegli dall’inventario/);
  assert.match(slotInventory, /purpose:\s*"assign_to_slot"/);
  assert.match(slotInventory, /data-assign-selected-inventory-target/);
});

test("Accettare una proposta porta all'entità canonica appena inventariata", () => {
  assert.match(inventoryProposals, /acceptVenueInventoryProposal/);
  assert.match(inventoryProposals, /inventoryWorkspaceTab\s*=\s*"entities"/);
  assert.match(inventoryProposals, /targetSubjectId/);
  assert.match(inventoryProposals, /selectedVenueTargetId/);
});
