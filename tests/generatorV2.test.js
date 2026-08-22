const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const { validateGenerationRequestV2 } = require("../services/validation/generationV2.validation");
const { buildFederatedSemanticGraph, resolveFeatureToSubjectIds, shortestSemanticPath } = require("../services/federatedSemanticGraphV2.service");
const { physicalAssociationScore } = require("../services/visitGeneratorV2.service");

function oid() { return new mongoose.Types.ObjectId(); }

test("GenerationRequest v2 requires explicit PhysicalScope and namespaced local features", () => {
  const venueId = oid(), namespaceId = oid();
  assert.deepEqual(validateGenerationRequestV2({ venueIds: [venueId], timeBudgetSeconds: 900 }), []);
  const noVenue = validateGenerationRequestV2({ timeBudgetSeconds: 900 });
  assert.ok(noVenue.some((entry) => entry.field === "venueIds" && entry.code === "REQUIRED"));
  const localWithoutNamespace = validateGenerationRequestV2({
    venueIds: [venueId], timeBudgetSeconds: 900,
    semanticGoals: [{ feature: { kind: "presentation_aspect", definitionId: "aspect-story" } }],
  });
  assert.ok(localWithoutNamespace.some((entry) => entry.field.endsWith("namespaceId")));
  const localValid = validateGenerationRequestV2({
    venueIds: [venueId], timeBudgetSeconds: 900,
    semanticGoals: [{ feature: { kind: "presentation_aspect", namespaceId, definitionId: "aspect-story" } }],
  });
  assert.equal(localValid.length, 0);
});

test("multi-Venue request requires explicit transfers", () => {
  const a = oid(), b = oid();
  const issues = validateGenerationRequestV2({ venueIds: [a, b], timeBudgetSeconds: 900 });
  assert.ok(issues.some((entry) => entry.code === "REQUIRED_FOR_MULTI_VENUE"));
  const valid = validateGenerationRequestV2({
    venueIds: [a, b], timeBudgetSeconds: 900,
    interVenueTransfers: [{ fromVenueId: a, toVenueId: b, estimatedSeconds: 600 }],
  });
  assert.equal(valid.length, 0);
});

test("GeneratedVisitPlan v2 pins releases and concrete baseline representation without legacy museum fields", () => {
  for (const field of ["sourceEditorialReleaseIds", "sourceVenueReleaseIds", "sourceLayoutRevisionIds", "contentEntries", "visitAnchors", "physicalRoute"]) {
    assert.ok(GeneratedVisitPlanV2.schema.path(field) || field === "physicalRoute");
  }
  assert.equal(GeneratedVisitPlanV2.schema.path("museumId"), undefined);
  const contentSchema = GeneratedVisitPlanV2.schema.path("contentEntries").schema;
  assert.ok(contentSchema.path("itemEditionId"));
  assert.ok(contentSchema.path("variantId"));
  assert.ok(contentSchema.path("representationId"));
  assert.ok(contentSchema.path("durationTypeDefinitionId"));
  assert.ok(contentSchema.path("languageLevelDefinitionId"));
  assert.equal(contentSchema.path("spatialMode"), undefined);
  assert.equal(contentSchema.path("variantKey"), undefined);
});

test("federation merges the same Subject while preserving namespaced relation provenance", () => {
  const subjectA = oid(), subjectB = oid(), release1 = oid(), release2 = oid(), namespace1 = oid(), namespace2 = oid();
  const graph1 = {
    revision: { _id: oid() },
    nodes: new Map([
      [String(subjectA), { subject: { _id: subjectA, externalRefs: [] }, binding: { subjectClassDefinitionIds: ["class-a"] } }],
      [String(subjectB), { subject: { _id: subjectB, externalRefs: [] }, binding: null }],
    ]),
    edgesFrom: new Map([
      [String(subjectA), [{ fromSubjectId: subjectA, toSubjectId: subjectB, relationTypeDefinitionId: "rel-1", traversalWeight: 0.8 }]],
    ]),
  };
  const graph2 = {
    revision: { _id: oid() },
    nodes: new Map([
      [String(subjectA), { subject: { _id: subjectA, externalRefs: [] }, binding: { subjectClassDefinitionIds: ["class-b"] } }],
    ]),
    edgesFrom: new Map(),
  };
  const federated = buildFederatedSemanticGraph([
    { graph: graph1, namespaceId: namespace1, namespaceRevisionId: oid(), editorialReleaseId: release1, editorialContextId: oid() },
    { graph: graph2, namespaceId: namespace2, namespaceRevisionId: oid(), editorialReleaseId: release2, editorialContextId: oid() },
  ]);
  assert.equal(federated.nodes.size, 2);
  assert.equal(federated.nodes.get(String(subjectA)).sources.length, 2);
  assert.deepEqual(resolveFeatureToSubjectIds(federated, { kind: "subject_class", namespaceId: namespace1, definitionId: "class-a" }), [String(subjectA)]);
  assert.deepEqual(resolveFeatureToSubjectIds(federated, { kind: "subject_class", namespaceId: namespace2, definitionId: "class-b" }), [String(subjectA)]);
  const path = shortestSemanticPath(federated, { from: { kind: "subject", subjectId: subjectA }, to: { kind: "subject", subjectId: subjectB } });
  assert.equal(path.depth, 1);
});

test("physical association never creates a target: it only scores an already supplied VenueTarget", () => {
  const subjectA = oid(), subjectB = oid(), target = { subjectId: subjectB }, namespaceId = oid();
  const graph = {
    nodes: new Map([[String(subjectA), {}], [String(subjectB), {}]]),
    canonicalIndex: new Map(), bindingsByNamespaceSubject: new Map(),
    edgesFrom: new Map([
      [String(subjectA), [{ fromSubjectId: subjectA, toSubjectId: subjectB, namespaceId, relationTypeDefinitionId: "rel", traversalWeight: 1 }]],
    ]),
  };
  const candidate = { item: { primarySubjectId: subjectA }, variant: { semanticFocus: [] } };
  assert.ok(physicalAssociationScore({ candidate, target, graph }) > 0);
  const unrelated = { subjectId: oid() };
  assert.equal(physicalAssociationScore({ candidate, target: unrelated, graph }), 0);
});
