const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const guard = read("clients/marketplace/src/application/navigation-loss-guard.js");
const router = read("clients/marketplace/src/application/router.js");
const adapter = read("clients/marketplace/src/ui/legacy-feedback-surface-adapter.js");
const namespace = read("clients/marketplace/src/ui/namespace-editor-view.js");
const physical = read("clients/marketplace/src/ui/physical-vocabulary-editor-view.js");
const catalog = read("clients/marketplace/src/ui/catalog-view.js");
const acquisitions = read("clients/marketplace/src/ui/acquisition-history-view.js");
const item = read("clients/marketplace/src/ui/item-authoring-view.js");
const profile = read("clients/marketplace/src/ui/profile-view.js");
const venueSections = read("clients/marketplace/src/ui/venue-editor-section-mixin.js");

test("i moduli del navigation-loss guard superano il syntax check", () => {
  for (const relative of [
    "clients/marketplace/src/application/navigation-loss-guard.js",
    "clients/marketplace/src/application/router.js",
    "clients/marketplace/src/ui/legacy-feedback-surface-adapter.js",
  ]) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});

test("gli editor con modifiche locali registrano lo stesso guard centralizzato", () => {
  assert.match(adapter, /DIRTY_EDITOR_GUARDS/);
  assert.match(adapter, /artaround-namespace-editor-view/);
  assert.match(adapter, /artaround-physical-vocabulary-editor-view/);
  assert.match(adapter, /artaround-item-authoring-view/);
  assert.match(adapter, /installDirtyNavigationGuardObserver/);
  assert.match(adapter, /new MutationObserver/);
  assert.match(adapter, /visitDirtyEditors\(node, registerDirtyEditor\)/);
  assert.match(adapter, /visitDirtyEditors\(node, \(editor\) => unregisterDirtyEditor\(editor\)\)/);
  assert.match(adapter, /definition\.isBlocking \? definition\.isBlocking\(editor\) : Boolean\(editor\.dirty\)/);
  assert.match(adapter, /editor\.readWorkingDraft\?\.\(\)/);
  assert.match(adapter, /editor\.clearWorkingDraft\?\.\(\)/);
  assert.match(adapter, /registerNavigationLossBlocker/);
  assert.match(adapter, /openActionDialog\(\{/);
  assert.match(adapter, /title: "Uscire senza salvare\?"/);
  assert.doesNotMatch(adapter, /prototype\.connectedCallback =/);
});

test("tutte le route programmatiche consultano il guard prima di pushState", () => {
  assert.match(router, /hasNavigationLossRisk\(\)/);
  assert.match(router, /confirmNavigationLoss\(\{ kind: "route"/);
  assert.ok(router.indexOf("confirmNavigationLoss({ kind: \"route\"") < router.indexOf("commitNavigation(path) : false"));
});

test("Back e Forward browser vengono ripristinati e riprodotti solo dopo conferma", () => {
  assert.match(router, /HISTORY_INDEX_KEY/);
  assert.match(router, /window\.addEventListener\("popstate", onGuardedPopState, true\)/);
  assert.match(router, /event\.stopImmediatePropagation\(\)/);
  assert.match(router, /window\.history\.go\(pending\.from - pending\.to\)/);
  assert.match(router, /allowedHistoryIndex = pending\.to/);
  assert.match(router, /window\.history\.go\(pending\.to - pending\.from\)/);
});

test("query, hash e sezioni preservano l'indice del navigation guard", () => {
  assert.match(router, /export function replaceCurrentHistoryUrl/);
  assert.match(router, /export function pushSameDocumentHistory/);
  assert.match(router, /\[HISTORY_INDEX_KEY\]: currentHistoryIndex/);
  for (const source of [catalog, acquisitions, item, namespace, physical, venueSections]) {
    assert.match(source, /replaceCurrentHistoryUrl/);
    assert.doesNotMatch(source, /window\.history\.replaceState/);
  }
  assert.match(profile, /pushSameDocumentHistory/);
  assert.doesNotMatch(profile, /window\.history\.pushState/);
});

test("logout viene fermato prima dell'effetto di autenticazione quando esistono modifiche locali", () => {
  assert.match(adapter, /button\[data-logout\]/);
  assert.match(adapter, /hasNavigationLossRisk\(\)/);
  assert.match(adapter, /confirmNavigationLoss\(\{ kind: "logout" \}\)/);
  assert.match(adapter, /event\.stopImmediatePropagation\(\)/);
});

test("refresh e chiusura tab usano un guard nativo centralizzato", () => {
  assert.match(adapter, /window\.addEventListener\("beforeunload"/);
  assert.match(adapter, /if \(!hasNavigationLossRisk\(\)\) return/);
  assert.match(adapter, /event\.returnValue = ""/);
  assert.match(namespace, /beforeunload/);
  assert.match(physical, /beforeunload/);
});

test("anche i metadati modificabili del Physical Vocabulary attivano subito il guard", () => {
  assert.match(physical, /input\.closest\("\[data-metadata-form\]"\)\) \{ this\.markDirty\(\); return; \}/);
  assert.match(physical, /data-dirty-indicator/);
  assert.match(physical, /markDirty\(\) \{/);
});

test("una conferma locale di uscita non provoca un secondo dialog centrale", () => {
  assert.match(adapter, /if \(confirmed\) editor\.dirty = false/);
  assert.match(adapter, /confirmed && confirmation\.type === "leave"/);
});

test("il guard non blocca cambi di sezione interni che non distruggono il draft", () => {
  assert.doesNotMatch(guard, /hashchange/);
  assert.doesNotMatch(adapter, /data-namespace-section.*confirmNavigationLoss/s);
  assert.doesNotMatch(adapter, /data-section.*confirmNavigationLoss/s);
});
