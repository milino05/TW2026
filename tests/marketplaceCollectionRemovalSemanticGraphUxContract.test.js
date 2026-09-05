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

test("collection removal UI describes SemanticGraph preservation instead of relation loss", () => {
  assert.match(workspace, /semanticGraphRelationCount/);
  assert.match(workspace, /semanticGraphCollectionCount/);
  assert.match(workspace, /Il grafo semantico viene conservato/);
  assert.match(workspace, /non vengono eliminate/);
  assert.match(workspace, /Potrà essere riutilizzato/);
  assert.doesNotMatch(workspace, /collegamenti dovranno essere ricreati/);
  assert.doesNotMatch(workspace, /puoi perdere molti collegamenti/);
  assert.doesNotMatch(workspace, /affectedConnectionCount/);
});

test("collection removal impact follows SemanticGraph ownership and never trashes the graph", () => {
  assert.match(removal, /SemanticGraph\.findOne/);
  assert.match(removal, /semanticGraphRelationCount/);
  assert.match(removal, /semanticGraphCollectionCount/);
  assert.doesNotMatch(removal, /workingGraphRevisionId/);
  assert.doesNotMatch(removal, /SemanticGraph\.findOneAndUpdate|SemanticGraph\.updateOne|SemanticGraph\.delete/);
});

test("collection removal UX files pass the syntax gate", () => {
  for (const file of [workspacePath, removalPath]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, file)}: ${result.stderr || result.stdout}`);
  }
});
