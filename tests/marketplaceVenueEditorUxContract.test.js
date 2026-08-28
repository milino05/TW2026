const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "clients/marketplace/src/ui/venue-editor-view.js",
  "clients/marketplace/src/ui/venue-editor-action-mixin.js",
  "clients/marketplace/src/ui/venue-editor-targets-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-mixin.js",
  "clients/marketplace/src/ui/venue-editor-map-authoring-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-diagnostics-mixin.js",
  "clients/marketplace/src/ui/venue-editor-section-mixin.js",
];
const sources = Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
const source = Object.values(sources).join("\n");
const styleSource = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/venue-editor.css"), "utf8");

test("Sedi e spazi fisici passa il syntax gate", () => {
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test("i moduli dichiarano le dipendenze di runtime che usano", () => {
  assert.match(sources["clients/marketplace/src/ui/venue-editor-action-mixin.js"], /import \{ navigate \}/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-action-mixin.js"], /managementRepository/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-map-authoring-mixin.js"], /managementRepository/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-targets-mixin.js"], /function has/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-spatial-mixin.js"], /physicalDefinitions/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-section-mixin.js"], /const SECTIONS =/);
});

test("Venue editor espone la IA user-facing approvata", () => {
  for (const label of ["Panoramica", "Oggetti", "Spazi e mappa", "Informazioni visitatori", "Pubblicazione"]) assert.match(source, new RegExp(label));
});

test("Venue editor mostra una sezione alla volta con tab accessibili e deep link", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /data-venue-section/);
  assert.match(source, /panel\.hidden = !selected/);
  assert.match(source, /#venue-\$\{section\}/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /this\.syncSectionNavigation\(\)/);
  assert.match(styleSource, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styleSource, /map-canvas\{[^}]*width:100%;min-width:0/);
  assert.match(styleSource, /map-canvas svg\{[^}]*max-width:100%;min-width:0/);
  assert.doesNotMatch(styleSource, /venue-editor-nav nav\{display:flex;overflow:auto\}/);
});

test("VenueTarget, recognition media e Subject restano nel dominio fisico senza diventare Item", () => {
  for (const token of ["createVenueTarget", "updateVenueTarget", "trashVenueTarget", "subjectId", "recognitionMedia", "configuration", "binding"]) assert.match(source, new RegExp(token));
  assert.match(source, /non crea un Item/);
  assert.doesNotMatch(source, /createItem|updateItem|itemId\s*:/);
});

test("la creazione object-first accompagna subito alla collocazione sulla mappa", () => {
  const actionSource = sources["clients/marketplace/src/ui/venue-editor-action-mixin.js"];
  assert.match(actionSource, /createdTarget = await managementRepository\.createVenueTarget/);
  assert.match(actionSource, /pendingMapAction = \{ type: "place-target", targetId \}/);
  assert.match(actionSource, /showSection\("map", \{ scroll: true \}\)/);
  assert.match(actionSource, /Aggiungi un luogo sulla mappa, poi colloca l’oggetto/);
});

test("Layout authoring usa command granulari e controlli guidati dal PhysicalVocabulary", () => {
  for (const token of [
    "addVenueFloor", "uploadVenueFloorPlan", "calibrateVenueFloor", "createVenuePlace",
    "moveVenuePlace", "createVenueConnection", "updateVenueConnection", "setVenueTargetPlacement",
  ]) assert.match(source, new RegExp(token));
  assert.match(source, /Editor visuale/);
  assert.match(source, /Caratteristiche fisiche/);
  assert.match(source, /Non verificato/);
  assert.doesNotMatch(source, /routingAttributes|routingPresets|canonicalKey|snapshotDraft|captureDraft|applyDraft|preserveDraft/);
});

test("mappa resta una projection fisica e non introduce posizionamento automatico", () => {
  assert.match(source, /Non rappresenta né calcola la posizione attuale del visitatore/);
  assert.match(source, /map-canvas/);
  assert.doesNotMatch(source, /navigator\.geolocation|getCurrentPosition|watchPosition|teleport|QRScanner/);
});

test("workflow e comandi distruttivi restano backend-authoritative e senza dialoghi nativi", () => {
  for (const operation of ["venue.release.check", "venue.release.request_review", "venue.release.withdraw_review", "venue.release.request_changes", "venue.release.publish"]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.match(source, /availableOperations/);
  assert.doesNotMatch(source, /window\.confirm|window\.prompt/);
  assert.match(source, /data-workflow-message/);
});

test("autosave salva ogni azione discreta sul server senza mega snapshot frontend", () => {
  assert.match(source, /async execute\(callback, message\)/);
  assert.match(source, /await callback\(\)[\s\S]*refreshServerState/);
  assert.match(source, /Aggiornamento…/);
  assert.match(source, /feedback-success/);
  assert.doesNotMatch(source, /beforeunload|snapshotDraft|captureDraft|applyDraft|preserveDraft|updateVenueRelease/);
});

test("azioni distruttive e request changes usano conferme inline", () => {
  assert.match(source, /data-confirm-venue-removal/);
  assert.match(source, /data-cancel-venue-removal/);
  assert.match(source, /data-confirm-target-removal/);
  assert.match(source, /data-cancel-target-removal/);
  assert.match(source, /pendingWorkflow/);
  assert.match(source, /data-confirm-workflow/);
});

test("ritorno alla Organization riapre direttamente la sezione Sedi", () => {
  assert.match(source, /section=venues/);
});
