const test = require("node:test");
const assert = require("node:assert/strict");
const ItemRevision = require("../models/itemRevision.model");
const SemanticEdge = require("../models/semanticEdge.model");
const { normalizeItemPayload, validateItemDraftPayload } = require("../services/validation/item.validation");

const vocabulary = {
  itemTypes: ["artwork"],
  itemTypeDefinitions: [{ key: "artwork", capabilities: [] }],
  relationTypes: [{ key: "created_by", domain: ["artwork"], range: [], validationRules: { allowMultiple: true } }],
  presentationAspects: [],
  selectionSignals: [],
  languageLevels: [],
  durationTypes: [],
};

test("ItemRevision non contiene piu topologia embedded", () => {
  assert.equal(ItemRevision.schema.path("relations"), undefined);
});

test("SemanticEdge contiene source revision, source node e target node", () => {
  for (const field of ["museumId", "sourceItemId", "sourceItemRevisionId", "targetItemId", "relationTypeKey", "weight"]) {
    assert.ok(SemanticEdge.schema.path(field), `campo mancante: ${field}`);
  }
});

test("payload relations legacy viene rifiutato esplicitamente", async () => {
  const errors = await validateItemDraftPayload({
    museumId: "museum",
    itemType: "artwork",
    payload: { relations: [] },
    vocabulary,
    mode: "update",
  });
  assert.equal(errors.some((error) => error.field === "relations" && error.code === "REMOVED_FIELD"), true);
});

test("semanticEdges viene normalizzato come contratto graph-first", () => {
  const normalized = normalizeItemPayload({ semanticEdges: [{ relationTypeKey: " CREATED_BY ", target: "abc", weight: "4" }] });
  assert.deepEqual(normalized.semanticEdges, [{ relationTypeKey: "created_by", targetItemId: "abc", weight: 4 }]);
});
