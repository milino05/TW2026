const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const viewPath = path.join(root, "clients/marketplace/src/ui/visit-authoring-view.js");
const shellPath = path.join(root, "clients/marketplace/src/ui/app-shell.js");
const servicePath = path.join(root, "services/visitAuthoringV2.service.js");
const view = fs.readFileSync(viewPath, "utf8");
const shell = fs.readFileSync(shellPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");

test("visit authoring boundary passa il syntax gate", () => {
  for (const target of [viewPath, shellPath, servicePath]) {
    const result = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${target}: ${result.stderr || result.stdout}`);
  }
});

test("visit authoring espone i sei passaggi novice-first", () => {
  for (const label of ["Informazioni principali", "Contenuti", "Tappe", "Impostazioni", "Logistica", "Riepilogo e pubblicazione"]) assert.match(view, new RegExp(label));
  assert.match(view, /aria-label="Passaggi di creazione della visita"/);
  assert.match(view, /aria-current="\$\{current \? "step" : "false"\}"/);
});

test("contenuti e tappe sono due decisioni distinte", () => {
  assert.match(view, /data-add-content/);
  assert.match(view, /deliveryAnchorId:\s*null/);
  assert.match(view, /data-add-anchor/);
  assert.match(view, /data-entry-anchor/);
  assert.match(view, /Le tappe fisiche vengono gestite nel passaggio successivo/);
  assert.match(view, /Le tappe sono oggetti fisici della sede/);
  assert.doesNotMatch(view, /ensureReferences/);
  assert.doesNotMatch(view, /matchingTarget\(result\)/);
});

test("la projection rende persistente il suggerimento Subject -> VenueTarget", () => {
  assert.match(service, /ItemV2\.find\([\s\S]*primarySubjectId/);
  assert.match(service, /primarySubjectId:\s*item\?\.primarySubjectId\s*\|\|\s*null/);
  assert.match(view, /suggestedTargets\(\)/);
  assert.match(view, /entry\.primarySubjectId/);
});

test("sequenza e ruoli mantengono feature parity con microcopy accessibile", () => {
  assert.match(view, /data-move-entry/);
  assert.match(view, /Sposta prima/);
  assert.match(view, /Sposta dopo/);
  assert.match(view, /data-remove-entry/);
  assert.match(view, /value="core"[\s\S]*Essenziale/);
  assert.match(view, /value="recommended"[\s\S]*Consigliato/);
  assert.match(view, /value="optional"[\s\S]*Facoltativo/);
  assert.match(view, /searchVisitContent/);
  assert.match(view, /data-content-page/);
});

test("rimozione tappe protegge contenuti e route hint", () => {
  assert.match(view, /anchorRemovalBlockers\(anchorId\)/);
  assert.match(view, /entry\.deliveryAnchorId/);
  assert.match(view, /hint\.fromAnchorId/);
  assert.match(view, /hint\.toAnchorId/);
  assert.match(view, /data-remove-anchor/);
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
