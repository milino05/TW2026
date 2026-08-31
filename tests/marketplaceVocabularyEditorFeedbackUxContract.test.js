const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const physicalSource = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js"), "utf8");
const feedbackStyles = fs.readFileSync(path.join(root, "clients/marketplace/src/styles/vocabulary-editor-disclosure.css"), "utf8");

test("il feedback di salvataggio del vocabolario fisico resta accessibile", () => {
  assert.match(physicalSource, /feedback-success[^>]*role=\"status\"|role=\"status\"[^>]*feedback-success/);
  assert.match(physicalSource, /Dettagli del vocabolario salvati\./);
});

test("il feedback di successo non partecipa al layout della grid", () => {
  assert.match(feedbackStyles, /\.physical-editor-page > \.feedback-success\[role=\"status\"\]/);
  assert.match(feedbackStyles, /position:fixed/);
  assert.match(feedbackStyles, /z-index:70/);
});
