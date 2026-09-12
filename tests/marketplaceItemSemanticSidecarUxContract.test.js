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
  relationController: "controllers/marketplaceAuthoringV2.controller.js",
  relationService: "services/editorialRelationLauncherV2.service.js",
  collectionNeighborhood: "services/editorialCollectionGraphNeighborhood.service.js",
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

test("Collection choice is backend-filtered by Subject coverage before pagination", () => {
  assert.match(source.launcher, /editorialRepository\.relationChoices\(\{[\s\S]*subjectId/);
  assert.match(source.repository, /relationChoices\(\{[^}]*subjectId = null/);
  assert.match(source.repository, /queryString\(\{ ownerType, ownerId, subjectId, q, page, limit \}\)/);
  assert.match(source.relationController, /subjectId: req\.query\?\.subjectId \|\| null/);
  assert.match(source.relationService, /collectionIdsRepresentingSubject/);
  assert.match(source.relationService, /primarySubjectId: subjectId/);
  assert.match(source.relationService, /CollectionItemMembership\.distinct\("editorialContextId"/);
  assert.match(source.relationService, /filter\._id = \{ \$in: eligibleContextIds \}/);
  assert.match(source.relationService, /EditorialContext\.countDocuments\(filter\)/);
  assert.match(source.relationService, /\.skip\(\(normalizedPage - 1\) \* normalizedLimit\)/);
});

test("focused Item opens the canonical Collection graph through virtual focus without launcher materialization", () => {
  assert.match(source.launcher, /editorialRepository\.studio/);
  assert.match(source.launcher, /editorialRepository\.graphNeighborhood/);
  assert.match(source.launcher, /focusSubjectId: id\(this\.subject\)/);
  assert.match(source.collectionNeighborhood, /implicitFromCollection: true/);
  assert.match(source.collectionNeighborhood, /inGraph: false/);
  assert.match(source.collectionNeighborhood, /virtualFocus: true/);
  assert.match(source.launcher, /\/workspace\/semantic-graph\?/);
  assert.match(source.launcher, /returnTo/);
  assert.doesNotMatch(source.launcher, /editorialRepository\.graph\(/);
  assert.doesNotMatch(source.launcher, /editorialRepository\.addGraphSubject|data-add-relation-subject|state = "membership"|renderMembershipPrompt/);
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
