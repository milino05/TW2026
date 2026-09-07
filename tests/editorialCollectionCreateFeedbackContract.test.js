const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../clients/marketplace/src/ui/editorial-collection-create-view.js"),
  "utf8",
);

test("il wizard Raccolta usa il Callout standard per errori persistenti", () => {
  const dangerCallouts = source.match(/<artaround-callout tone="danger" role="alert">/g) || [];
  assert.equal(dangerCallouts.length, 2);
  assert.doesNotMatch(source, /<p role="alert">/);
});
