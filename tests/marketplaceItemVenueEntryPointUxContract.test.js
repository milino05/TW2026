const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const workspace = read("clients/marketplace/src/ui/workspace-browser-view.js");
const collectionContent = read("clients/marketplace/src/ui/editorial-collection-content-manager.js");
const itemDetail = read("clients/marketplace/src/ui/item-detail-dialog.js");

test("le card Item espongono il flusso Subject→Venue direttamente dalla Libreria organizzazione", () => {
  assert.match(workspace, /data-open-item-venues/);
  assert.match(workspace, /this\.selectedPrincipal\(\)\?\.type === "organization"/);
  assert.match(workspace, /openItemDetail\(itemVenues\.dataset\.openItemVenues, \{ initialTab: "venues" \}\)/);
  assert.match(workspace, /openItemDetail\(itemId, \{ initialTab = null \} = \{\}\)/);
  assert.match(workspace, /dialog\.tab = initialTab/);
  assert.doesNotMatch(workspace, /artaround-subject-presence|openSubjectVenueDialog/);
});

test("anche i pannelli Item della Raccolta aprono direttamente la stessa tab Sedi", () => {
  assert.match(collectionContent, /readOperatingContext/);
  assert.match(collectionContent, /data-inspect-content-venues/);
  assert.match(collectionContent, /this\.context\?\.type === "organization"/);
  assert.match(collectionContent, /openItemDetail\(venue\.dataset\.inspectContentVenues, \{ initialTab: "venues" \}\)/);
  assert.match(collectionContent, /if \(initialTab === "venues"[\s\S]*dialog\.tab = initialTab;[\s\S]*else dialog\.setAttribute\("initial-collection-id"/);
  assert.doesNotMatch(collectionContent, /artaround-subject-presence|openSubjectVenueDialog/);
});

test("gli entry-point Sedi riusano il dettaglio Item canonico e la surface Subject→Venue esistente", () => {
  assert.match(itemDetail, /data-item-detail-tab="venues"/);
  assert.match(itemDetail, /artaround-subject-presence/);
  assert.match(itemDetail, /sourceItemId: this\.itemId/);
  assert.match(itemDetail, /sourcePreviewMedia: this\.data\?\.item\?\.recognitionMedia/);
});

test("i file degli entry-point Item→Sedi passano il syntax gate", () => {
  for (const relative of [
    "clients/marketplace/src/ui/workspace-browser-view.js",
    "clients/marketplace/src/ui/editorial-collection-content-manager.js",
    "clients/marketplace/src/ui/item-detail-dialog.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
