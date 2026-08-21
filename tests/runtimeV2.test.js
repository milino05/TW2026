const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
const { resolveInitialPresentation, findAdjacentPresentation } = require("../services/presentationRuntimeV2.service");

function oid() { return new mongoose.Types.ObjectId(); }
function fixture() {
  const variantId = oid(), shortSimple = oid(), longSimple = oid(), shortAdvanced = oid(), longAdvanced = oid();
  const revision = {
    defaultPresentation: { variantId, representationId: shortSimple },
    presentationVariants: [{
      _id: variantId,
      key: "standard",
      label: "Standard",
      representations: [
        { _id: shortSimple, durationTypeDefinitionId: "duration-short", languageLevelDefinitionId: "language-simple", locale: "it-IT", text: "Breve semplice" },
        { _id: longSimple, durationTypeDefinitionId: "duration-long", languageLevelDefinitionId: "language-simple", locale: "it-IT", text: "Lungo semplice" },
        { _id: shortAdvanced, durationTypeDefinitionId: "duration-short", languageLevelDefinitionId: "language-advanced", locale: "it-IT", text: "Breve avanzato" },
        { _id: longAdvanced, durationTypeDefinitionId: "duration-long", languageLevelDefinitionId: "language-advanced", locale: "it-IT", text: "Lungo avanzato" },
      ],
    }],
  };
  const namespaceRevision = {
    durationTypes: [
      { definitionId: "duration-short", targetSeconds: 20 },
      { definitionId: "duration-long", targetSeconds: 60 },
    ],
    languageLevels: [
      { definitionId: "language-simple" },
      { definitionId: "language-advanced" },
    ],
  };
  return { revision, namespaceRevision, variantId, shortSimple, longSimple, shortAdvanced, longAdvanced };
}

test("runtime v2 schemas pin VenueRelease/NamespaceRevision and reject legacy Museum presentation fields", () => {
  assert.ok(VisitSessionV2.schema.path("venuePins"));
  assert.equal(VisitSessionV2.schema.path("museumId"), undefined);
  assert.equal(VisitSessionV2.schema.path("presentationOverrides").schema.path("variantKey"), undefined);
  assert.equal(VisitSessionV2.schema.path("presentationOverrides").schema.path("durationKey"), undefined);
  const entry = SessionPlanRevisionV2.schema.path("contentEntries").schema;
  assert.ok(entry.path("itemEditionId"));
  assert.ok(entry.path("namespaceRevisionId"));
  assert.equal(entry.path("museumId"), undefined);
  assert.equal(entry.path("spatialMode"), undefined);
  assert.equal(entry.path("variantKey"), undefined);
  const anchor = SessionPlanRevisionV2.schema.path("visitAnchors").schema;
  assert.ok(anchor.path("venueTargetId"));
  assert.ok(anchor.path("venueId"));
});

test("presentation runtime moves on one ordered axis while keeping Variant locale and orthogonal axis", () => {
  const { revision, namespaceRevision, variantId, shortSimple, longSimple, shortAdvanced } = fixture();
  const baseline = resolveInitialPresentation({ revision, namespaceRevision });
  assert.equal(String(baseline.variantId), String(variantId));
  assert.equal(String(baseline.representationId), String(shortSimple));
  assert.equal(baseline.text, "Breve semplice");
  assert.equal(baseline.estimatedContentSeconds, 20);

  const deeper = findAdjacentPresentation({ revision, namespaceRevision, current: baseline, axis: "duration", direction: "up" });
  assert.equal(String(deeper.representationId), String(longSimple));
  assert.equal(deeper.languageLevelDefinitionId, "language-simple");
  assert.equal(deeper.locale, "it-IT");

  const advanced = findAdjacentPresentation({ revision, namespaceRevision, current: baseline, axis: "language", direction: "up" });
  assert.equal(String(advanced.representationId), String(shortAdvanced));
  assert.equal(advanced.durationTypeDefinitionId, "duration-short");
  assert.equal(advanced.locale, "it-IT");
});

test("explicit pre-start preference overrides visit baseline but keeps the same Variant", () => {
  const { revision, namespaceRevision, variantId, longAdvanced } = fixture();
  const selected = resolveInitialPresentation({
    revision,
    namespaceRevision,
    visitBaseline: { depthPreference: 0, languageComplexityPreference: 0 },
    userPreference: { depthPreference: 0.5, languageComplexityPreference: 0.5 },
    explicitPreference: { depthPreference: 1, languageComplexityPreference: 1 },
  });
  assert.equal(String(selected.variantId), String(variantId));
  assert.equal(String(selected.representationId), String(longAdvanced));
});
