const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "clients/marketplace/src/ui/venue-editor-view.js",
  "clients/marketplace/src/ui/venue-editor-action-mixin.js",
  "clients/marketplace/src/ui/venue-editor-contextual-workspace-mixin.js",
  "clients/marketplace/src/ui/venue-editor-floor-dialog-mixin.js",
  "clients/marketplace/src/ui/venue-editor-inventory-search-mixin.js",
  "clients/marketplace/src/ui/venue-editor-live-connection-preview-mixin.js",
  "clients/marketplace/src/ui/venue-editor-map-creation-dialog-mixin.js",
  "clients/marketplace/src/ui/venue-editor-targets-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-mixin.js",
  "clients/marketplace/src/ui/venue-editor-map-authoring-mixin.js",
  "clients/marketplace/src/ui/venue-editor-map-refinement-mixin.js",
  "clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-detail-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-diagnostics-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-interaction-mixin.js",
  "clients/marketplace/src/ui/venue-editor-spatial-overlay-mixin.js",
  "clients/marketplace/src/ui/venue-editor-section-mixin.js",
];
const sources = Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
const source = Object.values(sources).join("\n");
const styleSource = [
  "venue-editor.css",
  "venue-floor-dialog.css",
  "venue-inventory-search.css",
  "venue-map-authoring.css",
  "venue-map-refinement.css",
  "venue-slot-inventory-browser.css",
  "venue-spatial-detail.css",
].map((file) => fs.readFileSync(path.join(root, `clients/marketplace/src/styles/${file}`), "utf8")).join("\n");
const physicalVocabularyEditorSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js"), "utf8");

test("Sedi e spazi fisici passa il syntax gate", () => {
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
  const physicalResult = spawnSync(process.execPath, ["--check", path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js")], { encoding: "utf8" });
  assert.equal(physicalResult.status, 0, physicalResult.stderr || physicalResult.stdout);
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
  for (const label of ["Panoramica", "Spazi e mappa", "Informazioni visitatori", "Pubblicazione"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(sources["clients/marketplace/src/ui/venue-editor-section-mixin.js"], /\["targets", "Oggetti"\]/);
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

test("il workspace usa un layout compatto e lascia lo scorrimento verticale al documento", () => {
  const sectionSource = sources["clients/marketplace/src/ui/venue-editor-section-mixin.js"];
  assert.match(sectionSource, /venue-editor-page venue-editor-page--onboarding/);
  assert.match(sectionSource, /venue-editor-page venue-editor-page--workspace/);
  assert.match(sectionSource, /class="venue-context-bar"/);
  assert.match(sectionSource, /class="venue-editor-tabs"[^>]*aria-orientation="horizontal"/);
  assert.doesNotMatch(sectionSource, /Sede dell'organizzazione/);
  assert.doesNotMatch(styleSource, /venue-editor-page--workspace\{[^}]*height:calc\(100vh/);
  assert.doesNotMatch(styleSource, /venue-editor-content\{[^}]*overflow:hidden/);
  assert.doesNotMatch(styleSource, /venue-spatial-workspace\{[^}]*overflow:auto/);
  assert.match(styleSource, /venue-spatial-workspace\{[^}]*overflow:visible/);
});

test("Gestisci vocabolario apre la rotta reale e torna alla sede", () => {
  const mapSource = sources["clients/marketplace/src/ui/venue-editor-map-authoring-mixin.js"];
  assert.match(mapSource, /\/physical-vocabularies\/editor\?\$\{params\.toString\(\)\}/);
  assert.doesNotMatch(mapSource, /\/physical-vocabularies\/edit\?/);
  assert.match(mapSource, /returnTo: `\/venues\/editor\?venueId=\$\{encodeURIComponent\(this\.id\)\}#venue-map`/);
  assert.match(physicalVocabularyEditorSource, /function requestedReturnUrl\(\)/);
  assert.match(physicalVocabularyEditorSource, /resolved\.origin !== window\.location\.origin/);
  assert.match(physicalVocabularyEditorSource, /navigate\(physicalVocabularyBackUrl\(this\.data\?\.physicalVocabulary\?\.owner\)\)/);
});

test("Venue entities, recognition media e Subject restano separati dagli Item", () => {
  for (const token of ["createVenueTarget", "updateVenueTarget", "trashVenueTarget", "subjectId", "recognitionMedia", "configuration", "binding"]) assert.match(source, new RegExp(token));
  assert.match(source, /distint[oe] dagli Item/);
  assert.doesNotMatch(source, /managementRepository\.createItem|managementRepository\.updateItem|itemId\s*:/);
});

test("Allestimento usa la terminologia user-facing e preserva istruzioni multiple", () => {
  assert.match(source, /Slot espositivi/);
  assert.match(source, /Entità della sede/);
  assert.doesNotMatch(source, />Venue entities</);
  assert.match(source, /data-remove-slot-override/);
  assert.match(source, /data-detach-target/);
  assert.match(source, /approachGuidance/);
  assert.match(source, /Indicazioni specifiche configurate/);
  assert.match(source, /connection\.directionality === "bidirectional"/);
  assert.match(source, /data-add-floor-shortcut/);
  assert.match(source, /data-floor-settings-shortcut/);
  assert.match(source, /assignVenueTargetToExhibitSlot/);
  assert.doesNotMatch(source, /current[\s\S]{0,160}unassignVenueTargetFromExhibitSlot[\s\S]{0,160}assignVenueTargetToExhibitSlot/);
});

test("il picker Venue-aware estende automaticamente la ricerca quando manca un exact match", () => {
  const targetSource = sources["clients/marketplace/src/ui/venue-editor-targets-mixin.js"];
  assert.match(targetSource, /auto-search/);
  assert.match(targetSource, /continua automaticamente su Wikidata/);
});

test("la creazione dell'inventario non assegna implicitamente uno slot", () => {
  const inventorySource = sources["clients/marketplace/src/ui/venue-editor-slot-inventory-mixin.js"];
  assert.match(inventorySource, /managementRepository\.createVenueTarget/);
  assert.match(inventorySource, /non la colloca automaticamente/);
  assert.match(inventorySource, /data-assign-selected-inventory-target/);
  assert.match(inventorySource, /assignVenueTargetToExhibitSlot/);
  assert.doesNotMatch(source, /type: "placing-slot"/);
  assert.doesNotMatch(source, /type: "place-target"/);
  assert.match(source, /Scollega dallo slot/);
});

test("Layout authoring usa command granulari e controlli guidati dal PhysicalVocabulary", () => {
  for (const token of [
    "addVenueFloor", "uploadVenueFloorPlan", "calibrateVenueFloor", "createVenuePlace",
    "moveVenuePlace", "createVenueConnection", "updateVenueConnection", "createExhibitSlot", "assignVenueTargetToExhibitSlot",
  ]) assert.match(source, new RegExp(token));
  assert.match(source, /Editor spaziale/);
  assert.match(source, /caratteristiche fisiche/i);
  assert.match(source, /Non verificato/);
  assert.doesNotMatch(source, /routingAttributes|routingPresets|canonicalKey|snapshotDraft|captureDraft|applyDraft|preserveDraft/);
});

test("mappa resta una projection fisica e non introduce posizionamento automatico", () => {
  assert.match(source, /non traccia la posizione del visitatore/i);
  assert.match(source, /map-canvas/);
  assert.doesNotMatch(source, /navigator\.geolocation|getCurrentPosition|watchPosition|teleport|QRScanner/);
});

test("la macchina a stati della mappa usa soltanto i sette modi canonici", () => {
  for (const mode of [
    "idle", "placing_place", "connecting_select_from", "connecting_select_to",
    "calibrating", "editing_geometry", "dragging_place",
  ]) assert.match(source, new RegExp(`"${mode}"`));
  for (const mode of [
    "placing_place", "connecting_select_from", "connecting_select_to",
    "calibrating", "editing_geometry", "dragging_place",
  ]) assert.match(styleSource, new RegExp(`data-map-mode=${mode}`));
  assert.doesNotMatch(source, /"placing_slot"/);
  assert.doesNotMatch(styleSource, /data-map-mode=placing_slot/);
  assert.doesNotMatch(styleSource, /data-map-mode=(?:create-place|connect|calibrate|geometry)\]/);
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
  assert.match(source, /\["slot", "exhibit-slot"\]\.includes\(action\.type\)/);
  assert.match(source, /removeExhibitSlot/);
});

test("ritorno alla Organization riapre direttamente la sezione Sedi", () => {
  assert.match(source, /section=venues/);
});

test("l'impatto lifecycle usa singolare e plurale corretti per le visite", () => {
  const sectionSource = sources["clients/marketplace/src/ui/venue-editor-section-mixin.js"];
  assert.match(sectionSource, /"visita pubblicata dipende"/);
  assert.match(sectionSource, /"visite pubblicate dipendono"/);
  assert.doesNotMatch(sectionSource, /visitae/);
});
