const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  createView: "clients/marketplace/src/ui/editorial-collection-create-view.js",
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

test("collection creation makes graph sharing explicit and keeps a new graph as the default", () => {
  assert.match(source.createView, /graphMode = "new"/);
  assert.match(source.createView, /Crea un nuovo grafo/);
  assert.match(source.createView, /Riusa un grafo esistente/);
  assert.match(source.createView, /semanticGraphId/);
  assert.match(source.createView, /Le modifiche future alla bozza del grafo saranno condivise/);
  assert.match(source.createView, /in revisione o pubblicata continuerà però a usare la revisione che ha congelato/);
  assert.match(source.createView, /collectionUsageCount/);
});

test("reusable graph choices are backend-authoritative, scoped and paginated", () => {
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
