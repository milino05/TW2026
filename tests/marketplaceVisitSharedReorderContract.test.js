const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("clients/marketplace/src/main.js");
const adapter = read("clients/marketplace/src/ui/visit-reorder-adapter.js");
const primitive = read("clients/marketplace/src/ui/reorderable-list.js");
const visit = read("clients/marketplace/src/ui/visit-authoring-view.js");

test("Visit attiva la primitive reorder condivisa", () => {
  assert.match(main, /visit-reorder-adapter\.js/);
  assert.match(adapter, /installReorderableList/);
  assert.match(adapter, /artaround-visit-authoring-view/);
  assert.match(adapter, /disableLegacyDrag/);
});

test("tappe e contenuti mantengono repository e liste di dominio separate", () => {
  assert.match(adapter, /authoringRepository\.reorderVisitStop/);
  assert.match(adapter, /visitSequenceRepository\.reorderContent/);
  assert.match(adapter, /:scope > \.sequence-group\[data-drag-kind=\"stop\"\]/);
  assert.match(adapter, /:scope > \.sequence-entry\[data-drag-kind=\"content\"\]/);
  assert.match(adapter, /querySelectorAll\("\.sequence-entry-list"\)/);
  assert.doesNotMatch(adapter, /appendChild\([^)]*sequence-entry|insertBefore\([^)]*sequence-entry/);
});

test("l'adapter disabilita i vecchi drag listener e neutralizza i vecchi move button", () => {
  for (const name of ["onDragStart", "onDragOver", "onDrop", "onDragEnd"]) assert.match(adapter, new RegExp(name));
  assert.match(adapter, /removeEventListener\(eventName, handler\)/);
  assert.match(adapter, /removeAttribute\(legacyAttribute\)/);
  assert.match(adapter, /data-reorder-move/);
  assert.match(visit, /data-move-stop/);
  assert.match(visit, /data-move-content/);
});

test("reorder condiviso mantiene fallback tastiera e annuncio accessibile", () => {
  assert.match(primitive, /event\.altKey/);
  assert.match(primitive, /aria-live/);
  assert.match(adapter, /tabIndex = 0/);
  assert.match(adapter, /Alt\+Freccia/);
});
