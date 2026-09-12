const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  createView: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  importDialog: "clients/marketplace/src/ui/collection-graph-import-dialog.js",
  studio: "clients/marketplace/src/ui/editorial-studio-view.js",
  repository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
  marketplaceRoute: "routes/marketplaceV2.routes.js",
  editorialRoutes: "routes/editorialContexts.routes.js",
  controller: "controllers/marketplaceAuthoringV2.controller.js",
  service: "services/editorialStudioCreationV2.service.js",
  importService: "services/editorialGraphImport.service.js",
  suppressionModel: "models/editorialGraphEdgeSuppression.model.js",
  sourceModel: "models/editorialGraphImportSource.model.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));
const styles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/semantic-sources.css"), "utf8");

test("semantic source authoring files pass the syntax gate", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("collection creation always creates a local graph without exposing source internals in the UI", () => {
  assert.match(source.createView, /Crea Raccolta/);
  assert.doesNotMatch(source.createView, /Grafo locale indipendente|aggiungere una o più sorgenti|Importa da un grafo esistente|data-collection-graph-action|graphSelection|semanticGraphId|importItemIds|graphMode/);
  assert.match(source.service, /assertCreationPayloadIsLocalOnly/);
  assert.match(source.service, /displayName: `\$\{displayName\} · grafo`/);
  assert.match(source.service, /localToCollection: true/);
  assert.doesNotMatch(source.service, /projectSourceSnapshot/);
});

test("source discovery is backend-authoritative and excludes local and already pinned graphs before pagination", () => {
  assert.match(source.importDialog, /localSemanticGraphId/);
  assert.match(source.importDialog, /this\.sources\.map\(\(entry\) => id\(entry\.sourceSemanticGraphId\)\)/);
  assert.match(source.repository, /excludeSemanticGraphIds/);
  assert.match(source.controller, /excludeSemanticGraphIds: commaSeparatedValues/);
  assert.match(source.service, /excludeSemanticGraphIds = \[\]/);
  assert.match(source.service, /\$nin: excludedIds/);
  assert.match(source.marketplaceRoute, /\/v2\/marketplace\/semantic-graphs/);
});

test("relations workspace keeps semantic source management behind one modal entry point", () => {
  assert.match(source.studio, /data-manage-semantic-sources/);
  assert.match(source.studio, /Gestisci sorgenti<\/button>/);
  assert.match(source.studio, /openSourceManager/);
  assert.doesNotMatch(source.studio, /studio-source-manager|studio-source-grid|data-add-semantic-source|data-import-source-id|data-update-source-id|data-detach-source-id/);
  assert.doesNotMatch(source.studio, /Grafo locale<\/span><h2>Collegamenti della Raccolta|Questo è l'unico grafo modificabile/);
  assert.match(source.studio, /<artaround-semantic-graph-editor><\/artaround-semantic-graph-editor>/);
});

test("source manager reuses clickable cards plus an add card and navigates inside one modal", () => {
  assert.match(source.importDialog, /view = "list"/);
  assert.match(source.importDialog, /source-manager-grid/);
  assert.match(source.importDialog, /data-source-manager-source-id/);
  assert.match(source.importDialog, /source-manager-card--add/);
  assert.match(source.importDialog, /data-source-manager-add/);
  assert.match(source.importDialog, /data-source-manager-back/);
  assert.match(source.importDialog, /this\.view === "detail"/);
  assert.match(source.importDialog, /this\.view === "add"/);
  assert.match(source.importDialog, /this\.view === "import"/);
  assert.match(source.importDialog, /this\.view === "restorable"/);
  assert.match(source.importDialog, /role="dialog" aria-modal="true" aria-label="Gestisci sorgenti"/);
  assert.doesNotMatch(source.importDialog, /openActionDialog/);
  assert.match(styles, /\.source-manager-card/);
  assert.match(styles, /\.source-manager-card--add/);
});

test("pinning and content import stay distinct operations inside source management", () => {
  assert.match(source.importDialog, /attachGraphImportSource/);
  assert.match(source.importDialog, /importGraphSubjects/);
  assert.match(source.importDialog, /data-source-manager-import/);
  assert.match(source.importDialog, /Importa contenuti/);
  assert.doesNotMatch(source.importDialog, /Aggiungi solo la sorgente|submitImport\(\[\]\)/);
});

test("source pins are unique by graph, explicitly updatable and non-destructive on detach", () => {
  assert.match(source.sourceModel, /editorialContextId: 1, sourceSemanticGraphId: 1/);
  assert.doesNotMatch(source.sourceModel, /suppressedEdgeKeys/);
  assert.match(source.importService, /updateEditorialGraphImportSource/);
  assert.match(source.importService, /previewEditorialGraphImportSourceUpdate/);
  assert.match(source.importService, /detachEditorialGraphImportSource/);
  assert.match(source.editorialRoutes, /update-preview/);
  assert.match(source.editorialRoutes, /import-sources\/:sourceId\/update/);
  assert.match(source.repository, /graphImportSourceUpdatePreview/);
  assert.match(source.repository, /detachGraphImportSource/);
  assert.match(source.importDialog, /I contenuti e i collegamenti già presenti nella Raccolta resteranno invariati/);
  assert.match(source.importDialog, /data-source-manager-confirm-update/);
  assert.match(source.importDialog, /data-source-manager-confirm-detach/);
});

test("multi-source import materializes union knowledge without overwriting local classifications", () => {
  assert.match(source.importService, /materializeEligiblePinnedEdges/);
  assert.match(source.importService, /pinnedSources \|\| await loadPinnedSources/);
  assert.match(source.importService, /canonicalEdgeKey/);
  assert.match(source.importService, /classificationConflict/);
  assert.match(source.importService, /if \(currentSubjectIds\.has\(subjectId\)\) continue/);
  assert.match(source.importDialog, /La classificazione locale verrà mantenuta/);
});

test("restorable source-supported edges live in the source manager, not beside the local canvas", () => {
  assert.match(source.suppressionModel, /editorial_graph_edge_suppressions/);
  assert.match(source.suppressionModel, /editorialContextId: 1, edgeKey: 1/);
  assert.match(source.importService, /upsertLocalEdgeSuppression/);
  assert.match(source.importService, /listRestorableEditorialGraphEdges/);
  assert.match(source.importService, /restoreEditorialGraphEdge/);
  assert.match(source.editorialRoutes, /restorable-edges/);
  assert.match(source.repository, /restorableGraphEdges/);
  assert.match(source.repository, /restoreGraphEdge/);
  assert.match(source.importDialog, /Collegamenti ripristinabili/);
  assert.match(source.importDialog, /data-source-manager-restorable/);
  assert.match(source.importDialog, /data-source-manager-restore-edge/);
  assert.match(source.importDialog, />Ripristina<\/button>/);
  assert.doesNotMatch(source.studio, /Collegamenti esclusi dal grafo locale|data-restore-edge-id/);
});
