const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "clients/marketplace/src/ui/venue-editor-view.js",
  "clients/marketplace/src/ui/venue-editor-draft-mixin.js",
  "clients/marketplace/src/ui/venue-editor-action-mixin.js",
  "clients/marketplace/src/ui/venue-editor-targets-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-mixin.js",
  "clients/marketplace/src/ui/venue-editor-routing-mixin.js",
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
  assert.match(sources["clients/marketplace/src/ui/venue-editor-draft-mixin.js"], /function parseRefs/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-targets-mixin.js"], /function has/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-spatial-mixin.js"], /function pretty/);
  assert.match(sources["clients/marketplace/src/ui/venue-editor-section-mixin.js"], /const SECTIONS =/);
});

test("Venue editor espone le sei sezioni user-facing approvate", () => {
  for (const label of ["Panoramica", "Oggetti esposti", "Informazioni visitatori", "Mappa e luoghi", "Percorsi", "Pubblicazione"]) assert.match(source, new RegExp(label));
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
  for (const token of ["createVenueTarget", "updateVenueTarget", "trashVenueTarget", "subjectId", "recognitionMedia", "targetBindings"]) assert.match(source, new RegExp(token));
  assert.match(source, /non crea un Item/);
  assert.doesNotMatch(source, /createItem|updateItem|itemId\s*:/);
});

test("LayoutRevision preserva piani luoghi collocazioni connessioni e routing avanzato", () => {
  for (const token of ["placeTypes", "routingAttributes", "routingPresets", "floors", "places", "venueTargetPlacements", "connections"]) assert.match(source, new RegExp(token));
  assert.match(source, /Attributi tecnici del luogo/);
  assert.match(source, /Configurazione routing avanzata/);
  assert.match(source, /Requisiti strutturati/);
});

test("mappa resta una projection fisica e non introduce posizionamento automatico", () => {
  assert.match(source, /Non rappresenta né calcola la posizione attuale del visitatore/);
  assert.match(source, /map-canvas/);
  assert.doesNotMatch(source, /navigator\.geolocation|getCurrentPosition|watchPosition|teleport|QRScanner/);
});

test("workflow resta backend-authoritative e senza dialoghi nativi", () => {
  for (const operation of ["venue.release.check", "venue.release.request_review", "venue.release.withdraw_review", "venue.release.request_changes", "venue.release.publish"]) assert.match(source, new RegExp(operation.replaceAll(".", "\\.")));
  assert.match(source, /availableOperations/);
  assert.doesNotMatch(source, /window\.confirm|window\.prompt/);
  assert.match(source, /data-workflow-message/);
});

test("dirty state protegge il draft tra sezioni e durante mutazioni dei VenueTarget", () => {
  assert.match(source, /beforeunload/);
  assert.match(source, /captureDraft/);
  assert.match(source, /applyDraft/);
  assert.match(source, /snapshotDraft/);
  assert.match(source, /preserveDraft/);
  assert.match(source, /preVisitInformation: draft\.preVisitInformation/);
  assert.match(source, /targetBindings: draft\.targetBindings/);
  assert.match(source, /layout: draft\.layout/);
  assert.match(source, /data-confirm-leave/);
});

test("azioni distruttive e request changes usano conferme inline", () => {
  assert.match(source, /trashTarget/);
  assert.match(source, /data-confirm-trash/);
  assert.match(source, /data-cancel-trash/);
  assert.match(source, /pendingWorkflow/);
  assert.match(source, /data-confirm-workflow/);
});

test("ritorno alla Organization riapre direttamente la sezione Sedi", () => {
  assert.match(source, /section=venues/);
});
