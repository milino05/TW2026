const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workspacePath = path.join(root, "clients/marketplace/src/ui/workspace-view.js");
const removalPath = path.join(root, "services/marketplaceResourceRemovalV2.service.js");
const workspace = fs.readFileSync(workspacePath, "utf8");
const removal = fs.readFileSync(removalPath, "utf8");

test("workspace resource detail still opens editorial collections in the current Studio", () => {
  assert.match(workspace, /\/workspace\/editorial-studio\?editorialContextId=/);
  assert.doesNotMatch(workspace, /\/workspace\/context-compose/);
});

test("collection removal UI explains local graph trashing and immutable release preservation", () => {
  assert.match(workspace, /semanticGraphRelationCount/);
  assert.match(workspace, /grafo locale/);
  assert.match(workspace, /revisioni immutabili/);
  assert.match(workspace, /release già pubblicate/);
  assert.doesNotMatch(workspace, /Potrà essere riutilizzato da un'altra raccolta/);
  assert.doesNotMatch(workspace, /collegamenti dovranno essere ricreati/);
  assert.doesNotMatch(workspace, /affectedConnectionCount/);
});

test("collection removal trashes the one-to-one local SemanticGraph while preserving its revisions", () => {
  assert.match(removal, /SemanticGraph\.findOne/);
  assert.match(removal, /semanticGraphRelationCount/);
  assert.match(removal, /semanticGraphCollectionCount/);
  assert.match(removal, /COLLECTION_GRAPH_NOT_LOCAL/);
  assert.match(removal, /SemanticGraph\.findOneAndUpdate/);
  assert.match(removal, /lifecycleStatus: "trashed"/);
  assert.doesNotMatch(removal, /SemanticGraphRevision\.delete|SemanticEdgeV2\.delete/);
});

test("collection removal UX files pass the syntax gate", () => {
  for (const file of [workspacePath, removalPath]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, file)}: ${result.stderr || result.stdout}`);
  }
});
