const test = require("node:test");
const assert = require("node:assert/strict");
const { featureKey, edgeWeight, neighbors, outgoingEdges, incomingEdges, shortestSemanticPath } = require("../services/semanticGraph.service");
const { materializeDirectEdge, materializeReverseEdge, buildRelationViews } = require("../services/relationSemantics.service");

const directedType = {
  key: "created_by",
  label: "Creato da",
  directionality: "directed",
  domain: ["artwork"],
  range: ["artist"],
  strength: "strong",
  reverse: { label: "Ha creato" },
  semanticRefs: [{ scheme: "shared", id: "creator", matchType: "exact" }],
};
const symmetricType = {
  key: "related_to",
  label: "Collegato a",
  directionality: "symmetric",
  domain: [],
  range: [],
  strength: "medium",
  semanticRefs: [],
};
function persistentEdge(overrides = {}) {
  return { _id: "edge-1", museumId: "museum", sourceItemId: "a", sourceItemRevisionId: "rev-a", targetItemId: "b", relationTypeKey: "created_by", weight: 10, ...overrides };
}
function graphFrom(edges) {
  const edgesFrom = new Map();
  for (const edge of edges) {
    const key = String(edge.fromItemId);
    if (!edgesFrom.has(key)) edgesFrom.set(key, []);
    edgesFrom.get(key).push(edge);
  }
  return { nodes: new Map([["a", {}], ["b", {}], ["c", {}]]), canonicalIndex: new Map(), edgesFrom };
}

test("featureKey canonical e stabile cross-museum", () => {
  assert.equal(featureKey({ kind: "canonical", scheme: "Wikidata", refId: "Q42" }), "canonical:wikidata::Q42");
});

test("edgeWeight combina strength e peso dell'istanza", () => {
  assert.equal(edgeWeight({ weight: 10 }, { strength: "strong" }), 1);
  assert.ok(edgeWeight({ weight: 5 }, { strength: "weak" }) < edgeWeight({ weight: 5 }, { strength: "strong" }));
});

test("una relazione persistita produce viste diretta e inversa senza duplicare il fatto", () => {
  const edge = persistentEdge();
  const direct = materializeDirectEdge(edge, directedType);
  const reverse = materializeReverseEdge(edge, directedType);
  assert.equal(direct.fromItemId, "a");
  assert.equal(direct.toItemId, "b");
  assert.equal(direct.viewKey, "created_by");
  assert.equal(reverse.fromItemId, "b");
  assert.equal(reverse.toItemId, "a");
  assert.equal(reverse.viewKey, "created_by:reverse");
  assert.equal(reverse.generated, true);
  assert.equal(reverse.edgeId, direct.edgeId);
});

test("una relazione simmetrica usa lo stesso RelationType nelle due direzioni logiche", () => {
  const edge = persistentEdge({ relationTypeKey: "related_to" });
  const direct = materializeDirectEdge(edge, symmetricType);
  const reverse = materializeReverseEdge(edge, symmetricType);
  assert.equal(direct.viewKey, "related_to");
  assert.equal(reverse.viewKey, "related_to");
  assert.equal(reverse.direction, "symmetric");
  assert.equal(reverse.generated, true);
});

test("RelationType materializza una sola reverse view per le relazioni dirette", () => {
  const views = buildRelationViews([directedType, symmetricType]);
  assert.deepEqual(views.map((view) => view.viewKey), ["created_by", "created_by:reverse", "related_to"]);
});

test("neighbors e incoming/outgoing lavorano sulle viste materializzate del grafo", () => {
  const persisted = persistentEdge();
  const direct = materializeDirectEdge(persisted, directedType);
  const reverse = materializeReverseEdge(persisted, directedType);
  const graph = graphFrom([direct, reverse]);
  assert.equal(outgoingEdges(graph, "a").length, 1);
  assert.equal(incomingEdges(graph, "b").length, 1);
  assert.equal(neighbors(graph, "b", { relationTypeKey: "created_by:reverse" })[0].toItemId, "a");
});

test("shortestSemanticPath attraversa anche le inverse derivate", () => {
  const first = persistentEdge();
  const second = persistentEdge({ _id: "edge-2", sourceItemId: "c", sourceItemRevisionId: "rev-c", targetItemId: "b" });
  const edges = [
    materializeDirectEdge(first, directedType), materializeReverseEdge(first, directedType),
    materializeDirectEdge(second, directedType), materializeReverseEdge(second, directedType),
  ];
  const graph = graphFrom(edges);
  const path = shortestSemanticPath(graph, { from: { kind: "item", itemId: "a" }, to: { kind: "item", itemId: "c" }, maxDepth: 2 });
  assert.deepEqual(path.itemIds, ["a", "b", "c"]);
});
