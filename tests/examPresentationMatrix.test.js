const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { DEF, WORKS } = require("../scripts/examDatasetV2");
const { buildRepresentations } = require("../scripts/examPresentationMatrix");
const { resolveInitialPresentation, findAdjacentPresentation } = require("../services/presentationRuntimeV2.service");

test("demo presentation matrix exposes all four presentation directions from Media + Standard", () => {
  const variantId = new mongoose.Types.ObjectId();
  const representations = buildRepresentations(WORKS[0], "essential");
  assert.equal(representations.length, 9);

  const combinationKeys = new Set(representations.map((representation) =>
    `${representation.durationTypeDefinitionId}|${representation.languageLevelDefinitionId}|${representation.locale}`));
  assert.equal(combinationKeys.size, 9);

  const revision = {
    presentationVariants: [{
      _id: variantId,
      key: "essential",
      representations,
    }],
    defaultPresentation: {
      variantId,
      representationId: representations.find((representation) =>
        representation.durationTypeDefinitionId === DEF.durationShort
        && representation.languageLevelDefinitionId === DEF.languageSimple)._id,
    },
  };
  const namespaceRevision = {
    durationTypes: [
      { definitionId: DEF.durationShort, targetSeconds: 60 },
      { definitionId: DEF.durationMedium, targetSeconds: 120 },
      { definitionId: DEF.durationLong, targetSeconds: 210 },
    ],
    languageLevels: [
      { definitionId: DEF.languageSimple },
      { definitionId: DEF.languageStandard },
      { definitionId: DEF.languageAdvanced },
    ],
  };

  const current = resolveInitialPresentation({
    revision,
    namespaceRevision,
    visitBaseline: { depthPreference: 0.55, languageComplexityPreference: 0.5, locale: "it-IT" },
  });
  assert.equal(current.durationTypeDefinitionId, DEF.durationMedium);
  assert.equal(current.languageLevelDefinitionId, DEF.languageStandard);

  assert.ok(findAdjacentPresentation({ revision, namespaceRevision, current, axis: "duration", direction: "up" }));
  assert.ok(findAdjacentPresentation({ revision, namespaceRevision, current, axis: "duration", direction: "down" }));
  assert.ok(findAdjacentPresentation({ revision, namespaceRevision, current, axis: "language", direction: "up" }));
  assert.ok(findAdjacentPresentation({ revision, namespaceRevision, current, axis: "language", direction: "down" }));
});
