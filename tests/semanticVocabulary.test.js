const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeVocabularyPayload, validateVocabularyPayload } = require("../services/validation/vocabulary.validation");

function validVocabulary() {
  return {
    languageLevels: [{ key: "simple", label: "Semplice" }, { key: "advanced", label: "Avanzato" }],
    durationTypes: [{ key: "short", label: "Breve", targetSeconds: 30 }, { key: "long", label: "Lunga", targetSeconds: 120 }],
    itemTypes: [
      { key: "artwork", label: "Opera", capabilities: ["visit_stop", "spatial_placement", "semantic_context"], semanticRefs: [{ scheme: "schema.org", id: "VisualArtwork", matchType: "close" }] },
      { key: "artist", label: "Artista", capabilities: ["semantic_context"], semanticRefs: [] },
    ],
    relationTypes: [{ key: "created_by", label: "Creato da", category: "semantic", strength: "strong", directionality: "directed", domain: ["artwork"], range: ["artist"], semanticRefs: [] }],
    presentationAspects: [{ key: "anecdotal", label: "Aneddotico", semanticRefs: [{ scheme: "local", id: "anecdotal", matchType: "exact" }] }],
  };
}

test("il vocabolario semantico accetta tipi, relazioni, aspect e semanticRefs", () => {
  const normalized = normalizeVocabularyPayload(validVocabulary());
  assert.deepEqual(validateVocabularyPayload(normalized), []);
});

test("domain e range devono riferire ItemType del vocabolario", () => {
  const payload = validVocabulary();
  payload.relationTypes[0].range = ["unknown"];
  const errors = validateVocabularyPayload(normalizeVocabularyPayload(payload));
  assert.equal(errors.some((error) => error.code === "UNKNOWN_ITEM_TYPE"), true);
});

test("gli ItemType devono usare direttamente il nuovo schema strutturato", () => {
  const payload = validVocabulary();
  payload.itemTypes = ["artwork"];
  const normalized = normalizeVocabularyPayload(payload);
  const errors = validateVocabularyPayload(normalized);
  assert.equal(errors.some((error) => error.code === "INVALID_TYPE"), true);
});
