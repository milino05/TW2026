const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  workspace: "clients/marketplace/src/ui/workspace-browser-view.js",
  spaceDialogs: "clients/marketplace/src/ui/workspace-space-dialogs.js",
  collection: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  sourceDialog: "clients/marketplace/src/ui/collection-graph-import-dialog.js",
  guard: "clients/marketplace/src/ui/form-navigation-loss-guard.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

test("le superfici editoriali correnti con draft e il guard superano il syntax check", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("Nuova Raccolta conserva draft e step attraverso i rerender nel Task Dialog condiviso", () => {
  assert.match(source.collection, /draft = \{ displayName: "", shortDescription: "", description: "" \}/);
  assert.match(source.collection, /step = "details"/);
  assert.match(source.collection, /createTaskDialog/);
  assert.match(source.collection, /onInput: this\.onDialogInput/);
  assert.match(source.collection, /isDirty: \(\) => this\.dirty/);
  assert.match(source.collection, /onDiscard: \(\) => \{ this\.dirty = false; \}/);
  assert.match(source.collection, /this\.captureDraft\(form\)/);
  assert.match(source.collection, /this\.step = "rules"/);
  assert.doesNotMatch(source.collection, /this\.step = "graph"|graphSelection|graphEditorMode/);
  assert.match(source.collection, /value="\$\{escapeHtml\(this\.draft\.displayName\)\}"/);
  assert.match(source.collection, />\$\{escapeHtml\(this\.draft\.description\)\}<\/textarea>/);
  assert.match(source.collection, /hasUnsavedChanges\(\) \{ return this\.dirty; \}/);
  assert.match(source.collection, /this\.dirty = false;[\s\S]*navigate\(`/);
});

test("il source manager mantiene pinning e importazione distinti nello stesso Task Dialog", () => {
  assert.match(source.sourceDialog, /view = "list"/);
  assert.match(source.sourceDialog, /this\.view = "add"/);
  assert.match(source.sourceDialog, /this\.view = "import"/);
  assert.match(source.sourceDialog, /attachGraphImportSource/);
  assert.match(source.sourceDialog, /importGraphSubjects/);
  assert.match(source.sourceDialog, /createTaskDialog/);
  assert.match(source.sourceDialog, /title: "Gestisci sorgenti"/);
  assert.match(source.sourceDialog, /Aggiungi sorgente/);
  assert.match(source.sourceDialog, /Importa contenuti/);
  assert.doesNotMatch(source.sourceDialog, /context-task-modal|data-graph-import-backdrop|data-attach-source-only|submitImport\(\[\]\)|config\.mode === "import-content"/);
});

test("creazione e modifica Spazio conservano e proteggono il draft nel dialog dedicato", () => {
  assert.match(source.workspace, /openSpaceEditorDialog/);
  assert.doesNotMatch(source.workspace, /spaceDraft|spaceDirty/);
  assert.match(source.spaceDialogs, /const state = \{/);
  assert.match(source.spaceDialogs, /name: String\(initial\.name \|\| ""\)/);
  assert.match(source.spaceDialogs, /description: String\(initial\.description \|\| ""\)/);
  assert.match(source.spaceDialogs, /dirty: false/);
  assert.match(source.spaceDialogs, /isDirty: \(\) => state\.dirty/);
  assert.match(source.spaceDialogs, /onDiscard: \(\) => \{ state\.dirty = false; \}/);
  assert.match(source.spaceDialogs, /if \(field\.name === "name"\) state\.name = field\.value/);
  assert.match(source.spaceDialogs, /if \(field\.name === "description"\) state\.description = field\.value/);
  assert.match(source.spaceDialogs, /state\.dirty = true/);
  assert.match(source.spaceDialogs, /catch \(error\)[\s\S]*state\.busy = false;[\s\S]*dialog\?\.render\(\)/);
});

test("il guard riconosce gli editor full-page anche dopo la sostituzione del nodo form", () => {
  for (const host of ["artaround-editorial-collection-create-view", "artaround-editorial-studio-view"]) assert.match(source.guard, new RegExp(host));
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
