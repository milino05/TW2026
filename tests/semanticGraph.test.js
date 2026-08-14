const test = require("node:test");
const assert = require("node:assert/strict");
const { featureKey, edgeWeight } = require("../services/semanticGraph.service");

test("featureKey canonical e stabile cross-museum", () => {
  assert.equal(featureKey({ kind: "canonical", scheme: "Wikidata", refId: "Q42" }), "canonical:wikidata::Q42");
});

test("edgeWeight combina strength e peso dell'istanza", () => {
  assert.equal(edgeWeight({ weight: 10 }, { strength: "strong" }), 1);
  assert.ok(edgeWeight({ weight: 5 }, { strength: "weak" }) < edgeWeight({ weight: 5 }, { strength: "strong" }));
});
