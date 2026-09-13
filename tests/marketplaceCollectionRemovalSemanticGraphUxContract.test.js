const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workspacePath = path.join(root, "clients/marketplace/src/ui/workspace-view.js");
const removalUiPath = path.join(root, "clients/marketplace/src/ui/owned-resource-removal.js");
const removalPath = path.join(root, "services/marketplaceResourceRemovalV2.service.js");
const workspace = fs.readFileSync(workspacePath, "utf8");
const removalUi = fs.readFileSync(removalUiPath, "utf8");
const removal = fs.readFileSync(removalPath, "utf8");

test("workspace resource detail still opens editorial collections in the current Studio", () => {
  assert.match(workspace, /\/workspace\/editorial-studio\?editorialContextId=/);
  assert.doesNotMatch(workspace, /\/workspace\/context-compose/);
});

test("collection removal UI explains local graph trashing and immutable release preservation", () => {
  assert.match(workspace, /renderOwnedResourceRemoval/);
  assert.match(workspace, /requestOwnedResourceRemoval/);
  assert.match(workspace, /removalImpact:\s*asset\.removalImpact/);
  assert.match(removalUi, /semanticGraphRelationCount/);
  assert.match(removalUi, /grafo locale/);
  assert.match(removalUi, /revisioni immutabili/);
  assert.match(removalUi, /release già pubblicate/);
  const removalSurface = `${workspace}\n${removalUi}`;
  assert.doesNotMatch(removalSurface, /Potrà essere riutilizzato da un'altra raccolta/);
  assert.doesNotMatch(removalSurface, /collegamenti dovranno essere ricreati/);
  assert.doesNotMatch(removalSurface, /affectedConnectionCount/);
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
  for (const file of [workspacePath, removalUiPath, removalPath]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, file)}: ${result.stderr || result.stdout}`);
  }
});
