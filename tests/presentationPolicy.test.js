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
const languageLevels = [{ key: "simple" }, { key: "standard" }, { key: "advanced" }];
const source = {
  defaultPresentation: { variantKey: "standard", durationKey: "medium", languageLevelKey: "simple" },
  presentationVariants: [
    {
      key: "standard",
      label: "Standard",
      semanticFocus: [],
      presentationAspects: [],
      representations: [
        { durationKey: "medium", languageLevelKey: "simple", text: "A" },
        { durationKey: "complete", languageLevelKey: "simple", text: "B" },
        { durationKey: "medium", languageLevelKey: "advanced", text: "C" },
      ],
    },
    {
      key: "stories",
      label: "Storie",
      semanticFocus: [],
      presentationAspects: [{ key: "anecdotal", weight: 1 }],
      representations: [{ durationKey: "medium", languageLevelKey: "simple", text: "D" }],
    },
  ],
};

test("la visita ufficiale usa la policy custom mantenendo la variante se indicata", () => {
  const result = resolveOfficialRepresentation({
    source,
    defaultPolicy: { durationKey: "medium", languageLevelKey: "simple", variantKey: "standard" },
    preference: { mode: "custom", durationKey: "complete", languageLevelKey: "simple", variantKey: "standard" },
  });
  assert.equal(result.text, "B");
});

test("la community usa defaultPresentation senza preferenze", () => {
  assert.equal(resolveCommunityRepresentation({ source, durationTypes, languageLevels }).text, "A");
});

test("la community puo preferire una variante semanticamente piu adatta", () => {
  const result = resolveCommunityRepresentation({
    source,
    durationTypes,
    languageLevels,
    preference: { depthPreference: 0.4, languageComplexityPreference: 0.1 },
    variantScores: new Map([["stories", 1]]),
  });
  assert.equal(result.variantKey, "stories");
});

test("dimmi di piu aumenta la duration mantenendo variante e linguaggio", () => {
  const current = findDefaultRepresentation(source);
  const result = findAdjacentRepresentation({ source, durationTypes, languageLevels, currentRepresentation: current, axis: "duration", direction: "up" });
  assert.equal(result.variantKey, "standard");
  assert.equal(result.durationKey, "complete");
  assert.equal(result.languageLevelKey, "simple");
});

test("linguaggio piu avanzato mantiene variante e duration", () => {
  const current = findDefaultRepresentation(source);
  const result = findAdjacentRepresentation({ source, durationTypes, languageLevels, currentRepresentation: current, axis: "language", direction: "up" });
  assert.equal(result.variantKey, "standard");
  assert.equal(result.durationKey, "medium");
  assert.equal(result.languageLevelKey, "advanced");
});

test("linguaggio piu semplice mantiene variante e duration", () => {
  const current = findRepresentationByPolicy(source, { durationKey: "medium", languageLevelKey: "advanced", variantKey: "standard" });
  const result = findAdjacentRepresentation({ source, durationTypes, languageLevels, currentRepresentation: current, axis: "language", direction: "down" });
  assert.equal(result.variantKey, "standard");
  assert.equal(result.durationKey, "medium");
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
      { museumId: "museum-a", representation: findDefaultRepresentation(source) },
      { museumId: "museum-b", representation: { durationKey: "local" } },
    ],
  });
  assert.equal(total, 165);
});

test("helper di policy rispetta variantKey", () => {
  assert.equal(findRepresentationByPolicy(source, { durationKey: "medium", languageLevelKey: "simple", variantKey: "stories" }).text, "D");
});
