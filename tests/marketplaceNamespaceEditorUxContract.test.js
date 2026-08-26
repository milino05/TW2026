const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/namespace-editor-view.js");
const stylePath = path.join(root, "clients/marketplace/src/styles/namespace-editor.css");
const source = fs.readFileSync(viewPath, "utf8");
const styleSource = fs.readFileSync(stylePath, "utf8");

test("Regole editoriali passano il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", viewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Namespace editor espone le otto sezioni user-facing approvate", () => {
  for (const label of ["Generale", "Durate", "Livelli di linguaggio", "Tipi di soggetto", "Relazioni", "Presentazione", "Selezione", "Mapping esterni"]) assert.match(source, new RegExp(label));
});

test("Namespace editor mostra una sezione alla volta con tab accessibili e deep link", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /data-namespace-section/);
  assert.match(source, /panel\.hidden = !selected/);
  assert.match(source, /#namespace-\$\{section\}/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /this\.syncSectionNavigation\(\)/);
  assert.match(styleSource, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styleSource, /namespace-editor-nav nav\{display:flex;overflow:auto\}/);
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

test("più durate ricevono valori distinti e vengono salvate in ordine", () => {
  assert.match(source, /function emptyDefinition\(field, existing = \[\]\)/);
  assert.match(source, /const longest = Math\.max\(0, \.\.\.existing\.map/);
  assert.match(source, /base\.targetSeconds = longest \? longest \+ 60 : 60/);
  assert.match(source, /output\[field\]\.sort\(\(left, right\) => left\.targetSeconds - right\.targetSeconds\)/);
  assert.match(source, /emptyDefinition\(field, definitions\[field\]\)/);
});

test("gli errori portano alla sezione da correggere con messaggi comprensibili", () => {
  assert.match(source, /userFacingFieldLabel, userFacingIssueMessage/);
  assert.match(source, /error\?\.details\?\.find/);
  assert.match(source, /if \(section\) this\.activeSection = section/);
  assert.match(source, /Problemi da risolvere/);
});
