const test = require("node:test");
const assert = require("node:assert/strict");

const { validateMuseumPayload } = require("../services/validation/museum.validation");

function validMuseumConfig() {
  return {
    name: "Museo test",
    config: {
      languageLevels: [
        { key: "simple", label: "Semplice", level: 1 },
        { key: "advanced", label: "Avanzato", level: 2 },
      ],
      durationTypes: [
        { key: "short", label: "Breve", level: 1 },
        { key: "long", label: "Lunga", level: 2 },
      ],
      itemTypes: ["artwork", "artist"],
      relationTypes: [],
    },
  };
}

test("un vocabolario ordinato valido non produce errori", () => {
  assert.deepEqual(validateMuseumPayload({ payload: validMuseumConfig() }), []);
});

test("language level con level duplicato viene rifiutato", () => {
  const payload = validMuseumConfig();
  payload.config.languageLevels[1].level = 1;

  const errors = validateMuseumPayload({ payload });
  assert.equal(errors.some((error) => error.code === "DUPLICATE_LEVEL"), true);
});

test("duration type con key duplicata viene rifiutato", () => {
  const payload = validMuseumConfig();
  payload.config.durationTypes[1].key = "short";

  const errors = validateMuseumPayload({ payload });
  assert.equal(errors.some((error) => error.code === "DUPLICATE_KEY"), true);
});
