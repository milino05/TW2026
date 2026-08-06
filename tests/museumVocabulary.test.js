const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMuseumPayload,
  validateMuseumPayload,
} = require("../services/validation/museum.validation");
const {
  normalizedPosition,
  withNormalizedPositions,
} = require("../services/vocabularyNormalization.service");

function validMuseum() {
  return {
    name: "Museo test",
    config: {
      languageLevels: [
        { key: "simple", label: "Semplice" },
        { key: "standard", label: "Standard" },
        { key: "advanced", label: "Avanzato" },
      ],
      durationTypes: [
        { key: "short", label: "Breve", targetSeconds: 30 },
        { key: "medium", label: "Media", targetSeconds: 90 },
        { key: "long", label: "Approfondita", targetSeconds: 240 },
      ],
      itemTypes: ["artwork", "artist"],
      relationTypes: [],
    },
  };
}

test("un vocabolario ordinato con targetSeconds crescenti e valido", () => {
  const payload = normalizeMuseumPayload(validMuseum());
  assert.deepEqual(validateMuseumPayload({ payload }), []);
});

test("level e rifiutato perche l'ordine deriva dall'array", () => {
  const payload = validMuseum();
  payload.config.languageLevels[0].level = 1;
  const errors = validateMuseumPayload({ payload: normalizeMuseumPayload(payload) });
  assert.equal(errors.some((error) => error.code === "FORBIDDEN_FIELD"), true);
});

test("targetSeconds deve crescere seguendo l'ordine editoriale", () => {
  const payload = validMuseum();
  payload.config.durationTypes[2].targetSeconds = 60;
  const errors = validateMuseumPayload({ payload: normalizeMuseumPayload(payload) });
  assert.equal(errors.some((error) => error.code === "NON_INCREASING_TARGET_SECONDS"), true);
});

test("la normalizzazione uniforme usa l'intero vocabolario", () => {
  assert.equal(normalizedPosition(0, 4), 0);
  assert.equal(normalizedPosition(1, 4), 1 / 3);
  assert.equal(normalizedPosition(2, 4), 2 / 3);
  assert.equal(normalizedPosition(3, 4), 1);
  assert.equal(normalizedPosition(0, 1), 0.5);

  const normalized = withNormalizedPositions(validMuseum().config.languageLevels);
  assert.deepEqual(normalized.map((entry) => entry.normalizedPosition), [0, 0.5, 1]);
});
