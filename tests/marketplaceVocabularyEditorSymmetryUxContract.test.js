const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(root, "clients/marketplace/index.html"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "clients/marketplace/src/main.js"), "utf8");
const namespaceSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/namespace-editor-view.js"), "utf8");
const physicalSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js"), "utf8");
const shellPath = path.join(root, "clients/marketplace/src/ui/vocabulary-editor-shell.js");
const shellSource = fs.readFileSync(shellPath, "utf8");
const sharedStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/vocabulary-editor-shell.css"), "utf8");

test("lo shell condiviso dei vocabolari passa il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", shellPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("lo shell viene installato prima del bootstrap dell'applicazione", () => {
  assert.ok(mainSource.indexOf("vocabulary-editor-shell.js") >= 0);
  assert.ok(mainSource.indexOf("vocabulary-editor-shell.js") < mainSource.indexOf("app-shell.js"));
});

test("Namespace e Physical Vocabulary caricano un unico contratto visuale dopo gli stili specifici", () => {
  const namespaceCss = indexSource.indexOf("namespace-editor.css");
  const physicalCss = indexSource.indexOf("physical-vocabulary-editor.css");
  const sharedCss = indexSource.indexOf("vocabulary-editor-shell.css");
  assert.ok(namespaceCss >= 0 && physicalCss >= 0 && sharedCss >= 0);
  assert.ok(sharedCss > namespaceCss);
  assert.ok(sharedCss > physicalCss);
});

test("il contratto visuale accoppia esplicitamente le superfici principali dei due editor", () => {
  for (const selector of [
    ".namespace-editor-page,\n.physical-editor-page",
    ".namespace-editor-header,\n.physical-editor-header",
    ".physical-editor-tabs",
    ".physical-editor-section",
    ".physical-sticky-actions,\n.namespace-savebar",
  ]) assert.ok(sharedStyles.includes(selector), `selector condiviso mancante: ${selector}`);
  assert.match(sharedStyles, /grid-template-columns:13\.5rem minmax\(0,1fr\)/);
  assert.match(sharedStyles, /box-shadow:inset \.2rem 0 0 var\(--sage-500\)/);
});

test("il Physical Vocabulary usa lo stesso header action/status pattern e la stessa semantica a tab del Namespace", () => {
  assert.match(namespaceSource, /namespace-editor-side/);
  assert.match(namespaceSource, /namespace-editor-actions/);
  assert.match(namespaceSource, /role=\"tablist\"/);
  assert.match(shellSource, /side\.className = "namespace-editor-side"/);
  assert.match(shellSource, /actions\.className = "namespace-editor-actions"/);
  assert.match(shellSource, /state\.classList\.add\("namespace-editor-status"\)/);
  assert.match(shellSource, /nav\.setAttribute\("role", "tablist"\)/);
  assert.match(shellSource, /nav\.setAttribute\("aria-orientation", "vertical"\)/);
  assert.match(shellSource, /button\.setAttribute\("role", "tab"\)/);
  assert.match(shellSource, /section\.setAttribute\("role", "tabpanel"\)/);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) assert.match(shellSource, new RegExp(key));
});

test("la simmetria non cancella i campi specifici dei due domini", () => {
  for (const token of ["durationTypes", "languageLevels", "subjectClasses", "relationTypes", "presentationAspects", "selectionSignals"]) {
    assert.match(namespaceSource, new RegExp(token));
  }
  for (const token of ["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles"]) {
    assert.match(physicalSource, new RegExp(token));
  }
  assert.match(physicalSource, /requirement\.physicalAttributeDefinitionId/);
  assert.match(namespaceSource, /domainDefinitionIds/);
});

test("lo shell condiviso resta presentazionale e non introduce persistenza alternativa", () => {
  assert.doesNotMatch(shellSource, /managementRepository|accountRepository|fetch\(|XMLHttpRequest/);
  assert.match(shellSource, /renderPhysicalVocabulary\.apply\(this, args\)/);
});
