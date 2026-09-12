const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const paths = {
  launcher: "clients/marketplace/src/ui/item-semantic-relations-launcher.js",
  main: "clients/marketplace/src/main.js",
  graphView: "clients/marketplace/src/ui/semantic-graph-view.js",
  graphEditor: "clients/marketplace/src/ui/semantic-graph-editor.js",
  repository: "clients/marketplace/src/infrastructure/http/editorial-repository.js",
};
const source = Object.fromEntries(Object.entries(paths).map(([key, relative]) => [key, fs.readFileSync(path.join(root, relative), "utf8")]));

test("Item relations launcher files pass the syntax gate", () => {
  for (const relative of Object.values(paths)) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test("Item editor no longer mounts a sidecar and uses the shared Task Dialog selection flow", () => {
  assert.match(source.main, /item-semantic-relations-launcher\.js/);
  assert.doesNotMatch(source.main, /item-semantic-sidecar\.js/);
  assert.match(source.launcher, /createTaskDialog/);
  assert.match(source.launcher, /Aggiungi collegamenti/);
  assert.match(source.launcher, /Scegli dove lavorare/);
  assert.doesNotMatch(source.launcher, /workspace-sidecar/);
  assert.doesNotMatch(source.launcher, /artaround-semantic-graph-editor/);
});

test("collection choice prepares only the focused graph context before opening the full-page workspace", () => {
  assert.match(source.launcher, /editorialRepository\.relationChoices/);
  assert.match(source.launcher, /editorialRepository\.studio/);
  assert.match(source.launcher, /editorialRepository\.graphNeighborhood/);
  assert.match(source.launcher, /focusSubjectId: id\(this\.subject\)/);
  assert.match(source.launcher, /error\?\.code === "GRAPH_SUBJECT_NOT_FOUND"/);
  assert.match(source.launcher, /\/workspace\/semantic-graph\?/);
  assert.match(source.launcher, /returnTo/);
  assert.doesNotMatch(source.launcher, /editorialRepository\.graph\(/);
});

test("Subject materialization remains explicit and respects Collection content membership", () => {
  assert.match(source.launcher, /data-add-relation-subject/);
  assert.match(source.launcher, /editorialRepository\.addGraphSubject/);
  assert.match(source.launcher, /Puoi aggiungerlo soltanto se almeno un contenuto che lo rappresenta appartiene già alla Raccolta/);
  assert.match(source.launcher, /data-open-relation-collection-content/);
  assert.doesNotMatch(source.launcher, /createItemConnection|createEdition|setContentSpaceMembership|VenueTarget|physicalIntent/);
  assert.match(source.repository, /addGraphSubject/);
});

test("leaving Item authoring for relations preserves the local working draft and graph focus", () => {
  assert.match(source.launcher, /persistWorkingDraft/);
  assert.match(source.launcher, /focusSubjectId/);
  assert.match(source.graphView, /returnTo/);
  assert.match(source.graphView, /safeInternalReturn/);
  assert.match(source.graphView, /Torna al contenuto/);
});

test("semantic relation authoring continues through the canonical graph editor boundary", () => {
  assert.match(source.graphView, /artaround-semantic-graph-editor/);
  assert.match(source.graphEditor, /addGraphEdge/);
  assert.match(source.graphEditor, /data-start-relation/);
  assert.doesNotMatch(source.launcher, /itemConnectionAuthoring|\/connections|connection-search/);
});
