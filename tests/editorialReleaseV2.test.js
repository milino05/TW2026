const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const EditorialContext = require("../models/editorialContext.model");
const { validateGraphSnapshotAgainstNamespace, shortestSemanticPath } = require("../services/semanticGraphV2.service");
const { materializeDirectEdge, materializeReverseEdge } = require("../services/relationSemanticsV2.service");
const { validateEditorialReleasePayload } = require("../services/validation/editorialRelease.validation");
const { buildEditorialContextSummary } = require("../services/editorialContextProjection.service");

function id() { return new mongoose.Types.ObjectId(); }
function namespaceRevisionFixture() {
  return {
    subjectClasses: [{ definitionId: "class-work" }, { definitionId: "class-person" }],
    relationTypes: [{
      definitionId: "rel-created-by",
      key: "created_by",
      label: "Creato da",
      directionality: "directed",
      strength: "strong",
      domainDefinitionIds: ["class-work"],
      rangeDefinitionIds: ["class-person"],
      reverse: { label: "Ha creato" },
    }],
  };
}

test("graph v2 is Subject-based and context-scoped", () => {
  const graphRevisionId = id(), sourceSubjectId = id(), targetSubjectId = id();
  const edge = new SemanticEdgeV2({ graphRevisionId, sourceSubjectId, targetSubjectId, relationTypeDefinitionId: "rel-created-by" });
  assert.equal(edge.museumId, undefined);
  assert.equal(edge.sourceItemId, undefined);
  assert.equal(edge.sourceItemRevisionId, undefined);
  assert.equal(edge.targetItemId, undefined);
  assert.equal(String(edge.sourceSubjectId), String(sourceSubjectId));
  assert.equal(String(edge.targetSubjectId), String(targetSubjectId));
  assert.equal(GraphSubjectBinding.schema.indexes().some(([keys, options]) => keys.graphRevisionId === 1 && keys.subjectId === 1 && options.unique), true);
});

test("SemanticGraphRevision is immutable snapshot metadata", () => {
  for (const path of ["editorialContextId", "version", "authoredAgainstNamespaceRevisionId", "createdBy"]) {
    assert.equal(SemanticGraphRevision.schema.path(path).options.immutable, true);
  }
});

test("graph validation enforces SubjectClass domain and range", () => {
  const work = id(), person = id();
  const valid = validateGraphSnapshotAgainstNamespace({
    subjectBindings: [
      { subjectId: work, subjectClassDefinitionIds: ["class-work"] },
      { subjectId: person, subjectClassDefinitionIds: ["class-person"] },
    ],
    edges: [{ sourceSubjectId: work, targetSubjectId: person, relationTypeDefinitionId: "rel-created-by", weight: 1 }],
  }, namespaceRevisionFixture());
  assert.deepEqual(valid, []);

  const invalid = validateGraphSnapshotAgainstNamespace({
    subjectBindings: [
      { subjectId: work, subjectClassDefinitionIds: ["class-person"] },
      { subjectId: person, subjectClassDefinitionIds: ["class-work"] },
    ],
    edges: [{ sourceSubjectId: work, targetSubjectId: person, relationTypeDefinitionId: "rel-created-by", weight: 1 }],
  }, namespaceRevisionFixture());
  assert.ok(invalid.some((issue) => issue.code === "RELATION_DOMAIN_MISMATCH"));
  assert.ok(invalid.some((issue) => issue.code === "RELATION_RANGE_MISMATCH"));
});

test("relation semantics materializes reverse traversal without a second assertion", () => {
  const source = id(), target = id();
  const relation = namespaceRevisionFixture().relationTypes[0];
  const edge = { _id: id(), graphRevisionId: id(), sourceSubjectId: source, targetSubjectId: target, relationTypeDefinitionId: relation.definitionId, weight: 10 };
  const direct = materializeDirectEdge(edge, relation);
  const reverse = materializeReverseEdge(edge, relation);
  assert.equal(String(direct.fromSubjectId), String(source));
  assert.equal(String(direct.toSubjectId), String(target));
  assert.equal(String(reverse.fromSubjectId), String(target));
  assert.equal(String(reverse.toSubjectId), String(source));
  assert.equal(reverse.generated, true);
});

test("shortest semantic path traverses Subject nodes", () => {
  const a = id(), b = id(), c = id();
  const graph = {
    nodes: new Map([[String(a), {}], [String(b), {}], [String(c), {}]]),
    canonicalIndex: new Map(),
    edgesFrom: new Map([
      [String(a), [{ fromSubjectId: a, toSubjectId: b, relationTypeDefinitionId: "r", traversalWeight: 1 }]],
      [String(b), [{ fromSubjectId: b, toSubjectId: c, relationTypeDefinitionId: "r", traversalWeight: 0.5 }]],
    ]),
  };
  const path = shortestSemanticPath(graph, { from: { kind: "subject", subjectId: a }, to: { kind: "subject", subjectId: c } });
  assert.equal(path.depth, 2);
  assert.deepEqual(path.subjectIds, [String(a), String(b), String(c)]);
});

test("EditorialRelease pins immutable schema graph and item revisions without visibility policy", () => {
  assert.ok(EditorialRelease.schema.path("namespaceRevisionId"));
  assert.ok(EditorialRelease.schema.path("graphRevisionId"));
  assert.ok(EditorialRelease.schema.path("itemBindings"));
  assert.equal(EditorialRelease.schema.path("visibility"), undefined);
  assert.equal(EditorialRelease.schema.path("discoverability"), undefined);
  assert.ok(EditorialContext.schema.path("workingGraphRevisionId"));
  assert.ok(EditorialContext.schema.path("publishedReleaseId"));
});

test("EditorialRelease payload rejects duplicate ItemEdition bindings", () => {
  const editionId = id();
  const issues = validateEditorialReleasePayload({
    namespaceRevisionId: id(),
    graphRevisionId: id(),
    itemBindings: [
      { itemEditionId: editionId, itemRevisionId: id(), curationSignals: [] },
      { itemEditionId: editionId, itemRevisionId: id(), curationSignals: [] },
    ],
  });
  assert.ok(issues.some((issue) => issue.code === "DUPLICATE_VALUE"));
});

test("EditorialContextSummary consumes release-derived stats", () => {
  const summary = buildEditorialContextSummary({
    editorialContext: { _id: id(), displayName: "Approccio", shortDescription: "Sintesi" },
    contentSpace: { _id: id(), name: "Collezione" },
    namespace: { _id: id(), name: "Schema" },
    curator: { id: id(), displayName: "Curatore" },
    stats: { availableItemCount: 12, subjectCount: 8 },
  });
  assert.deepEqual(summary.stats, { availableItemCount: 12, subjectCount: 8 });
});
