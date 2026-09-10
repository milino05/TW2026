const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  createView: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  graphDialog: "clients/marketplace/src/ui/collection-graph-dialog.js",
  importDialog: "clients/marketplace/src/ui/collection-graph-import-dialog.js",
  repository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
  route: "routes/marketplaceV2.routes.js",
  controller: "controllers/marketplaceAuthoringV2.controller.js",
  service: "services/editorialStudioCreationV2.service.js",
  importService: "services/editorialGraphImport.service.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

test("semantic graph import authoring files pass the syntax gate", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("collection creation exposes only a new local graph or an imported source projection", () => {
  assert.match(source.createView, /Crea un nuovo grafo/);
  assert.match(source.createView, /Importa da un grafo esistente/);
  assert.match(source.createView, /data-collection-graph-action="new"/);
  assert.match(source.createView, /data-collection-graph-action="existing"/);
  assert.match(source.createView, /graphSelection/);
  assert.match(source.createView, /semanticGraphId/);
  assert.match(source.createView, /importItemIds/);
  assert.doesNotMatch(source.createView, /semanticSource|reuseMode|type="radio"/);

  assert.match(source.graphDialog, /graphMode: "new"/);
  assert.match(source.graphDialog, /graphMode: "import"/);
  assert.match(source.graphDialog, /semanticGraphImportPreview/);
  assert.match(source.graphDialog, /data-use-source-only/);
  assert.match(source.graphDialog, /data-import-all-direct/);
  assert.match(source.graphDialog, /data-import-subject-toggle/);
  assert.doesNotMatch(source.graphDialog, /graphMode: "shared"|graphMode: "fork"|data-use-shared-graph|data-start-graph-fork/);
});

test("reusable graph choices are backend-authoritative, scoped and expose import coverage", () => {
  assert.match(source.graphDialog, /editorialRepository\.reusableSemanticGraphs/);
  assert.match(source.graphDialog, /ownerType: this\.config\.ownerType/);
  assert.match(source.graphDialog, /ownerId: this\.config\.ownerId/);
  assert.match(source.graphDialog, /namespaceId: this\.config\.namespaceId/);
  assert.match(source.graphDialog, /contentSpaceId: this\.config\.contentSpaceId/);
  assert.match(source.graphDialog, /page: this\.page/);
  assert.match(source.repository, /reusableSemanticGraphs/);
  assert.match(source.repository, /semanticGraphImportPreview/);
  assert.match(source.repository, /graphImportSources/);
  assert.match(source.repository, /importGraphSubjects/);
  assert.match(source.route, /\/v2\/marketplace\/semantic-graphs/);
  assert.match(source.controller, /listReusableSemanticGraphs/);
  assert.match(source.service, /allowedValues: \["new", "import"\]/);
  assert.match(source.service, /EditorialGraphImportSource/);
  assert.match(source.service, /ambiguousSubjectCount/);
  assert.match(source.importService, /status = "ambiguous"/);
  assert.match(source.importService, /sourceGraphRevisionId/);
});

test("studio import dialog treats source-only, selected and bulk selection as explicit operations", () => {
  assert.match(source.importDialog, /context-task-modal-layer/);
  assert.match(source.importDialog, /collectionGraphImportPreview/);
  assert.match(source.importDialog, /attachGraphImportSource/);
  assert.match(source.importDialog, /importGraphSubjects/);
  assert.match(source.importDialog, /data-select-direct-imports/);
  assert.match(source.importDialog, /data-attach-source-only/);
  assert.match(source.importDialog, /Importa selezionati/);
  assert.doesNotMatch(source.importDialog, /changeCollectionGraph|graphMode:\s*"shared"|graphMode:\s*"fork"/);
});
