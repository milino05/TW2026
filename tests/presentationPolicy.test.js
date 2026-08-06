const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findDefaultRepresentation,
  findRepresentationByPolicy,
  resolveCommunityRepresentation,
  resolveOfficialRepresentation,
  findAdjacentRepresentation,
  estimateContentSeconds,
} = require("../services/presentationPolicy.service");

const durationTypes = [
  { key: "short", targetSeconds: 30 },
  { key: "medium", targetSeconds: 90 },
  { key: "long", targetSeconds: 240 },
  { key: "complete", targetSeconds: 420 },
];
const languageLevels = [
  { key: "simple" },
  { key: "standard" },
  { key: "advanced" },
];
const representations = [
  { durationKey: "medium", languageLevelKey: "simple", text: "A", isDefault: true },
  { durationKey: "complete", languageLevelKey: "simple", text: "B", isDefault: false },
  { durationKey: "medium", languageLevelKey: "advanced", text: "C", isDefault: false },
];

test("la visita ufficiale usa la policy custom quando presente", () => {
  const result = resolveOfficialRepresentation({
    representations,
    defaultPolicy: { durationKey: "medium", languageLevelKey: "simple" },
    preference: { mode: "custom", durationKey: "complete", languageLevelKey: "simple" },
  });
  assert.equal(result.text, "B");
});

test("la community usa il default locale senza preferenze", () => {
  assert.equal(
    resolveCommunityRepresentation({ representations, durationTypes, languageLevels }).text,
    "A",
  );
});

test("la community normalizza rispetto all'intero vocabolario del museo", () => {
  const result = resolveCommunityRepresentation({
    representations,
    durationTypes,
    languageLevels,
    preference: { depthPreference: 0.7, languageComplexityPreference: 0.1 },
  });
  assert.equal(result.text, "B");
});

test("a parita di distanza preferisce il linguaggio meno complesso", () => {
  const result = resolveCommunityRepresentation({
    representations: [
      { durationKey: "short", languageLevelKey: "simple", text: "semplice" },
      { durationKey: "short", languageLevelKey: "advanced", text: "avanzato", isDefault: true },
    ],
    durationTypes: [{ key: "short", targetSeconds: 30 }],
    languageLevels,
    preference: { depthPreference: 0.5, languageComplexityPreference: 0.5 },
  });
  assert.equal(result.text, "semplice");
});

test("dimmi di piu salta livelli non disponibili mantenendo il linguaggio", () => {
  const current = representations[0];
  const result = findAdjacentRepresentation({
    representations,
    durationTypes,
    languageLevels,
    currentRepresentation: current,
    axis: "duration",
    direction: "up",
  });
  assert.equal(result.durationKey, "complete");
  assert.equal(result.languageLevelKey, "simple");
});

test("stima la durata usando targetSeconds del museo di ogni tappa", () => {
  const vocabularies = new Map([
    ["museum-a", { durationTypes }],
    ["museum-b", { durationTypes: [{ key: "local", targetSeconds: 75 }] }],
  ]);
  const total = estimateContentSeconds({
    vocabularyByMuseumId: vocabularies,
    selections: [
      { museumId: "museum-a", representation: representations[0] },
      { museumId: "museum-b", representation: { durationKey: "local" } },
    ],
  });
  assert.equal(total, 165);
});

test("helper di policy e default selezionano la representation prevista", () => {
  assert.equal(findDefaultRepresentation(representations).text, "A");
  assert.equal(
    findRepresentationByPolicy(representations, {
      durationKey: "complete",
      languageLevelKey: "simple",
    }).text,
    "B",
  );
});
