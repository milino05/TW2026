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

test("i moduli del navigation-loss guard superano il syntax check", () => {
  for (const relative of [
    "clients/marketplace/src/application/navigation-loss-guard.js",
    "clients/marketplace/src/application/router.js",
    "clients/marketplace/src/ui/legacy-feedback-surface-adapter.js",
  ]) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "pipe" });
});

test("Namespace e Physical registrano lo stesso guard centralizzato quando dirty", () => {
  assert.match(adapter, /installDirtyNavigationGuard\(ArtAroundNamespaceEditorView/);
  assert.match(adapter, /installDirtyNavigationGuard\(ArtAroundPhysicalVocabularyEditorView/);
  assert.match(adapter, /isBlocking: \(\) => this\.isConnected && Boolean\(this\.dirty\)/);
  assert.match(adapter, /registerNavigationLossBlocker/);
  assert.match(adapter, /openActionDialog\(\{/);
  assert.match(adapter, /title: "Uscire senza salvare\?"/);
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

test("logout viene fermato prima dell'effetto di autenticazione quando esistono modifiche locali", () => {
  assert.match(adapter, /button\[data-logout\]/);
  assert.match(adapter, /hasNavigationLossRisk\(\)/);
  assert.match(adapter, /confirmNavigationLoss\(\{ kind: "logout" \}\)/);
  assert.match(adapter, /event\.stopImmediatePropagation\(\)/);
});

test("refresh e chiusura tab conservano la protezione nativa beforeunload", () => {
  assert.match(namespace, /beforeunload/);
  assert.match(namespace, /event\.returnValue = ""/);
  assert.match(physical, /beforeunload/);
  assert.match(physical, /event\.returnValue = ""/);
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
