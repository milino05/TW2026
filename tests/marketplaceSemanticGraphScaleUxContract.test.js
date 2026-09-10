const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const editor = read("clients/marketplace/src/ui/semantic-graph-editor.js");
const repository = read("clients/marketplace/src/infrastructure/http/editorial-repository.js");
const graphService = read("services/editorialContextGraph.service.js");
const relationCommand = read("services/editorialCollectionRelationCommand.service.js");
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

test("focus resta nella Raccolta mentre il target può usare contenuti dello Spazio con commit atomico", () => {
  assert.match(editor, /this\.pickerMode === "target" \? "space" : "collection"/);
  assert.match(editor, /Cerca tra i contenuti dello Spazio editoriale/);
  assert.match(editor, /targetItemCandidates/);
  assert.match(editor, /name="targetItemId"/);
  assert.match(editor, /Aggiungi contenuto e crea relazione/);
  assert.match(graphService, /\["graph", "collection", "space"\]/);
  assert.match(graphService, /itemCandidates/);
  assert.match(graphService, /projectItemCandidates/);
  assert.match(relationCommand, /mongoose\.connection\.transaction/);
  assert.match(relationCommand, /CollectionItemMembership\.create/);
  assert.match(relationCommand, /writeSemanticGraphSnapshot/);
  assert.match(relationCommand, /COLLECTION_GRAPH_TARGET_ITEM_SELECTION_REQUIRED/);
});

test("click modifica, doppio click ricentra e la tastiera offre un percorso equivalente", () => {
  assert.match(editor, /window\.setTimeout\([\s\S]*220/);
  assert.match(editor, /onDoubleClick/);
  assert.match(editor, /openSubjectEditor/);
  assert.match(editor, /openEdgeEditor/);
  assert.match(editor, /event\.key === "f" \|\| event\.key === "F"/);
  assert.match(editor, /\["Enter", " "\]\.includes\(event\.key\)/);
});

test("gli editor del grafo usano il modal blurred centrale e non inspector laterali", () => {
  assert.match(editor, /context-task-modal-layer semantic-graph-modal-layer/);
  assert.match(editor, /role="dialog" aria-modal="true"/);
  assert.match(editor, /data-graph-modal-backdrop/);
  assert.doesNotMatch(editor, /context-workspace-inspector-layer|semantic-subject-inspector|semantic-relation-inspector/);
});

test("il grafo resta leggibile su viewport strette, centra il focus ed evidenzia hover e focus-visible", () => {
  assert.match(editor, /renderedFocusSubjectId/);
  assert.match(editor, /Math\.max\(0, \(canvas\.scrollWidth - canvas\.clientWidth\) \/ 2\)/);
  assert.match(styles, /\.semantic-node:hover circle/);
  assert.match(styles, /\.semantic-node:focus-visible circle/);
  assert.match(styles, /\.semantic-node:hover,\.semantic-node:focus-visible\{transform:scale\(1\.[0-9]+\)\}/);
  assert.match(styles, /\.semantic-edge:hover line/);
  assert.match(styles, /\.semantic-edge:focus-visible line/);
  assert.match(styles, /@media\(max-width:54rem\)/);
  assert.match(styles, /\.semantic-graph-canvas\{min-height:28rem\}/);
});
