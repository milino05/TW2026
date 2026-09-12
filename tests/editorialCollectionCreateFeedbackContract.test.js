const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/editorial-collection-create-view.js");
const stylesPath = path.join(root, "clients/marketplace/src/styles/editorial-collection-create.css");
const indexPath = path.join(root, "clients/marketplace/index.html");
const source = fs.readFileSync(viewPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");
const index = fs.readFileSync(indexPath, "utf8");

test("la creazione Raccolta usa le superfici feedback standard", () => {
  assert.match(source, /<artaround-callout tone="danger" role="alert">/);
  assert.match(source, /<artaround-callout tone="info">/);
  assert.doesNotMatch(source, /<p role="alert">/);
});

test("la creazione Raccolta è sempre un unico task modal a due passaggi", () => {
  assert.match(source, /context-task-modal-layer collection-create-modal-layer/);
  assert.match(source, /context-task-modal context-task-modal--large collection-create-modal/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /collection-create-stepper/);
  assert.match(source, /Passaggio 1 di 2/);
  assert.match(source, /Passaggio 2 di 2/);
  assert.doesNotMatch(source, /Passaggio 3 di 3/);
  assert.match(source, /data-back-step/);
  assert.match(source, /collection-create-context-banner/);
  assert.match(source, /contextKindLabel\(this\.context\)/);
  assert.match(source, /Grafo locale indipendente/);
  assert.match(source, /potrai aggiungere una o più sorgenti dalla sezione Collegamenti/);
  assert.doesNotMatch(source, /collection-graph-dialog|data-collection-graph-action|semanticGraphId|importItemIds|graphMode/);
});

test("il submit crea solo la Raccolta e lascia il grafo locale al backend", () => {
  assert.match(source, /editorialRepository\.createCollection\(\{/);
  assert.match(source, /ownerType: this\.context\.type/);
  assert.match(source, /contentSpaceId: id\(this\.selectedSpace\)/);
  assert.match(source, /namespaceId: this\.selectedNamespaceId/);
  assert.doesNotMatch(source, /graphDisplayName|graphDescription|semanticGraphId|importItemIds/);
  assert.match(source, /section=relations/);
});

test("gli stili dedicati mantengono il flusso a due passaggi e il dialog sorgenti", () => {
  assert.match(index, /editorial-collection-create\.css/);
  assert.match(styles, /\.collection-create-modal/);
  assert.match(styles, /\.collection-create-stepper\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.collection-create-context-banner/);
  assert.match(styles, /\.collection-graph-import-row/);
  assert.doesNotMatch(styles, /\.collection-graph-action-grid/);
  assert.doesNotMatch(styles, /\.collection-create-graph-step/);
  assert.match(styles, /@media\(max-width:52rem\)/);
  assert.match(styles, /@media\(max-width:36rem\)/);
});

test("la view di creazione Raccolta passa il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", viewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, `${viewPath}: ${result.stderr || result.stdout}`);
});
