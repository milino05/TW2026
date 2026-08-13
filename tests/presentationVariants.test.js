const test = require("node:test");
const assert = require("node:assert/strict");
const { listRepresentationCandidates, getDefaultCandidate } = require("../services/presentationModel.service");
const { findRepresentationByPolicy, resolveCommunityRepresentation } = require("../services/presentationPolicy.service");

const itemRevision = {
  defaultPresentation: { variantKey: "standard", durationKey: "short", languageLevelKey: "simple" },
  presentationVariants: [
    { key: "standard", label: "Standard", semanticFocus: [], presentationAspects: [], representations: [{ durationKey: "short", languageLevelKey: "simple", text: "standard" }] },
    { key: "stories", label: "Storie", semanticFocus: [{ kind: "item_type", key: "artist", weight: 1 }], presentationAspects: [{ key: "anecdotal", weight: 1 }], representations: [{ durationKey: "short", languageLevelKey: "simple", text: "stories" }] },
  ],
};

test("la stessa coppia duration-language puo esistere in varianti diverse", () => {
  const candidates = listRepresentationCandidates(itemRevision);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((entry) => entry.variantKey), ["standard", "stories"]);
});

test("defaultPresentation identifica variant e representation", () => {
  assert.equal(getDefaultCandidate(itemRevision).variantKey, "standard");
  assert.equal(findRepresentationByPolicy(itemRevision, { durationKey: "short", languageLevelKey: "simple", variantKey: "stories" }).text, "stories");
});

test("il resolver community puo ricevere un bonus per la variante semantica", () => {
  const result = resolveCommunityRepresentation({ source: itemRevision, durationTypes: [{ key: "short" }], languageLevels: [{ key: "simple" }], preference: { depthPreference: 0.5, languageComplexityPreference: 0.5 }, variantScores: new Map([["stories", 1]]) });
  assert.equal(result.variantKey, "stories");
});
