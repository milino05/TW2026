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
const view = fs.readFileSync(viewPath, "utf8");
const shell = fs.readFileSync(shellPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const commands = fs.readFileSync(commandPath, "utf8");

test("visit authoring boundary passa il syntax gate", () => {
  for (const target of [viewPath, shellPath, servicePath, commandPath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("visit authoring espone i sei passaggi stop-centric", () => {
  for (const label of ["Informazioni", "Contenuti", "Tappe", "Impostazioni", "Percorso", "Pubblicazione"]) assert.match(view, new RegExp(label));
  assert.match(view, /aria-label="Passaggi di creazione della visita"/);
  assert.match(view, /aria-current="\$\{current \? "step" : "false"\}"/);
});

test("contenuti persistenti e tappe restano distinti dietro una UX stop-centric", () => {
  assert.match(view, /data-add-content/);
  assert.match(view, /activeContentStopId/);
  assert.match(view, /addVisitContentToStop/);
  assert.match(view, /data-attach-contextual/);
  assert.match(view, /data-detach-content/);
  assert.match(view, /I contenuti restano entità editoriali separate/);
  assert.doesNotMatch(view, /ensureReferences|matchingTarget\(result\)/);
});

test("l'inferenza Subject -> VenueTarget resta backend-authoritative e non indovina ambiguità", () => {
  assert.match(service, /ItemV2\.find\([\s\S]*primarySubjectId/);
  assert.match(service, /primarySubjectId:\s*item\?\.primarySubjectId\s*\|\|\s*null/);
  assert.match(commands, /publishedOccurrenceCandidates/);
  assert.match(commands, /VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED/);
  assert.match(commands, /ensureAnchorForTarget/);
  assert.match(view, /pendingOccurrence/);
  assert.match(view, /data-occurrence-target/);
});

test("sequenza delle tappe, ruoli e contenuti mantengono controlli accessibili", () => {
  assert.match(view, /data-move-stop/);
  assert.match(view, /aria-label="Sposta prima"/);
  assert.match(view, /aria-label="Sposta dopo"/);
  assert.match(view, /data-remove-content/);
  assert.match(view, /value="core"[\s\S]*Essenziale/);
  assert.match(view, /value="recommended"[\s\S]*Consigliato/);
  assert.match(view, /value="optional"[\s\S]*Facoltativo/);
  assert.match(view, /searchVisitContent/);
  assert.match(view, /data-content-page/);
});

test("rimozione tappe protegge contenuti e route hint", () => {
  assert.match(view, /data-remove-stop/);
  assert.match(view, /restano nella visita come contestuali/);
  assert.match(commands, /deliveryAnchorId:\s*null/);
  assert.match(commands, /hint\.fromAnchorId/);
  assert.match(commands, /hint\.toAnchorId/);
});

test("logistica e contenuti restano domini separati nella stessa UX", () => {
  assert.match(view, /data-visit-logistics/);
  assert.match(view, /preVisitNotes/);
  assert.match(view, /serializeRouteHints\(\)/);
  assert.match(view, /data-visit-logistics[\s\S]*serializeRouteHints\(\)/);
  assert.doesNotMatch(view, /role:\s*["']logistics["']|itemType:\s*["']logistics["']/);
  assert.doesNotMatch(shell, /visit-logistics-editor/);
  assert.match(shell, /artaround-visit-authoring-view/);
});

test("workflow resta backend-authoritative e senza prompt nativi", () => {
  assert.match(view, /availableOperation\(operationCode\)/);
  assert.match(view, /executeWorkspaceOperation/);
  assert.match(view, /resourceType:\s*"visit"/);
  assert.match(view, /data-workflow-form/);
  assert.match(view, /name="message"/);
  assert.match(view, /Controlla se è tutto pronto/);
  assert.doesNotMatch(view, /window\.prompt\(/);
});

test("pubblicazione editoriale e catalogo restano lifecycle distinti", () => {
  assert.match(view, /La pubblicazione nel Catalogo è un passaggio commerciale separato/);
  assert.match(view, /Pubblicare editorialmente non crea automaticamente una scheda nel Marketplace/);
});
