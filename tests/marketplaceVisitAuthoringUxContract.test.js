const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/visit-authoring-view.js");
const shellPath = path.join(root, "clients/marketplace/src/ui/app-shell.js");
const servicePath = path.join(root, "services/visitAuthoringV2.service.js");
const commandPath = path.join(root, "services/visitAuthoringCommandV2.service.js");
const sequenceDomainPath = path.join(root, "services/visitSequenceV2.service.js");
const sequenceCommandPath = path.join(root, "services/visitAuthoringSequenceCommandV2.service.js");
const sequenceRepositoryPath = path.join(root, "clients/marketplace/src/infrastructure/http/visit-sequence-repository.js");
const sessionPlanPath = path.join(root, "services/sessionPlanV2.service.js");
const routesPath = path.join(root, "routes/visitsV2.routes.js");
const controllerPath = path.join(root, "controllers/visitsV2.controller.js");
const view = fs.readFileSync(viewPath, "utf8");
const shell = fs.readFileSync(shellPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const commands = fs.readFileSync(commandPath, "utf8");
const sequenceDomain = fs.readFileSync(sequenceDomainPath, "utf8");
const sequenceCommands = fs.readFileSync(sequenceCommandPath, "utf8");
const sequenceRepository = fs.readFileSync(sequenceRepositoryPath, "utf8");
const sessionPlan = fs.readFileSync(sessionPlanPath, "utf8");
const routes = fs.readFileSync(routesPath, "utf8");
const controller = fs.readFileSync(controllerPath, "utf8");

test("visit authoring boundary passa il syntax gate", () => {
  for (const target of [viewPath, shellPath, servicePath, commandPath, sequenceDomainPath, sequenceCommandPath, sequenceRepositoryPath, sessionPlanPath, routesPath, controllerPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("visit authoring espone cinque passaggi con composer unificato", () => {
  for (const label of ["Informazioni", "Costruisci la visita", "Impostazioni", "Percorso", "Pubblicazione"]) assert.match(view, new RegExp(label));
  assert.match(view, /const stages = \[\[1, "Informazioni"\], \[2, "Costruisci la visita"\], \[3, "Impostazioni"\], \[4, "Percorso"\], \[5, "Pubblicazione"\]\]/);
  assert.match(view, /grid-template-columns:repeat\(5/);
  assert.match(view, /aria-label="Passaggi di creazione della visita"/);
});

test("browser contenuti e sequenza della visita convivono nello stesso step", () => {
  assert.match(view, /visit-content-composer/);
  assert.match(view, /available-content-pane/);
  assert.match(view, /visit-selection-pane/);
  assert.match(view, /renderVisitSequence\(\)/);
  assert.match(view, /Trova i contenuti, aggiungili e mettili in ordine/);
  assert.match(view, /Filtri avanzati/);
  assert.match(view, /data-content-access="owned"/);
  assert.match(view, /data-content-access="acquired"/);
  assert.match(view, /data-source-filter/);
  assert.match(view, /data-content-venue/);
  assert.match(view, /searchPerformed = false/);
  assert.match(view, /candidate-grid--scroll/);
  assert.match(view, /grid-template-columns:1fr;gap:1rem;margin-top:1\.25rem/);
  assert.match(view, /I risultati compariranno qui senza caricare in anticipo l’intera libreria/);
  assert.doesNotMatch(view, /Organizza le tappe/);
});

test("impostazioni visita usano slider spiegati e con feedback leggibile", () => {
  assert.match(view, /type="range"/);
  assert.match(view, /data-preference-range="depth"/);
  assert.match(view, /data-preference-range="language"/);
  assert.match(view, /Livello di approfondimento/);
  assert.match(view, /Complessità del linguaggio/);
  assert.match(view, /aiutano il Navigator a scegliere/);
  assert.match(view, /preferenceLabel/);
});

test("aggiunta contenuto è one-click e usa importanza consigliata come default", () => {
  assert.match(view, /data-add-content/);
  assert.match(view, /role:\s*"recommended"/);
  assert.doesNotMatch(view, /data-add-role/);
  assert.match(view, /data-entry-role/);
});

test("inferenza fisica resta backend-authoritative e ambiguità richiedono scelta", () => {
  assert.match(service, /primarySubjectId/);
  assert.match(commands, /publishedOccurrenceCandidates/);
  assert.match(commands, /VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED/);
  assert.match(commands, /ensureAnchorForTarget/);
  assert.match(view, /pendingOccurrence/);
  assert.match(view, /data-occurrence-target/);
});

test("drag and drop riordina tappe e contenuti senza confondere il delivery", () => {
  assert.match(view, /addEventListener\("dragstart"/);
  assert.match(view, /data-drag-kind="stop"/);
  assert.match(view, /data-drag-kind="content"/);
  assert.match(view, /target\.dataset\.anchorKey !== this\.dragState\.anchorKey/);
  assert.match(view, /visitSequenceRepository\.reorderContent/);
  assert.match(view, /authoringRepository\.reorderVisitStop/);
  assert.match(sequenceDomain, /sameDeliveryGroup/);
  assert.match(sequenceDomain, /reorderWithinDeliveryGroup/);
  assert.match(sequenceDomain, /canonicalizeContentEntries/);
  assert.match(sequenceCommands, /reorderWithinDeliveryGroup/);
  assert.match(sequenceCommands, /canonicalizeContentEntries/);
  assert.match(sessionPlan, /canonicalizeContentEntries[\s\S]*orderedContentEntries/);
  assert.match(sequenceRepository, /commands\/content\/\$\{encodeURIComponent\(contentEntryId\)\}\/reorder/);
  assert.match(routes, /commands\/content\/:contentEntryId\/reorder/);
  assert.match(controller, /authoringSequenceCommandService\.reorderVisitContent/);
});

test("riordino conserva fallback accessibili e spostamento tappa esplicito", () => {
  assert.match(view, /aria-label="Sposta contenuto prima"/);
  assert.match(view, /aria-label="Sposta contenuto dopo"/);
  assert.match(view, /aria-label="Sposta tappa prima"/);
  assert.match(view, /aria-label="Sposta tappa dopo"/);
  assert.match(view, /data-entry-stop/);
  assert.match(view, /attachVisitContentToStop/);
  assert.match(view, /detachVisitContentFromStop/);
  assert.match(view, /Presenta in/);
});

test("aggiunta manuale delle tappe è sempre visibile nel composer", () => {
  assert.match(view, /class="stop-builder"/);
  assert.match(view, /Aggiungi una tappa fisica/);
  assert.match(view, /Manca ancora una tappa fisica/);
  assert.match(view, /target-grid--scroll/);
  assert.doesNotMatch(view, /manual-stops/);
  assert.match(view, /data-add-stop/);
  assert.match(view, /data-remove-stop/);
});

test("logistica e pubblicazione restano domini separati", () => {
  assert.match(view, /data-visit-logistics/);
  assert.match(view, /preVisitNotes/);
  assert.match(view, /serializeRouteHints\(\)/);
  assert.doesNotMatch(view, /role:\s*["']logistics["']|itemType:\s*["']logistics["']/);
  assert.doesNotMatch(shell, /visit-logistics-editor/);
  assert.match(view, /availableOperation\(operationCode\)/);
  assert.match(view, /executeWorkspaceOperation/);
  assert.match(view, /La pubblicazione nel Catalogo è un passaggio commerciale separato/);
});
