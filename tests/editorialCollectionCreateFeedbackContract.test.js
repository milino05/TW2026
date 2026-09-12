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

test("la creazione Raccolta è sempre un unico task modal a tre passaggi", () => {
  assert.match(source, /context-task-modal-layer collection-create-modal-layer/);
  assert.match(source, /context-task-modal context-task-modal--large collection-create-modal/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /collection-create-stepper/);
  assert.match(source, /Passaggio 1 di 3/);
  assert.match(source, /Passaggio 2 di 3/);
  assert.match(source, /Passaggio 3 di 3/);
  assert.match(source, /data-back-step/);
  assert.match(source, /collection-create-context-banner/);
  assert.match(source, /contextKindLabel\(this\.context\)/);
  assert.match(source, /data-collection-graph-action="new"/);
  assert.match(source, /data-collection-graph-action="existing"/);
  assert.match(source, /artaround-collection-graph-dialog embedded/);
  assert.doesNotMatch(source, /<main class="page workspace-page collection-create-page"/);
  assert.doesNotMatch(source, /name="semanticGraphId"|type="radio"/);
});

test("il configuratore del grafo supporta sia task modal standalone sia contenuto embedded", () => {
  assert.match(dialog, /embedded = false/);
  assert.match(dialog, /options\.embedded === true/);
  assert.match(dialog, /collection-graph-dialog--embedded/);
  assert.match(dialog, /context-task-modal-layer collection-graph-dialog-layer/);
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

test("gli stili dedicati mantengono modal, stepper e grafo embedded responsive", () => {
  assert.match(index, /editorial-collection-create\.css/);
  assert.match(styles, /\.collection-create-modal/);
  assert.match(styles, /\.collection-create-stepper/);
  assert.match(styles, /\.collection-create-context-banner/);
  assert.match(styles, /\.collection-graph-dialog--embedded/);
  assert.match(styles, /\.collection-graph-choice-card\[aria-pressed="true"\]/);
  assert.match(styles, /@media\(max-width:52rem\)/);
  assert.match(styles, /@media\(max-width:36rem\)/);
});

test("view e configuratore grafo della creazione Raccolta passano il syntax gate", () => {
  for (const target of [viewPath, dialogPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});
