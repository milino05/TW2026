const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function source(relativePath) { return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8"); }

const contextualWorkspace = source("clients/marketplace/src/ui/venue-editor-contextual-workspace-mixin.js");
const inventoryProposals = source("clients/marketplace/src/ui/venue-editor-inventory-proposals-mixin.js");
const slotInventory = source("clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js");
const subjectInventoryMixin = source("clients/marketplace/src/ui/venue-editor-subject-inventory-mixin.js");
const venueEditorView = source("clients/marketplace/src/ui/venue-editor-view.js");
const inventorySearch = source("clients/marketplace/src/ui/venue-editor-inventory-search-mixin.js");
const targetCreateDialog = source("clients/marketplace/src/ui/venue-target-create-dialog.js");
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

test("Il + dell'inventario apre il browser Subject condiviso tramite composizione statica", () => {
  assert.match(venueEditorView, /import \{ venueSubjectInventoryMixin \} from "\.\/venue-editor-subject-inventory-mixin\.js"/);
  assert.match(venueEditorView, /venueSlotInventoryMixin,\s*venueSubjectInventoryMixin,/);
  assert.match(subjectInventoryMixin, /data-open-inventory-subject-picker/);
  assert.match(subjectInventoryMixin, /openInventoryTargetCreateDialog/);
  assert.match(subjectInventoryMixin, /inventoryCapabilities/);
  assert.match(subjectInventoryMixin, /renderInventorySubjectPickerOverlay\(\) \{ return ""; \}/);
  assert.doesNotMatch(subjectInventoryMixin, /customElements\.get|prototype\.|installVenueSubjectInventoryIntegration/);
  assert.match(inventorySearch, /openVenueTargetCreateDialog/);
  assert.match(targetCreateDialog, /Dalla tua organizzazione|Subject già utilizzato dalla tua organizzazione/);
  assert.match(targetCreateDialog, /organizationUsage/);
  assert.match(targetCreateDialog, /Cerca anche in Wikidata/);
  assert.match(targetCreateDialog, /data-add-selected-subject/);
  assert.match(targetCreateDialog, /data-propose-selected-subject/);
});

test("Il browser Subject resta aperto dopo aggiunta o proposta e riallinea l'inventario", () => {
  assert.match(targetCreateDialog, /onChanged\?\.\(\{ action: "added"/);
  assert.match(targetCreateDialog, /onChanged\?\.\(\{ action: "proposed"/);
  assert.match(targetCreateDialog, /semanticRepository\.searchVenueSubjects\(venueId, ""/);
  assert.doesNotMatch(targetCreateDialog, /close\(\{ reason: "created" \}\)/);
  assert.match(inventorySearch, /await this\.refreshServerState\(\)/);
});

test("Accettare una proposta porta all'entità canonica appena inventariata", () => {
  assert.match(inventoryProposals, /acceptVenueInventoryProposal/);
  assert.match(inventoryProposals, /inventoryWorkspaceTab\s*=\s*"entities"/);
  assert.match(inventoryProposals, /targetSubjectId/);
  assert.match(inventoryProposals, /selectedVenueTargetId/);
});

test("i moduli nuovi del workflow inventario passano il syntax gate", () => {
  for (const relative of [
    "clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js",
    "clients/marketplace/src/ui/venue-editor-subject-inventory-mixin.js",
    "clients/marketplace/src/ui/venue-editor-view.js",
    "clients/marketplace/src/ui/venue-editor-inventory-search-mixin.js",
    "clients/marketplace/src/ui/venue-target-create-dialog.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
