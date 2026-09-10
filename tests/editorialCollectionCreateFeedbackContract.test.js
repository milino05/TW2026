const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/editorial-collection-create-view.js");
const dialogPath = path.join(root, "clients/marketplace/src/ui/collection-graph-dialog.js");
const stylesPath = path.join(root, "clients/marketplace/src/styles/editorial-collection-create.css");
const indexPath = path.join(root, "clients/marketplace/index.html");
const source = fs.readFileSync(viewPath, "utf8");
const dialog = fs.readFileSync(dialogPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

test("la creazione Raccolta usa le superfici feedback standard", () => {
  const dangerCallouts = source.match(/<artaround-callout tone="danger" role="alert">/g) || [];
  assert.equal(dangerCallouts.length, 2);
  assert.match(source, /<artaround-field-feedback id="collection-graph-error">/);
  assert.doesNotMatch(source, /<p role="alert">/);
});

test("la creazione Raccolta è una pagina unica contestualizzata e non un wizard a riquadri", () => {
  assert.match(source, /collection-create-context-banner/);
  assert.match(source, /contextKindLabel\(this\.context\)/);
  assert.match(source, /data-collection-graph-action="new"/);
  assert.match(source, /data-collection-graph-action="existing"/);
  assert.match(source, /collection-graph-selection-summary/);
  assert.match(source, /rows="3"/);
  assert.doesNotMatch(source, /renderStepIndicator|data-back-step|semanticSource|reuseMode/);
  assert.doesNotMatch(source, /name="semanticGraphId"|type="radio"/);
});

test("il dialog del grafo usa il task modal ArtAround e configura una sorgente importabile", () => {
  assert.match(dialog, /context-task-modal-layer collection-graph-dialog-layer/);
  assert.match(dialog, /context-task-modal context-task-modal--large collection-graph-dialog/);
  assert.match(dialog, /editorialRepository\.reusableSemanticGraphs/);
  assert.match(dialog, /editorialRepository\.semanticGraphImportPreview/);
  assert.match(dialog, /data-collection-graph-choice/);
  assert.match(dialog, /aria-pressed/);
  assert.match(dialog, /data-preview-graph-import/);
  assert.match(dialog, /data-use-source-only/);
  assert.match(dialog, /data-import-subject-toggle/);
  assert.match(dialog, /collection-graph-selected/);
  assert.doesNotMatch(dialog, /type="radio"|data-use-shared-graph|data-start-graph-fork/);
});

test("il modal configura solo new/import senza creare risorse prima del submit Raccolta", () => {
  assert.match(dialog, /graphMode: "new"/);
  assert.match(dialog, /graphMode: "import"/);
  assert.doesNotMatch(dialog, /graphMode: "shared"|graphMode: "fork"/);
  assert.doesNotMatch(dialog, /createCollection|createSemanticGraph|createGraph/);
  assert.match(source, /editorialRepository\.createCollection\(payload\)/);
  assert.match(source, /graphMode === "import"/);
  assert.match(source, /graphMode === "new"/);
  assert.match(source, /importItemIds/);
});

test("gli stili dedicati mantengono banner, card e modal responsive nel linguaggio ArtAround", () => {
  assert.match(index, /editorial-collection-create\.css/);
  assert.match(styles, /\.collection-create-context-banner/);
  assert.match(styles, /\.collection-graph-action-card/);
  assert.match(styles, /\.collection-graph-choice-card\[aria-pressed="true"\]/);
  assert.match(styles, /@media\(max-width:52rem\)/);
  assert.match(styles, /@media\(max-width:36rem\)/);
});

test("view e dialog della creazione Raccolta passano il syntax gate", () => {
  for (const target of [viewPath, dialogPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});
