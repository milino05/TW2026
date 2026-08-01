const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePresentationPolicy,
  findRepresentationByPolicy,
  findDefaultRepresentation,
  resolveInitialRepresentation,
  findAdjacentRepresentation,
} = require("../services/presentationPolicy.service");

const vocabulary = {
  durationTypes: [
    { key: "short", level: 1 },
    { key: "medium", level: 2 },
    { key: "long", level: 3 },
  ],
  languageLevels: [
    { key: "simple", level: 1 },
    { key: "medium", level: 2 },
    { key: "advanced", level: 3 },
  ],
};

const item = {
  representations: [
    {
      durationKey: "short",
      languageLevelKey: "simple",
      text: "breve",
      isDefault: true,
    },
    { durationKey: "long", languageLevelKey: "simple", text: "lungo" },
    { durationKey: "short", languageLevelKey: "advanced", text: "avanzato" },
  ],
};

test("default ufficiale usa la policy del creatore", () => {
  const policy = resolvePresentationPolicy({
    defaultPresentationPolicy: { durationKey: "short", languageLevelKey: "simple" },
    userPreference: { mode: "default" },
  });

  assert.deepEqual(policy, { durationKey: "short", languageLevelKey: "simple" });
});

test("custom ufficiale sostituisce entrambi gli assi", () => {
  const policy = resolvePresentationPolicy({
    defaultPresentationPolicy: { durationKey: "short", languageLevelKey: "simple" },
    userPreference: {
      mode: "custom",
      durationKey: "long",
      languageLevelKey: "advanced",
    },
  });

  assert.deepEqual(policy, { durationKey: "long", languageLevelKey: "advanced" });
});

test("community usa la representation default locale dell item", () => {
  const representation = resolveInitialRepresentation({
    visit: { kind: "community" },
    item,
    userPreference: { mode: "default" },
  });

  assert.equal(representation.text, "breve");
});

test("community non interpreta una preferenza custom senza mapping cross vocabulary", () => {
  assert.throws(
    () =>
      resolveInitialRepresentation({
        visit: { kind: "community" },
        item,
        userPreference: {
          mode: "custom",
          durationKey: "long",
          languageLevelKey: "advanced",
        },
      }),
    (error) => error.status === 409 && error.details[0].code === "CROSS_VOCABULARY_MAPPING_REQUIRED",
  );
});

test("trova una sola representation default locale", () => {
  assert.equal(findDefaultRepresentation({ item }).text, "breve");
  assert.equal(
    findDefaultRepresentation({
      item: {
        representations: [
          { isDefault: true },
          { isDefault: true },
        ],
      },
    }),
    null,
  );
});

test("dimmi di piu salta livelli non disponibili mantenendo il linguaggio", () => {
  const next = findAdjacentRepresentation({
    item,
    currentRepresentation: item.representations[0],
    vocabulary,
    axis: "duration",
    direction: "higher",
  });

  assert.equal(next.durationKey, "long");
  assert.equal(next.languageLevelKey, "simple");
});

test("cambio linguistico mantiene la durata", () => {
  const next = findAdjacentRepresentation({
    item,
    currentRepresentation: item.representations[0],
    vocabulary,
    axis: "language",
    direction: "higher",
  });

  assert.equal(next.durationKey, "short");
  assert.equal(next.languageLevelKey, "advanced");
});

test("seleziona una representation mediante la coppia della policy", () => {
  const representation = findRepresentationByPolicy({
    item,
    policy: { durationKey: "long", languageLevelKey: "simple" },
  });

  assert.equal(representation.text, "lungo");
});
