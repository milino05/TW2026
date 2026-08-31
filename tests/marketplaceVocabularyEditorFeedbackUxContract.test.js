const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const physicalSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/transient-feedback-adapter.js"), "utf8");
const feedbackStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/feedback-primitives.css"), "utf8");
const disclosureStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/vocabulary-editor-disclosure.css"), "utf8");

test("il salvataggio del vocabolario fisico usa il canale transitorio globale", () => {
  assert.match(physicalSource, /Dettagli del vocabolario salvati\./);
  assert.match(adapterSource, /ArtAroundPhysicalVocabularyEditorView, "message"/);
  assert.match(adapterSource, /notify\.success\(message\)/);
});

test("il toast globale non partecipa al layout dell'editor", () => {
  assert.match(feedbackStyles, /artaround-toast-center\s*\{[\s\S]*position:fixed/);
  assert.doesNotMatch(disclosureStyles, /\.physical-editor-page > \.feedback-success/);
});
