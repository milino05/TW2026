const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js");
const stylePath = path.join(root, "clients/marketplace/src/styles/physical-vocabulary-editor.css");
const organizationPath = path.join(root, "clients/marketplace/src/ui/organization-view.js");
const source = fs.readFileSync(viewPath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const organizationSource = fs.readFileSync(organizationPath, "utf8");

test("il tutorial del vocabolario fisico passa il syntax gate", () => {
  const result = spawnSync(process.execPath, ["--check", viewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("il primo vocabolario vuoto apre una guida facoltativa e ripetibile", () => {
  assert.match(source, /artaround\.physical-vocabulary-editor\.tutorial\.v2/);
  assert.match(source, /localStorage\.getItem\(TUTORIAL_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(TUTORIAL_STORAGE_KEY, "seen"\)/);
  assert.match(source, /data-tutorial-start/);
  assert.match(source, /Ripeti tutorial/);
});

test("la guida usa bubble ancorate, spotlight e navigazione avanti-indietro", () => {
  for (const token of [
    "data-physical-tutorial-overlay",
    "data-physical-tutorial-bubble",
    "data-physical-tutorial-spotlight",
    "data-tutorial-next",
    "data-tutorial-prev",
    "positionTutorial",
    "placeTutorial",
  ]) assert.match(source, new RegExp(token));
  for (const target of ["overview", "sections", "workflow"]) assert.match(source, new RegExp(`data-physical-tutorial-anchor=\\"${target}\\"`));
  for (const section of ["placeTypes", "connectionTypes", "physicalAttributes", "routingProfiles", "mappings"]) assert.match(source, new RegExp(`physical-${section}`));
  assert.match(styles, /\.physical-tutorial-spotlight/);
  assert.match(styles, /\.physical-tutorial-bubble\[data-side="right"\]/);
});

test("overlay e dialoghi bloccano lo scroll e trattengono il focus", () => {
  assert.match(source, /physical-overlay-open/);
  assert.match(source, /onTutorialScroll/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(styles, /html\.physical-overlay-open,body\.physical-overlay-open\{overflow:hidden!important/);
  assert.match(styles, /\.physical-tutorial-overlay\[data-centered="true"\]/);
  assert.match(styles, /\.physical-modal-backdrop/);
});

test("la configurazione base è proposta alla fine e resta disponibile nella pagina", () => {
  assert.match(source, /starter: true/);
  assert.match(source, /Vuoi partire da una configurazione pronta\?/);
  assert.match(source, /data-tutorial-finish>Preferisco partire da zero/);
  assert.match(source, /data-starter-open/);
  assert.match(source, /Configurazione base<\/button>/);
  assert.match(source, /data-starter-apply/);
  assert.match(source, /applyPhysicalVocabularyStarter/);
  for (const summary of ["13 tipi di luogo", "8 collegamenti", "9 caratteristiche", "4 profili"]) assert.match(source, new RegExp(summary));
});

test("la creazione nell'organizzazione parte vuota e rimanda la configurazione base alla guida", () => {
  assert.match(organizationSource, /applyStarter: false/);
  assert.doesNotMatch(organizationSource, /name="startingPoint"/);
  assert.match(organizationSource, /Alla fine potrai scegliere una configurazione base già pronta oppure partire da zero/);
});
