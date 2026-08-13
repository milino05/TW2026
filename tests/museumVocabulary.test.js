const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeMuseumPayload, validateMuseumPayload } = require("../services/validation/museum.validation");
const { normalizedPosition, withNormalizedPositions } = require("../services/vocabularyNormalization.service");

test("Museum contiene solo metadati propri e non il vocabolario", () => {
  const payload = normalizeMuseumPayload({ name: " Museo test " });
  assert.deepEqual(payload, { name: "Museo test" });
  assert.deepEqual(validateMuseumPayload({ payload, rawPayload: { name: "Museo test" } }), []);
});

test("config precedente e rifiutato esplicitamente", () => {
  const rawPayload = { name: "Museo test", config: { itemTypes: [] } };
  const errors = validateMuseumPayload({ payload: normalizeMuseumPayload(rawPayload), rawPayload });
  assert.equal(errors.some((error) => error.code === "REMOVED_FIELD" && error.field === "config"), true);
});

test("la normalizzazione uniforme resta indipendente dal modello Museum", () => {
  assert.equal(normalizedPosition(0, 4), 0);
  assert.equal(normalizedPosition(1, 4), 1 / 3);
  assert.equal(normalizedPosition(2, 4), 2 / 3);
  assert.equal(normalizedPosition(3, 4), 1);
  assert.equal(normalizedPosition(0, 1), 0.5);
  const normalized = withNormalizedPositions([
    { key: "simple" },
    { key: "standard" },
    { key: "advanced" },
  ]);
  assert.deepEqual(normalized.map((entry) => entry.normalizedPosition), [0, 0.5, 1]);
});
