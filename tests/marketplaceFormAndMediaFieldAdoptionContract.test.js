const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const main = read("clients/marketplace/src/main.js");
const formField = read("clients/marketplace/src/ui/form-field.js");
const organizations = read("clients/marketplace/src/ui/discovery-organizations-view.js");
const venues = read("clients/marketplace/src/ui/discovery-venues-view.js");
const mediaField = read("clients/marketplace/src/ui/media-field.js");
const mediaAdapter = read("clients/marketplace/src/ui/item-media-field-adapter.js");
const interactionCss = read("clients/marketplace/src/styles/interaction-primitives.css");

test("Discovery usa direttamente FormField per label e descrizione accessibile", () => {
  for (const source of [organizations, venues]) {
    assert.match(source, /<artaround-form-field>/);
    assert.match(source, /data-field-help/);
  }
  assert.match(formField, /aria-describedby/);
  assert.match(formField, /label\.htmlFor = controlId/);
});

test("Item upload adotta MediaField senza duplicare persistenza o repository", () => {
  assert.match(main, /item-media-field-adapter\.js/);
  assert.match(mediaAdapter, /artaround-item-authoring-view/);
  assert.match(mediaAdapter, /input\[type=\"file\"\]\[data-media-upload\]/);
  assert.match(mediaAdapter, /document\.createElement\("artaround-media-field"\)/);
  assert.match(mediaAdapter, /data\.mediaPreview|dataset\.mediaPreview/);
  assert.doesNotMatch(mediaAdapter, /Repository\.|repository\.|uploadMediaFile|illustrativeMedia\s*=/);
});

test("MediaField può usare una preview nel proprio scope esterno e resta layout-neutral nell'Item", () => {
  assert.match(mediaField, /closest\("\[data-media-field-scope\]"\)/);
  assert.match(mediaField, /URL\.createObjectURL/);
  assert.match(mediaField, /artaround:media-selected/);
  assert.match(interactionCss, /artaround-media-field\[data-artaround-media-enhancement=\"item-upload\"\][^{]*\{\s*display:\s*contents;/s);
});
