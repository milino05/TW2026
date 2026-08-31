const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("clients/marketplace/src/main.js");
const adapter = read("clients/marketplace/src/ui/revision-workflow-adapter.js");
const controls = read("clients/marketplace/src/ui/revision-workflow-controls.js");
const workflow = read("clients/marketplace/src/application/revision-workflow.js");
const namespaceEditor = read("clients/marketplace/src/ui/namespace-editor-view.js");
const physicalEditor = read("clients/marketplace/src/ui/physical-vocabulary-editor-view.js");

test("la projection workflow condivisa viene caricata prima dell'app shell", () => {
  assert.match(main, /revision-workflow-adapter\.js/);
  assert.ok(main.indexOf("revision-workflow-controls.js") < main.indexOf("revision-workflow-adapter.js"));
  assert.ok(main.indexOf("revision-workflow-adapter.js") < main.indexOf("app-shell.js"));
});

test("i moduli workflow condivisi superano il syntax check", () => {
  for (const relative of [
    "clients/marketplace/src/application/revision-workflow.js",
    "clients/marketplace/src/ui/revision-workflow-controls.js",
    "clients/marketplace/src/ui/revision-workflow-adapter.js",
  ]) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});

test("il controllo condiviso non inventa capability e renderizza solo availableOperations", () => {
  assert.match(workflow, /presentAvailableOperations\(availableOperations/);
  assert.match(workflow, /\.filter\(isRevisionWorkflowOperation\)/);
  assert.doesNotMatch(workflow, /push\(|unshift\(|concat\(/);
  assert.match(controls, /_availableOperations/);
  assert.match(controls, /revisionWorkflowOperations\(this\._availableOperations/);
  assert.match(controls, /actions-only/);
  assert.match(controls, /presentationOverrides/);
});

test("Namespace proietta soltanto le azioni workflow realmente presenti", () => {
  assert.match(adapter, /ArtAroundNamespaceEditorView/);
  assert.match(adapter, /rowSelector: "\.namespace-workflow > \.button-row"/);
  assert.match(adapter, /buttonSelector: "button\[data-operation\]"/);
  assert.match(adapter, /operationAttribute: "operation"/);
  assert.match(adapter, /availableOperations: editor\.data\?\.availableOperations \|\| \[\]/);
  assert.match(namespaceEditor, /data-operation="\$\{escapeHtml\(entry\.code\)\}"/);
});

test("Physical proietta le azioni ma conserva request_changes e il suo messaggio specializzato", () => {
  assert.match(adapter, /ArtAroundPhysicalVocabularyEditorView/);
  assert.match(adapter, /rowSelector: "\.physical-workflow > \.button-row"/);
  assert.match(adapter, /buttonSelector: "button\[data-workflow\]"/);
  assert.match(adapter, /operationAttribute: "workflow"/);
  assert.match(adapter, /availableOperations: editor\.operations\?\.\(\) \|\| \[\]/);
  assert.match(physicalEditor, /physical_vocabulary\.revision\.request_changes/);
  assert.match(physicalEditor, /this\.pendingWorkflow = operation/);
  assert.match(physicalEditor, /data-workflow-message-input/);
  assert.match(physicalEditor, /Inserisci il motivo delle modifiche richieste/);
});

test("la projection delega al vecchio handler invece di duplicare la logica di dominio", () => {
  assert.match(adapter, /legacyByCode = new Map/);
  assert.match(adapter, /legacy\.click\(\)/);
  assert.match(adapter, /legacyRow\.hidden = true/);
  assert.match(adapter, /legacyRow\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(adapter, /data\.artaroundLegacyProjection|dataset\.artaroundLegacyProjection/);
  assert.doesNotMatch(adapter, /managementRepository|accountRepository|marketplaceRepository/);
});
