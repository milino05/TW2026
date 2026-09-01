const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/legacy-feedback-surface-adapter.js"), "utf8");

test("l'observer dei persistent error gestisce anche il nodo alert aggiunto direttamente", () => {
  assert.match(source, /PERSISTENT_ERROR_ROOT_SELECTOR/);
  assert.match(source, /PERSISTENT_ERROR_SELECTOR/);
  assert.match(source, /root instanceof Element && root\.matches\(PERSISTENT_ERROR_SELECTOR\)/);
  assert.match(source, /root\.closest\(PERSISTENT_ERROR_ROOT_SELECTOR\)/);
  assert.match(source, /node instanceof Element\) replaceKnownPersistentErrors\(node\)/);
});

test("il filtro resta limitato alle root Marketplace auditate e non include superfici rimosse", () => {
  for (const selector of [
    "artaround-create-hub-view",
    "artaround-home-view",
    "artaround-context-hub-view",
    "artaround-catalog-view",
  ]) assert.match(source, new RegExp(selector));
  assert.doesNotMatch(source, /artaround-venue-target-chooser/);
  assert.match(source, /legacy\.closest\(PERSISTENT_ERROR_ROOT_SELECTOR\)/);
  assert.doesNotMatch(source, /artaround-semantic-entity-picker/);
});
