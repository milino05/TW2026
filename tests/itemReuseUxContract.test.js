const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const collectionPicker = read("clients/marketplace/src/ui/collection-item-add-dialog.js");
const quickAdd = read("clients/marketplace/src/ui/content-space-item-add-dialog.js");
const libraryRepository = read("clients/marketplace/src/infrastructure/http/library-repository.js");
const itemsController = read("controllers/itemsV2.controller.js");
const creationPolicy = read("services/itemCreationV2.service.js");
const addContext = read("services/contentSpaceItemAddContext.service.js");

test("collection escalation is marked as collection-origin and reuses the canonical add flow", () => {
  assert.match(collectionPicker, /document\.createElement\("artaround-content-space-item-add-dialog"\)/);
  assert.match(collectionPicker, /setAttribute\("origin",\s*"collection"\)/);
  assert.match(collectionPicker, /library-item-added/);
  assert.match(collectionPicker, /library-item-open/);
});

test("creating a second local content requires explicit distinct-lineage confirmation", () => {
  assert.match(quickAdd, /data-create-distinct-item/);
  assert.match(quickAdd, /data-confirm-distinct-lineage/);
  assert.match(quickAdd, /Creare un contenuto indipendente\?/);
  assert.match(quickAdd, /creationMode:\s*this\.distinctLineage\s*\?\s*"distinct_lineage"\s*:\s*"reuse_first"/);
  assert.match(libraryRepository, /creationMode = "reuse_first"/);
  assert.match(libraryRepository, /creationMode/);
});

test("Marketplace fork states that it creates an independent content before execution", () => {
  assert.match(quickAdd, /creerà un nuovo contenuto indipendente nello Spazio editoriale/);
  assert.match(quickAdd, /Crea copia indipendente e aggiungi/);
  assert.match(quickAdd, /operationCode:\s*"content\.fork"/);
});

test("POST items is guarded server-side and same-label candidates suppress blind creation", () => {
  assert.match(itemsController, /itemCreation\.createItem/);
  assert.match(creationPolicy, /ITEM_REUSE_AVAILABLE/);
  assert.match(creationPolicy, /creationMode === "reuse_first"/);
  assert.match(creationPolicy, /distinct_lineage/);
  assert.match(addContext, /findOwnedItemReuseCandidates/);
  assert.match(addContext, /ownedItems = reuseCandidates\.length/);
  assert.match(quickAdd, /matchReason === "same_label"/);
});
