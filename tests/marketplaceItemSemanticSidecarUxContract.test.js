const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  sidecar: "clients/marketplace/src/ui/item-semantic-sidecar.js",
  main: "clients/marketplace/src/main.js",
  graph: "clients/marketplace/src/ui/semantic-graph-editor.js",
  repository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
  workspaceCss: "clients/marketplace/src/styles/context-workspace.css",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

function methodBody(text, methodName, nextMethodName) {
  const start = text.indexOf(`  async ${methodName}(`);
  assert.notEqual(start, -1, `Metodo ${methodName} mancante`);
  const end = text.indexOf(`\n  ${nextMethodName}`, start);
  assert.notEqual(end, -1, `Boundary successivo ${nextMethodName} mancante`);
  return text.slice(start, end);
}

test("Item semantic sidecar files pass the syntax gate", () => {
  for (const key of ["sidecar", "main", "graph", "repository"]) {
    const relative = paths[key];
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("Item editor mounts one contextual sidecar and reuses the canonical graph workspace", () => {
  assert.match(source.main, /item-semantic-sidecar\.js/);
  assert.match(source.sidecar, /Aggiungi collegamenti/);
  assert.match(source.sidecar, /artaround-semantic-graph-editor/);
  assert.match(source.sidecar, /graph\.configure\(/);
  assert.match(source.sidecar, /graph\.focusSubjectId = id\(this\.subject\)/);
  assert.match(source.workspaceCss, /workspace-sidecar-layer/);
  assert.match(source.workspaceCss, /workspace-sidecar-launcher/);
});

test("opening a collection never mutates graph membership and does not materialize the full graph", () => {
  const openGraph = methodBody(source.sidecar, "openGraph", "async addSubjectToGraph");
  assert.match(openGraph, /editorialRepository\.studio/);
  assert.match(source.sidecar, /focusedGraphProjection/);
  assert.match(source.sidecar, /editorialRepository\.graphNeighborhood/);
  assert.match(source.sidecar, /focusSubjectId: id\(this\.subject\)/);
  assert.match(source.sidecar, /error\?\.code === "GRAPH_SUBJECT_NOT_FOUND"/);
  assert.doesNotMatch(source.sidecar, /editorialRepository\.graph\(/);
  assert.doesNotMatch(openGraph, /addGraphSubject/);
  assert.match(openGraph, /subjectInGraph/);
});

test("adding the Item Subject is explicit and respects Collection containment", () => {
  const addSubject = methodBody(source.sidecar, "addSubjectToGraph", "onSubmit");
  assert.match(addSubject, /editorialRepository\.addGraphSubject/);
  assert.match(addSubject, /focusedGraphProjection/);
  assert.match(source.sidecar, /data-add-sidecar-subject/);
  assert.match(source.sidecar, /Aggiungi al grafo/);
  assert.match(source.sidecar, /soltanto se almeno un contenuto che lo rappresenta appartiene già alla Raccolta/);
  assert.match(source.sidecar, /data-open-sidecar-collection-content/);
  assert.match(source.sidecar, /section=content/);
  assert.doesNotMatch(source.sidecar, /createItemConnection|createEdition|setContentSpaceMembership|VenueTarget|physicalIntent/);
  assert.match(source.repository, /addGraphSubject/);
});

test("collection context is reused when present, otherwise the sidecar asks for an editable collection-local graph", () => {
  assert.match(source.sidecar, /itemParams\(\)\.get\("editorialContextId"\)/);
  assert.match(source.sidecar, /editorialRepository\.relationChoices/);
  assert.match(source.sidecar, /permissions\?\.canEditGraph/);
  assert.match(source.sidecar, /Scegli dove lavorare/);
  assert.match(source.sidecar, /Ogni Raccolta modifica soltanto il proprio grafo locale/);
  assert.doesNotMatch(source.sidecar, /sharedByCollections|grafo condiviso/);
});

test("semantic sidecar distinguishes Collection content membership from physical presence", () => {
  assert.match(source.sidecar, /aggiungi prima il contenuto/);
  assert.match(source.sidecar, /il grafo non può contenere Subject privi di contenuto nella Raccolta/);
  assert.doesNotMatch(source.sidecar, /non aggiunge contenuti alla raccolta|Il grafo è condiviso da/);
});

test("semantic sidecar does not resurrect the deleted Item-level connection authoring boundary", () => {
  assert.doesNotMatch(source.sidecar, /itemConnectionAuthoring|\/connections|connection-search/);
  assert.match(source.graph, /addGraphEdge/);
  assert.match(source.graph, /data-start-relation/);
});
