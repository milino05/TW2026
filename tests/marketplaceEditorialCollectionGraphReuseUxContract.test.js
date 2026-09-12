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

test("semantic source authoring files pass the syntax gate", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("collection creation always creates a local graph and never chooses a source", () => {
  assert.match(source.createView, /Grafo locale indipendente/);
  assert.match(source.createView, /Crea Raccolta/);
  assert.doesNotMatch(source.createView, /Importa da un grafo esistente|data-collection-graph-action|graphSelection|semanticGraphId|importItemIds|graphMode/);
  assert.match(source.service, /assertCreationPayloadIsLocalOnly/);
  assert.match(source.service, /displayName: `\$\{displayName\} · grafo`/);
  assert.match(source.service, /localToCollection: true/);
  assert.doesNotMatch(source.service, /projectSourceSnapshot/);
});

test("semantic source picker is backend-authoritative and excludes local/already pinned graphs before pagination", () => {
  assert.match(source.importDialog, /mode = "add-source"/);
  assert.match(source.importDialog, /excludeSemanticGraphIds: this\.config\.excludeSemanticGraphIds/);
  assert.match(source.repository, /excludeSemanticGraphIds/);
  assert.match(source.controller, /excludeSemanticGraphIds: commaSeparatedValues/);
  assert.match(source.service, /excludeSemanticGraphIds = \[\]/);
  assert.match(source.service, /\$nin: excludedIds/);
  assert.match(source.marketplaceRoute, /\/v2\/marketplace\/semantic-graphs/);
});

test("studio makes source pinning and content import distinct operations", () => {
  assert.match(source.studio, /Aggiungi sorgente/);
  assert.match(source.studio, /Importa contenuti/);
  assert.match(source.studio, /openAddSourceDialog/);
  assert.match(source.studio, /openImportContentsDialog/);
  assert.match(source.importDialog, /attachGraphImportSource/);
  assert.match(source.importDialog, /importGraphSubjects/);
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
  assert.match(source.studio, /Nessun contenuto o collegamento locale verrà eliminato automaticamente/);
});

test("multi-source import materializes union knowledge without overwriting local classifications", () => {
  assert.match(source.importService, /materializeEligiblePinnedEdges/);
  assert.match(source.importService, /pinnedSources \|\| await loadPinnedSources/);
  assert.match(source.importService, /canonicalEdgeKey/);
  assert.match(source.importService, /classificationConflict/);
  assert.match(source.importService, /if \(currentSubjectIds\.has\(subjectId\)\) continue/);
  assert.match(source.importDialog, /Classificazione sorgente diversa da quella locale/);
  assert.match(source.importDialog, /insieme di tutte le sorgenti pinzate/);
});

test("removed source-supported edges become local suppressions and remain restorable", () => {
  assert.match(source.suppressionModel, /editorial_graph_edge_suppressions/);
  assert.match(source.suppressionModel, /editorialContextId: 1, edgeKey: 1/);
  assert.match(source.importService, /upsertLocalEdgeSuppression/);
  assert.match(source.importService, /listRestorableEditorialGraphEdges/);
  assert.match(source.importService, /restoreEditorialGraphEdge/);
  assert.match(source.editorialRoutes, /restorable-edges/);
  assert.match(source.repository, /restorableGraphEdges/);
  assert.match(source.repository, /restoreGraphEdge/);
  assert.match(source.studio, /Collegamenti esclusi dal grafo locale/);
  assert.match(source.studio, />Ripristina</);
});
