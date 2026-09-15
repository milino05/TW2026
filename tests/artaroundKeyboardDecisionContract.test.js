const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const marketplaceModal = read("clients/marketplace/src/application/modal-interaction.js");
const marketplaceDecision = read("clients/marketplace/src/ui/feedback-primitives.js");
const venueDecision = read("clients/marketplace/src/ui/venue-editor-map-refinement-base.js");
const contentCreation = read("clients/marketplace/src/ui/content-space-item-add-dialog.js");
const namespaceEditor = read("clients/marketplace/src/ui/namespace-editor-view.js");
const itemEditor = read("clients/marketplace/src/ui/item-authoring-view.js");
const navigatorDecision = read("clients/navigator/src/ui/FeedbackActionDialog.vue");
const navigatorSession = read("clients/navigator/src/ui/SessionView.vue");
const synchronizedSession = read("clients/navigator/src/ui/SynchronizedSessionView.vue");

test("Escape percorre soltanto rami di annullamento e consuma l'evento del livello attivo", () => {
  assert.match(marketplaceDecision, /if \(event\.key === "Escape"\)[\s\S]{0,180}this\.finish\(false\)/);
  assert.match(navigatorDecision, /if \(event\.key === "Escape"\)[\s\S]{0,180}emit\("cancel"\)/);
  assert.match(namespaceEditor, /event\.key === "Escape"[\s\S]{0,320}privateSuccessOpen = false/);
  assert.match(itemEditor, /event\.key !== "Escape" \|\| !this\.privateSuccessOpen[\s\S]{0,180}privateSuccessOpen = false/);
  assert.match(navigatorSession, /event\.key === "Escape"[\s\S]{0,500}event\.stopPropagation\(\)/);
  assert.match(synchronizedSession, /event\.key !== "Escape" \|\| event\.defaultPrevented[\s\S]{0,420}event\.stopPropagation\(\)/);
});

test("Invio attiva la conferma dichiarata senza interferire con scrittura e composizione", () => {
  for (const source of [marketplaceModal, marketplaceDecision, navigatorDecision]) {
    assert.match(source, /Enter/);
    assert.match(source, /isComposing/);
    assert.match(source, /event\.repeat/);
    assert.match(source, /textarea, select, \[contenteditable\]/);
  }
  assert.match(marketplaceModal, /\[data-modal-confirm\]/);
  assert.match(marketplaceModal, /closest\("form"\)/);
  assert.match(marketplaceModal, /dismissalOrigin/);
  assert.match(navigatorSession, /completionConfirmOpen\.value[\s\S]{0,520}confirmCompletion\(\)/);
});

test("le conferme costruttive e distruttive non condividono i selettori di annullamento", () => {
  for (const source of [venueDecision, contentCreation]) {
    for (const line of source.split("\n").filter((entry) => /<button[^>]+data-confirm-(?:destructive|calibration|new-item|distinct-lineage)/.test(entry))) {
      assert.match(line, /data-modal-confirm/);
    }
  }
  assert.doesNotMatch(marketplaceModal, /requestDismiss\("enter"\)/);
  assert.doesNotMatch(navigatorDecision, /Enter[\s\S]{0,160}emit\("cancel"\)/);
});
