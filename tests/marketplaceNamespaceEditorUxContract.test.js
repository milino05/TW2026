const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/namespace-editor-view.js");
const source = fs.readFileSync(viewPath, "utf8");

test("Regole editoriali passano il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", viewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Namespace editor espone le otto sezioni user-facing approvate", () => {
  for (const label of ["Generale", "Durate", "Livelli di linguaggio", "Tipi di soggetto", "Relazioni", "Presentazione", "Selezione", "Mapping esterni"]) assert.match(source, new RegExp(label));
});

test("progressive disclosure preserva i campi tecnici e il modello NamespaceRevision", () => {
  for (const token of ["definitionId", "key", "domainDefinitionIds", "rangeDefinitionIds", "category", "strength", "directionality", "userIntents", "reverseLabel", "allowMultiple", "targetRequired"]) assert.match(source, new RegExp(token));
  assert.match(source, /updateNamespaceRevision/);
  assert.doesNotMatch(source, /venueId|venueTargetId|recognitionMedia/);
});

test("Mapping esterni usa semanticRefs esistenti e resta provider-neutral", () => {
  assert.match(source, /semanticRefs/);
  assert.match(source, /semantic-ref-selected/);
  assert.match(source, /mode="mapping"/);
  assert.match(source, /schema\|ID\|relazione/);
  assert.match(source, /exact, close, broader, narrower/);
});

test("workflow resta backend-authoritative e senza prompt o confirm nativi", () => {
  for (const operation of ["namespace.revision.check", "namespace.revision.request_review", "namespace.revision.withdraw_review", "namespace.revision.request_changes", "namespace.revision.publish"]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.match(source, /availableOperations/);
  assert.doesNotMatch(source, /window\.confirm|window\.prompt/);
  assert.match(source, /data-workflow-message/);
});

test("dirty state impedisce perdita silenziosa e salva metadata più definizioni insieme", () => {
  assert.match(source, /beforeunload/);
  assert.match(source, /data-dirty-indicator/);
  assert.match(source, /saveAll/);
  assert.match(source, /updateNamespace\(this\.id, metadata\)/);
  assert.match(source, /updateNamespaceRevision\(this\.id, definitions\)/);
  assert.match(source, /data-confirm-leave/);
  assert.match(source, /if \(add\)[\s\S]*?snapshotDraft\(\)/);
  assert.match(source, /if \(remove\)[\s\S]*?snapshotDraft\(\)/);
});

test("ritorno all owner mantiene Account e Organization nelle aree corrette", () => {
  assert.match(source, /section=rules/);
  assert.match(source, /\/profile#account-rules/);
});
