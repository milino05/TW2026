const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  workspace: "clients/marketplace/src/ui/workspace-browser-view.js",
  collection: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  guard: "clients/marketplace/src/ui/form-navigation-loss-guard.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

test("le superfici editoriali correnti con draft e il guard superano il syntax check", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("Nuova raccolta conserva i campi testuali attraverso i rerender di Namespace e grafo", () => {
  assert.match(source.collection, /draft = \{[\s\S]*displayName: ""[\s\S]*graphDisplayName: ""[\s\S]*\}/);
  assert.match(source.collection, /this\.addEventListener\("input", this\.onInput\)/);
  assert.match(source.collection, /captureDraft\(target\.form\)/);
  assert.match(source.collection, /value="\$\{escapeHtml\(this\.draft\.displayName\)\}"/);
  assert.match(source.collection, />\$\{escapeHtml\(this\.draft\.description\)\}<\/textarea>/);
  assert.match(source.collection, /hasUnsavedChanges\(\) \{ return this\.dirty; \}/);
  assert.match(source.collection, /this\.dirty = false;\s*navigate\(`/);
});

test("creazione Spazio integrata nella Libreria conserva e protegge il draft", () => {
  assert.match(source.workspace, /spaceDraft = \{ name: "", description: "" \}/);
  assert.match(source.workspace, /spaceDirty = false/);
  assert.match(source.workspace, /registerNavigationLossBlocker\(\{/);
  assert.match(source.workspace, /isBlocking: \(\) => this\.spaceDirty/);
  assert.match(source.workspace, /value="\$\{escapeHtml\(this\.spaceDraft\.name\)\}"/);
  assert.match(source.workspace, />\$\{escapeHtml\(this\.spaceDraft\.description\)\}<\/textarea>/);
  assert.match(source.workspace, /catch \(error\)[\s\S]*this\.panelBusy = false;\s*this\.render\(\)/);
});

test("il guard riconosce i nuovi editor anche dopo la sostituzione del nodo form", () => {
  for (const host of [
    "artaround-editorial-collection-create-view",
    "artaround-editorial-studio-view",
  ]) assert.match(source.guard, new RegExp(host));
  assert.match(source.guard, /hostHasDurableDirtyState/);
  assert.match(source.guard, /protectedHosts\(\)\.some\(hostHasDurableDirtyState\)/);
  assert.match(source.guard, /host\.discardUnsavedChanges\?\.\(\)/);
});

test("anche il cambio tab interno dello Studio passa dal guard condiviso", () => {
  assert.match(source.guard, /artaround-editorial-studio-view button\[data-studio-section\]/);
  assert.match(source.guard, /confirmNavigationLoss\(\{/);
  assert.match(source.guard, /kind: "section"/);
  assert.match(source.guard, /studio\.setSection\?\.\(nextSection\)/);
});
