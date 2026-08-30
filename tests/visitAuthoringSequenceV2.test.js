const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalizeContentEntries, reorderWithinDeliveryGroup } = require("../services/visitSequenceV2.service");

function entry(_id, deliveryAnchorId) {
  return {
    _id,
    contentSourceId: `source-${_id}`,
    itemId: `item-${_id}`,
    itemEditionId: `edition-${_id}`,
    itemRevisionId: `revision-${_id}`,
    deliveryAnchorId,
    role: "recommended",
  };
}

test("canonicalizzazione segue ordine tappe e conserva ordine interno", () => {
  const entries = [entry("b1", "b"), entry("a1", "a"), entry("context", null), entry("a2", "a")];
  const ordered = canonicalizeContentEntries(entries, [{ _id: "a" }, { _id: "b" }]);
  assert.deepEqual(ordered.map((candidate) => candidate._id), ["a1", "a2", "b1", "context"]);
});

test("riordino contenuti modifica solo i fratelli della stessa tappa", () => {
  const entries = [entry("a1", "anchor-a"), entry("b1", "anchor-b"), entry("a2", "anchor-a"), entry("b2", "anchor-b")];
  const result = reorderWithinDeliveryGroup(entries, "a2", 0);
  assert.equal(result.changed, true);
  assert.deepEqual(result.entries.map((candidate) => candidate._id), ["a2", "b1", "a1", "b2"]);
  assert.deepEqual(entries.map((candidate) => candidate._id), ["a1", "b1", "a2", "b2"]);
});

test("riordino dei contenuti contestuali resta nel gruppo contestuale", () => {
  const entries = [entry("physical", "anchor-a"), entry("context-1", null), entry("context-2", null)];
  const result = reorderWithinDeliveryGroup(entries, "context-2", 0);
  assert.deepEqual(result.entries.map((candidate) => candidate._id), ["physical", "context-2", "context-1"]);
  assert.equal(result.selected.deliveryAnchorId, null);
});

test("riordino rifiuta indici fuori dal gruppo di delivery", () => {
  const entries = [entry("a1", "anchor-a"), entry("a2", "anchor-a"), entry("b1", "anchor-b")];
  assert.throws(
    () => reorderWithinDeliveryGroup(entries, "a1", 2),
    (error) => error?.status === 400 && error?.details?.some((detail) => detail.code === "OUT_OF_RANGE"),
  );
});
