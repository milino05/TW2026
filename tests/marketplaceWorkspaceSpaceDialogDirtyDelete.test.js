const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/workspace-space-dialogs.js"), "utf8");

test("annullare l'eliminazione dello spazio non perde il dirty state del Task Dialog", () => {
  assert.match(source, /isDirty: \(\) => state\.dirty/);
  assert.match(source, /const deleted = await onDelete\?\.\(\)/);
  assert.doesNotMatch(source, /state\.dirty = false;\s*const deleted = await onDelete/);
  assert.match(source, /if \(deleted !== false\) \{[\s\S]*dialog\?\.close\(\{ notify: false \}\)/);
});
