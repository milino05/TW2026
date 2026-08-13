const test = require("node:test");
const assert = require("node:assert/strict");
const { explicitFeatureScore, relationCoherence, pruneBeam } = require("../services/visitGenerator.service");

test("un interesse esplicito corrente sull Item usa peso normalizzato", () => {
  const item = { _id: "item-a", itemType: "artwork" };
  const revision = { semanticRefs: [], relations: [], tags: [] };
  assert.equal(explicitFeatureScore({
    interest: { kind: "item", itemId: "item-a", weight: 1 },
    item,
    revision,
    variant: { semanticFocus: [] },
    vocabulary: {},
  }), 1);
});

test("un interesse negativo puo penalizzare una feature", () => {
  const item = { _id: "item-a", itemType: "artwork" };
  const revision = { semanticRefs: [], relations: [], tags: ["war"] };
  assert.ok(explicitFeatureScore({
    interest: { kind: "tag", key: "war", weight: -1 },
    item,
    revision,
    variant: { semanticFocus: [] },
    vocabulary: {},
  }) < 0);
});

test("semanticRefs di ItemType consentono matching cross museum", () => {
  const item = { _id: "item-a", itemType: "local_artist" };
  const revision = { semanticRefs: [], relations: [], tags: [] };
  const vocabulary = {
    itemTypeDefinitions: [{
      key: "local_artist",
      semanticRefs: [{ scheme: "wikidata", id: "Q5", matchType: "close" }],
    }],
    relationTypes: [],
  };
  const score = explicitFeatureScore({
    interest: { kind: "canonical", scheme: "wikidata", id: "Q5", weight: 1 },
    item,
    revision,
    variant: { semanticFocus: [] },
    vocabulary,
  });
  assert.ok(score > 0);
});

test("una relazione diretta aumenta la coerenza narrativa", () => {
  const left = { item: { _id: "a" }, revision: { relations: [{ target: "b" }] } };
  const right = { item: { _id: "b" }, revision: { relations: [] } };
  assert.ok(relationCoherence(left, right) > 0);
});

test("la beam mantiene stati con must-see coperti anche con utility ordinaria", () => {
  const states = [
    { utility: 100, mustCovered: 0, elapsedSeconds: 10 },
    { utility: 1, mustCovered: 1, elapsedSeconds: 20 },
  ];
  assert.equal(pruneBeam(states, 1, 1)[0].mustCovered, 1);
});
