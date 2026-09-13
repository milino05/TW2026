const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/visit-authoring-view.js");
const contentDialogPath = path.join(root, "clients/marketplace/src/ui/visit-content-add-dialog.js");
const taskDialogPath = path.join(root, "clients/marketplace/src/ui/task-dialog.js");
const authoringRepositoryPath = path.join(root, "clients/marketplace/src/infrastructure/http/authoring-repository.js");
const shellPath = path.join(root, "clients/marketplace/src/ui/app-shell.js");
const servicePath = path.join(root, "services/visitAuthoringV2.service.js");
const commandPath = path.join(root, "services/visitAuthoringCommandV2.service.js");
const placementServicePath = path.join(root, "services/visitPlacementOptionsV2.service.js");
const sequenceDomainPath = path.join(root, "services/visitSequenceV2.service.js");
const sequenceCommandPath = path.join(root, "services/visitAuthoringSequenceCommandV2.service.js");
const sequenceRepositoryPath = path.join(root, "clients/marketplace/src/infrastructure/http/visit-sequence-repository.js");
const sessionPlanPath = path.join(root, "services/sessionPlanV2.service.js");
const routesPath = path.join(root, "routes/visitsV2.routes.js");
const controllerPath = path.join(root, "controllers/visitsV2.controller.js");
const view = fs.readFileSync(viewPath, "utf8");
const contentDialog = fs.readFileSync(contentDialogPath, "utf8");
const taskDialog = fs.readFileSync(taskDialogPath, "utf8");
const authoringRepository = fs.readFileSync(authoringRepositoryPath, "utf8");
const shell = fs.readFileSync(shellPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const commands = fs.readFileSync(commandPath, "utf8");
const placementService = fs.readFileSync(placementServicePath, "utf8");
const sequenceDomain = fs.readFileSync(sequenceDomainPath, "utf8");
const sequenceCommands = fs.readFileSync(sequenceCommandPath, "utf8");
const sequenceRepository = fs.readFileSync(sequenceRepositoryPath, "utf8");
const sessionPlan = fs.readFileSync(sessionPlanPath, "utf8");
const routes = fs.readFileSync(routesPath, "utf8");
const controller = fs.readFileSync(controllerPath, "utf8");

test("visit authoring boundary passa il syntax gate", () => {
  for (const target of [viewPath, contentDialogPath, taskDialogPath, authoringRepositoryPath, shellPath, servicePath, commandPath, placementServicePath, sequenceDomainPath, sequenceCommandPath, sequenceRepositoryPath, sessionPlanPath, routesPath, controllerPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("visit authoring espone cinque passaggi con composer della sequenza", () => {
  for (const label of ["Informazioni", "Costruisci la visita", "Impostazioni", "Percorso", "Pubblicazione"]) assert.match(view, new RegExp(label));
  assert.match(view, /const stages = \[\[1, "Informazioni"\], \[2, "Costruisci la visita"\], \[3, "Impostazioni"\], \[4, "Percorso"\], \[5, "Pubblicazione"\]\]/);
  assert.match(view, /grid-template-columns:repeat\(5/);
  assert.match(view, /aria-label="Passaggi di creazione della visita"/);
});

test("la modalità sincronizzata estende i cinque step senza creare un altro wizard", () => {
  assert.match(view, /Visita sincronizzata/);
  assert.match(view, /deliveryMode:\s*synchronized \? "synchronized" : "self_guided"/);
  assert.match(view, /name="joinAlias"/);
  assert.match(view, /data-add-quiz-question/);
  assert.match(view, /data-quiz-question/);
  assert.match(view, /data-quiz-option/);
  assert.match(view, /data-quiz-correct/);
  assert.match(view, /synchronized \? this\.renderQuizEditor\(\) : ""/);
  assert.doesNotMatch(view, /\[6,\s*"/);
});

test("Costruisci la visita rende dominante la sequenza e apre un selettore modale", () => {
  assert.match(view, /data-open-visit-content/);
  assert.match(view, /Aggiungi contenuti/);
  assert.match(view, /visit-selection-pane/);
  assert.match(view, /renderVisitSequence\(\)/);
  assert.match(view, /Organizza contenuti e tappe/);
  assert.doesNotMatch(view, /available-content-pane/);
  assert.doesNotMatch(view, /renderContentSearch/);
  assert.doesNotMatch(view, /pendingOccurrence/);
});

test("selettore contenuti riusa Task Modal e primitive visuali condivise", () => {
  assert.match(contentDialog, /createTaskDialog/);
  assert.match(contentDialog, /size:\s*"large"/);
  assert.match(contentDialog, /task-selection-layout/);
  assert.match(contentDialog, /task-selection-toolbar/);
  assert.match(contentDialog, /task-resource-choice-list/);
  assert.match(contentDialog, /task-resource-choice/);
  assert.match(taskDialog, /artaround-task-modal/);
  assert.match(contentDialog, /data-content-access="owned"/);
  assert.match(contentDialog, /data-content-access="acquired"/);
  assert.match(contentDialog, /data-source-filter/);
  assert.match(contentDialog, /data-content-page/);
});

test("selezione contenuti è multipla e l'importanza iniziale resta consigliata", () => {
  assert.match(contentDialog, /selected = new Map\(\)/);
  assert.match(contentDialog, /data-content-choice/);
  assert.match(contentDialog, /role:\s*"recommended"/);
  assert.match(contentDialog, /entries/);
  assert.match(view, /data-entry-role/);
});

test("lo stesso contenuto non può essere aggiunto due volte", () => {
  assert.match(contentDialog, /authoringRepository\.visitProjection/);
  assert.match(contentDialog, /includedRevisionIds/);
  assert.match(contentDialog, /Già nella visita/);
  assert.match(contentDialog, /alreadyIncluded \? "disabled"/);
  assert.match(commands, /assertNoDuplicateContentRevisions/);
  assert.match(commands, /VISIT_CONTENT_ALREADY_INCLUDED/);
});

test("collocazione fisica è suggerita in lettura ma resta una decisione esplicita", () => {
  assert.match(service, /placementOptions/);
  assert.match(service, /resolvePublishedOccurrencesForSubjects/);
  assert.match(placementService, /resolveVenueTargetExhibit/);
  assert.match(contentDialog, /value="contextual"/);
  assert.match(contentDialog, /value="physical"/);
  assert.match(contentDialog, /data-placement-target/);
  assert.match(commands, /VISIT_CONTENT_PLACEMENT_REQUIRED/);
  assert.match(commands, /assertPublishedTargetForSubject/);
  assert.match(commands, /ensureAnchorForTarget/);
  assert.doesNotMatch(commands, /VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED/);
  assert.doesNotMatch(commands, /status:\s*"inferred"/);
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

test("la collocazione della card è reversibile senza rimuovere il contenuto", () => {
  assert.match(view, /data-entry-placement/);
  assert.match(view, /Collocazione/);
  assert.match(view, /Contesto generale/);
  assert.match(view, /physical:/);
  assert.match(view, /authoringRepository\.setVisitContentPlacement/);
  assert.match(authoringRepository, /setVisitContentPlacement\(visitId, contentEntryId, placement\)/);
  assert.match(authoringRepository, /content\/\$\{encodeURIComponent\(contentEntryId\)\}\/placement/);
  assert.match(routes, /commands\/content\/:contentEntryId\/placement/);
  assert.match(controller, /authoringCommandService\.setContentPlacement/);
  assert.match(commands, /async function setContentPlacement/);
  assert.match(commands, /cleanupOrphanAnchor/);
  assert.match(commands, /entry\.deliveryAnchorId = null/);
  assert.match(commands, /ensureAnchorForTarget/);
  assert.doesNotMatch(view, /data-entry-stop/);
  assert.doesNotMatch(view, /attachVisitContentToStop|detachVisitContentFromStop/);
  assert.doesNotMatch(authoringRepository, /attachVisitContentToStop|detachVisitContentFromStop/);
  assert.doesNotMatch(routes, /content\/:contentEntryId\/stop/);
});

test("riordino conserva fallback accessibili mentre le tappe restano una proiezione dei contenuti", () => {
  assert.match(view, /aria-label="Sposta contenuto prima"/);
  assert.match(view, /aria-label="Sposta contenuto dopo"/);
  assert.match(view, /aria-label="Sposta tappa prima"/);
  assert.match(view, /aria-label="Sposta tappa dopo"/);
  assert.match(view, /data-remove-stop/);
  assert.match(view, /Manca ancora una tappa fisica/);
});

test("le nuove tappe fisiche non hanno un browser autonomo di VenueTarget", () => {
  assert.match(contentDialog, /value="physical"/);
  assert.match(contentDialog, /data-placement-target/);
  assert.doesNotMatch(view, /renderManualStopBrowser/);
  assert.doesNotMatch(view, /class="stop-builder"/);
  assert.doesNotMatch(view, /Aggiungi una tappa fisica/);
  assert.doesNotMatch(view, /data-add-stop/);
  assert.doesNotMatch(view, /authoringRepository\.venueTargets/);
  assert.doesNotMatch(view, /selectedVenueId|venueTargets\s*=/);
  assert.doesNotMatch(routes, /commands\/stops"/);
  assert.doesNotMatch(routes, /stops\/:anchorId\/content/);
});

test("il repository espone ancora la projection generica delle entità fisiche della sede", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        venue: { id: "venue/1", name: "Sede test" },
        targets: [{ id: "target-1", label: "Opera esposta", description: "Sala A" }],
      }),
    };
  };
  try {
    const repositoryUrl = `${pathToFileURL(authoringRepositoryPath).href}?visit-targets-contract`;
    const { authoringRepository: repository } = await import(repositoryUrl);
    const projection = await repository.venueTargets("venue/1");
    assert.equal(requestedUrl, "/api/v2/marketplace/discovery/venues/venue%2F1");
    assert.deepEqual(projection.targets, [{ id: "target-1", label: "Opera esposta", description: "Sala A" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
