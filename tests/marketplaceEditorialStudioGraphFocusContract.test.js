const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const studio = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/editorial-studio-view.js"), "utf8");

test("Collection relations workspace owns and restores Semantic Graph focus across studio reloads", () => {
  assert.match(studio, /graphFocusSubjectId\s*=\s*null/);
  assert.match(studio, /params\.get\("focusSubjectId"\)/);
  assert.match(studio, /addEventListener\("semantic-graph-focus-changed",\s*this\.onGraphFocusChanged\)/);
  assert.match(studio, /removeEventListener\("semantic-graph-focus-changed",\s*this\.onGraphFocusChanged\)/);
  assert.match(studio, /this\.graphFocusSubjectId\s*=\s*next/);
  assert.match(studio, /params\.set\("focusSubjectId",\s*next\)/);
  assert.match(studio, /initialFocusSubjectId:\s*this\.graphFocusSubjectId/);
  assert.match(studio, /onChildChanged\s*=\s*\(\)\s*=>\s*\{[\s\S]*graph\.focusSubjectId[\s\S]*this\.load\(\)/);
});

test("Collection relations workspace does not repeat technical graph exposition above the editor", () => {
  assert.doesNotMatch(studio, /<span class="eyebrow">Semantica<\/span><h2>Collegamenti fra soggetti<\/h2>/);
  assert.doesNotMatch(studio, /Il grafo della Raccolta collega soltanto Subject rappresentati dai suoi contenuti/);
  assert.doesNotMatch(studio, /Questo grafo è locale e indipendente\. Le sorgenti importate sono pinzate/);
  assert.match(studio, /studio-relations-section/);
  assert.match(studio, /data-import-semantic-source/);
  assert.match(studio, /<artaround-semantic-graph-editor><\/artaround-semantic-graph-editor>/);
});
