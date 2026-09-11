const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const editor = read("clients/marketplace/src/ui/semantic-graph-editor.js");
const graphView = read("clients/marketplace/src/ui/semantic-graph-view.js");
const subjectBrowser = read("clients/marketplace/src/ui/semantic-subject-source-browser.js");
const relationViews = read("clients/marketplace/src/ui/semantic-relation-views.js");
const repository = read("clients/marketplace/src/infrastructure/http/editorial-repository.js");
const graphService = read("services/editorialContextGraph.service.js");
const collectionNeighborhood = read("services/editorialCollectionGraphNeighborhood.service.js");
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
  assert.match(collectionNeighborhood, /implicitFromCollection:\s*true/);
  assert.match(collectionNeighborhood, /virtualFocus:\s*true/);
  assert.match(collectionNeighborhood, /inGraph:\s*false/);
});

test("il comando Collection collega endpoint canonici in modo neutro e aggiunge contenuti atomici", () => {
  assert.match(editor, /subjectItemSelections/);
  assert.match(editor, /canonicalEndpoints/);
  assert.match(editor, /Aggiungi contenuto e crea relazione/);
  assert.match(graphService, /\["graph", "collection", "space"\]/);
  assert.match(graphService, /itemCandidates/);
  assert.match(graphService, /projectItemCandidates/);
  assert.match(relationCommand, /mongoose\.connection\.transaction/);
  assert.match(relationCommand, /CollectionItemMembership\.insertMany/);
  assert.match(relationCommand, /writeSemanticGraphSnapshot/);
  assert.match(relationCommand, /COLLECTION_GRAPH_SUBJECT_ITEM_SELECTION_REQUIRED/);
  assert.match(relationCommand, /COLLECTION_GRAPH_ANCHOR_REQUIRED/);
});

test("il Subject Browser applica la compatibilità prima della paginazione", () => {
  assert.match(subjectBrowser, /requiredClassDefinitionIds: this\.requiredClassIds/);
  assert.match(repository, /requiredClassDefinitionIds/);
  assert.match(graphService, /filterCandidateSubjectIdsByClasses/);
  assert.match(graphService, /includeUnclassified/);
});

test("relation-first e target-first convergono nello stesso relation flow", () => {
  assert.match(editor, /entryMode: "relation-first"/);
  assert.match(editor, /entryMode: "target-first"/);
  assert.match(editor, /startRelationFirst/);
  assert.match(editor, /startTargetFirst/);
  assert.match(editor, /renderRelationPicker/);
  assert.match(editor, /renderRelationConfirmation/);
  assert.match(editor, /data-browse-subjects/);
  assert.match(editor, /Esplora soggetti/);
  assert.match(subjectBrowser, /data-browser-action="focus"/);
  assert.match(subjectBrowser, /data-browser-action="connect"/);
  assert.match(subjectBrowser, /Nella raccolta/);
  assert.match(subjectBrowser, /Nello spazio editoriale/);
});

test("relation-first standalone riusa l'inventario del grafo senza dipendere da una Raccolta", () => {
  assert.match(editor, /openStandaloneRelationTarget/);
  assert.match(editor, /this\.pickerMode = "relation-target"/);
  assert.match(editor, /editorialRepository\.semanticGraphSubjects/);
  assert.match(editor, /\["focus", "target", "relation-target"\]\.includes\(this\.pickerMode\)/);
  assert.match(editor, /this\.pickerMode === "relation-target" && this\.relationFlow/);
  assert.match(editor, /Scegli il soggetto da collegare/);
});

test("la UI usa viste semantiche dirette, reverse e simmetriche senza duplicare gli edge", () => {
  assert.match(relationViews, /direction: "reverse"/);
  assert.match(relationViews, /direction: "symmetric"/);
  assert.match(relationViews, /canonicalEndpoints/);
  assert.match(relationViews, /edgeViewForFocus/);
  assert.match(editor, /edgeViewForFocus/);
  assert.match(editor, /semantic-edge--\$\{escapeHtml\(viewed\.direction\)\}/);
  assert.match(styles, /\.semantic-edge--symmetric>path/);
  assert.doesNotMatch(editor, />[^<]*(?:relazione inversa|relazione fittizia|relazione generata)[^<]*</i);
});

test("il focus appartiene al workspace parent e sopravvive ai reload del grafo", () => {
  assert.match(editor, /semantic-graph-focus-changed/);
  assert.match(graphView, /semantic-graph-focus-changed/);
  assert.match(graphView, /params\.set\("focusSubjectId"/);
  assert.match(graphView, /initialFocusSubjectId: this\.focusSubjectId/);
  assert.match(editor, /this\.data = await this\.fetchNeighborhood\(\)/);
});

test("la classificazione progressiva non è un prerequisito rigido e in read-only non simula un'azione", () => {
  assert.match(editor, /data-classification-prompt/);
  assert.match(editor, /data-skip-classification/);
  assert.match(editor, /Categoria non assegnata/);
  assert.match(editor, /subjectClassAssignments/);
  assert.match(editor, /classesNeeded/);
  assert.match(editor, /if \(!this\.editable \|\| this\.locked\) return `<span class="semantic-class-missing semantic-class-missing--readonly">Categoria non assegnata<\/span>`/);
  assert.match(editor, /if \(!this\.editable \|\| this\.locked\) return;[\s\S]*classificationPromptSubjectId/);
  assert.match(styles, /\.semantic-class-missing--readonly\{cursor:default;text-decoration:none\}/);
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
