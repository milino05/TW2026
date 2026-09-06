const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const library = read("clients/marketplace/src/ui/workspace-browser-view.js");
const quickAdd = read("clients/marketplace/src/ui/content-space-item-add-dialog.js");
const itemDetail = read("clients/marketplace/src/ui/item-detail-dialog.js");
const collectionContent = read("clients/marketplace/src/ui/editorial-collection-content-manager.js");
const itemAuthoring = read("clients/marketplace/src/ui/item-authoring-view.js");
const itemModel = read("models/itemV2.model.js");
const revisionModel = read("models/itemRevisionV2.model.js");

test("la tab Contenuti espone una sola azione primaria Aggiungi contenuto e non duplica il CTA nell'empty state", () => {
  assert.match(library, /data-new-content[^>]*>\$\{icon\("plus"[^}]+\}\s*Aggiungi contenuto<\/button>/);
  assert.match(library, /Usa “Aggiungi contenuto” per inserire il primo Item/);
  assert.doesNotMatch(library, /Crea contenuto<\/button>/);
  assert.match(library, /openItemAddDialog\(\)/);
});

test("il quick add riusa il picker Subject e distingue Item esistenti da un nuovo Item", () => {
  assert.match(quickAdd, /artaround-semantic-entity-picker mode="subject" entity-kind="item"/);
  assert.match(quickAdd, /itemAddContext/);
  assert.match(quickAdd, /alreadyInCurrentSpace/);
  assert.match(quickAdd, /data-add-existing-item/);
  assert.match(quickAdd, /data-create-distinct-item/);
  assert.match(quickAdd, /suggestRecognitionMedia/);
  assert.match(quickAdd, /data-confirm-new-item/);
});

test("recognitionMedia appartiene all'Item mentre illustrativeMedia resta nella ItemRevision", () => {
  assert.match(itemModel, /recognitionMedia:\s*\{\s*type:\s*ItemMediaSchema/);
  assert.match(revisionModel, /illustrativeMedia:\s*\{\s*type:\s*\[ItemMediaSchema\]/);
});

test("le card dello Space restano leggere e l'immagine viene caricata nel dettaglio Item", () => {
  assert.doesNotMatch(library, /recognitionMedia/);
  assert.match(library, /content-item-card/);
  assert.match(itemDetail, /item\.recognitionMedia/);
  assert.match(itemDetail, /<figure><img/);
});

test("il dettaglio Item ha due tab Edizioni e Raccolte e usa un drill-down interno per la raccolta", () => {
  assert.match(itemDetail, /data-item-detail-tab="editions"[^>]*>Edizioni<\/button>/);
  assert.match(itemDetail, /data-item-detail-tab="collections"[^>]*>Raccolte<\/button>/);
  assert.match(itemDetail, /data-add-collection-mode/);
  assert.match(itemDetail, /Aggiungi a una raccolta/);
  assert.match(itemDetail, /view = "collection-detail"/);
  assert.match(itemDetail, /renderCollectionDetail\(\)/);
  assert.match(itemDetail, /semanticCoverage/);
  assert.match(itemDetail, /data-open-collection-graph/);
});

test("lo Studio della Raccolta riusa lo stesso dettaglio Item e lo apre già contestualizzato", () => {
  assert.match(collectionContent, /import "\.\/item-detail-dialog\.js"/);
  assert.match(collectionContent, /document\.createElement\("artaround-item-detail-dialog"\)/);
  assert.match(collectionContent, /initial-collection-id/);
  assert.match(collectionContent, /openItemDetail\(inspect\.dataset\.inspectContent\)/);
});

test("Crea versione usa una modalità nuova Edition esplicita e il recognitionMedia come prefill", () => {
  assert.match(itemDetail, /query\.set\("newEdition", "1"\)/);
  assert.match(itemAuthoring, /forceNewEdition = params\(\)\.get\("newEdition"\) === "1"/);
  assert.match(itemAuthoring, /lineage\?\.recognitionMedia/);
  assert.match(itemAuthoring, /Immagine di riconoscimento dell'Item proposta come base/);
});
