const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const physicalSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/transient-feedback-adapter.js"), "utf8");
const feedbackStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/feedback-primitives.css"), "utf8");
const disclosureStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/vocabulary-editor-disclosure.css"), "utf8");

test("il salvataggio del vocabolario fisico usa il mapping transitorio globale", () => {
  assert.match(physicalSource, /Dettagli del vocabolario salvati\./);
  assert.match(adapterSource, /installTransientPropertyAdapter\(ArtAroundPhysicalVocabularyEditorView, "message", physicalMessageMapping\)/);
  assert.match(adapterSource, /function physicalMessageMapping/);
  assert.match(adapterSource, /emitNotification\(message, mapping\.tone\)/);
});

test("il toast globale non partecipa al layout dell'editor e resta sopra le schede", () => {
  assert.match(feedbackStyles, /artaround-toast-center\s*\{[\s\S]*position:fixed/);
  assert.match(feedbackStyles, /z-index:var\(--artaround-layer-toast/);
  assert.doesNotMatch(disclosureStyles, /\.physical-editor-page > \.feedback-success/);
});
