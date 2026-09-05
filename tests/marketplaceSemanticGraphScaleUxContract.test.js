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
const styles = read("clients/marketplace/src/styles/editorial-studio.css");

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

test("il grafo resta leggibile su viewport strette e centra il nuovo focus", () => {
  assert.match(editor, /renderedFocusSubjectId/);
  assert.match(editor, /Math\.max\(0, \(canvas\.scrollWidth - canvas\.clientWidth\) \/ 2\)/);
  assert.match(styles, /@media\(max-width:54rem\)/);
  assert.match(styles, /\.workspace-page \.library-current-space>\.section-heading/);
  assert.match(styles, /\.studio-section>\.section-heading\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles, /\.semantic-graph-canvas\{min-height:28rem\}/);
});
