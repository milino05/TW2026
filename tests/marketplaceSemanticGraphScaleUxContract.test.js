const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const editor = read("clients/marketplace/src/ui/semantic-graph-editor.js");
const repository = read("clients/marketplace/src/infrastructure/http/editorial-repository.js");
const graphService = read("services/editorialContextGraph.service.js");
const routes = read("routes/editorialContexts.routes.js");

test("Graph Workspace usa neighborhood server-side invece dello snapshot completo", () => {
  assert.match(editor, /editorialRepository\.graphNeighborhood/);
  assert.doesNotMatch(editor, /editorialRepository\.graph\(this\.editorialContextId/);
  assert.match(repository, /semantic-graph\/neighborhood/);
  assert.match(routes, /semantic-graph\/neighborhood/);
  assert.match(graphService, /getEditorialContextGraphNeighborhood/);
  assert.match(graphService, /totalNeighbors/);
  assert.match(graphService, /hiddenNeighbors/);
});

test("inventario semantico è ricercabile e paginato sul server", () => {
  assert.match(editor, /scope:\s*"graph"/);
  assert.match(editor, /data-semantic-inventory-search/);
  assert.match(editor, /data-semantic-inventory-page/);
  assert.match(graphService, /\["graph", "collection", "space"\]/);
  assert.match(graphService, /relationCount/);
  assert.match(graphService, /presentationCoverage/);
});
