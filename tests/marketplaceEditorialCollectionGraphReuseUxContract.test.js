const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  createView: "clients/marketplace/src/ui/editorial-collection-create-view.js",
  graphDialog: "clients/marketplace/src/ui/collection-graph-dialog.js",
  repository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
  route: "routes/marketplaceV2.routes.js",
  controller: "controllers/marketplaceAuthoringV2.controller.js",
  service: "services/editorialStudioCreationV2.service.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

test("semantic graph reuse authoring files pass the syntax gate", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("collection creation makes new, shared and independent graph choices explicit without the legacy radio picker", () => {
  assert.match(source.createView, /Crea un nuovo grafo/);
  assert.match(source.createView, /Usa un grafo esistente/);
  assert.match(source.createView, /data-collection-graph-action="new"/);
  assert.match(source.createView, /data-collection-graph-action="existing"/);
  assert.match(source.createView, /graphSelection/);
  assert.match(source.createView, /semanticGraphId/);
  assert.doesNotMatch(source.createView, /semanticSource|reuseMode|type="radio"/);

  assert.match(source.graphDialog, /graphMode: "new"/);
  assert.match(source.graphDialog, /graphMode: "shared"/);
  assert.match(source.graphDialog, /graphMode: "fork"/);
  assert.match(source.graphDialog, /Crea una copia indipendente/);
  assert.match(source.graphDialog, /data-use-shared-graph/);
  assert.match(source.graphDialog, /data-start-graph-fork/);
  assert.match(source.graphDialog, /collectionUsageCount/);
  assert.match(source.graphDialog, /usedInCurrentSpace/);
});

test("reusable graph choices are backend-authoritative, scoped and paginated", () => {
  assert.match(source.graphDialog, /editorialRepository\.reusableSemanticGraphs/);
  assert.match(source.graphDialog, /ownerType: this\.config\.ownerType/);
  assert.match(source.graphDialog, /ownerId: this\.config\.ownerId/);
  assert.match(source.graphDialog, /namespaceId: this\.config\.namespaceId/);
  assert.match(source.graphDialog, /contentSpaceId: this\.config\.contentSpaceId/);
  assert.match(source.graphDialog, /page: this\.page/);
  assert.match(source.repository, /reusableSemanticGraphs/);
  assert.match(source.repository, /\/v2\/marketplace\/semantic-graphs/);
  assert.match(source.route, /\/v2\/marketplace\/semantic-graphs/);
  assert.match(source.controller, /listReusableSemanticGraphs/);
  assert.match(source.service, /permissionCode: "editorial_context\.create"/);
  assert.match(source.service, /ownerType,/);
  assert.match(source.service, /ownerId,/);
  assert.match(source.service, /namespaceId: namespace\._id/);
  assert.match(source.service, /collectionUsageCount/);
  assert.match(source.service, /pagination:/);
});
