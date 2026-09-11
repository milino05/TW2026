const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function moduleUnderTest() {
  const file = path.resolve(__dirname, "../clients/marketplace/src/ui/semantic-relation-views.js");
  return import(pathToFileURL(file).href);
}

const relations = [{
  definitionId: "created-by",
  key: "created_by",
  label: "Creata da",
  description: "Collega un'opera al suo autore.",
  domainDefinitionIds: ["work"],
  rangeDefinitionIds: ["person"],
  directionality: "directed",
  reverse: { label: "Ha creato", description: "Collega un autore alle opere create." },
}, {
  definitionId: "associated",
  key: "associated",
  label: "Associato a",
  domainDefinitionIds: [],
  rangeDefinitionIds: [],
  directionality: "symmetric",
}];

test("una relation type directed espone due viste linguistiche ma una sola identità canonica", async () => {
  const { relationViews } = await moduleUnderTest();
  const views = relationViews(relations);
  const created = views.filter((entry) => entry.relationTypeDefinitionId === "created-by");
  assert.equal(created.length, 2);
  assert.equal(created.find((entry) => entry.direction === "direct").label, "Creata da");
  assert.equal(created.find((entry) => entry.direction === "reverse").label, "Ha creato");
  assert.deepEqual(created.find((entry) => entry.direction === "reverse").focusDefinitionIds, ["person"]);
  assert.deepEqual(created.find((entry) => entry.direction === "reverse").otherDefinitionIds, ["work"]);
});

test("la categoria del focus filtra la frase diretta o reverse compatibile", async () => {
  const { compatibleRelationViews } = await moduleUnderTest();
  const fromWork = compatibleRelationViews(relations, ["work"])
    .filter((entry) => entry.relationTypeDefinitionId === "created-by");
  const fromPerson = compatibleRelationViews(relations, ["person"])
    .filter((entry) => entry.relationTypeDefinitionId === "created-by");
  assert.deepEqual(fromWork.map((entry) => entry.label), ["Creata da"]);
  assert.deepEqual(fromPerson.map((entry) => entry.label), ["Ha creato"]);
});

test("scegliere la vista reverse scambia gli endpoint solo al confine canonico", async () => {
  const { relationViews, canonicalEndpoints } = await moduleUnderTest();
  const reverse = relationViews(relations).find((entry) => entry.direction === "reverse");
  assert.deepEqual(canonicalEndpoints(reverse, "person-id", "work-id"), {
    sourceSubjectId: "work-id",
    targetSubjectId: "person-id",
  });
});

test("il rendering dal focus usa la label reverse senza duplicare l'edge", async () => {
  const { edgeViewForFocus } = await moduleUnderTest();
  const relation = relations[0];
  const edge = {
    sourceSubjectId: "work-id",
    targetSubjectId: "person-id",
    relationTypeDefinitionId: relation.definitionId,
  };
  assert.deepEqual(edgeViewForFocus(edge, relation, "person-id"), {
    direction: "reverse",
    label: "Ha creato",
    otherSubjectId: "work-id",
  });
  assert.deepEqual(edgeViewForFocus(edge, relation, "work-id"), {
    direction: "direct",
    label: "Creata da",
    otherSubjectId: "person-id",
  });
});

test("una relazione symmetric produce una sola vista reciproca", async () => {
  const { relationViews, edgeViewForFocus } = await moduleUnderTest();
  const symmetric = relationViews(relations).filter((entry) => entry.relationTypeDefinitionId === "associated");
  assert.equal(symmetric.length, 1);
  assert.equal(symmetric[0].direction, "symmetric");
  assert.equal(edgeViewForFocus({ sourceSubjectId: "a", targetSubjectId: "b" }, relations[1], "b").label, "Associato a");
});
