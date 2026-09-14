const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");
const { physicalNavigationActionDefinition, placeNavigationActionDefinition } = require("../config/runtimeActions");

test("PhysicalVocabulary starter derives elevator and stairs controlled voice actions", () => {
  const starter = applyPhysicalStarter({}).snapshot;
  const elevatorDefinition = starter.placeTypes.find((definition) => definition.key === "elevator");
  const stairsDefinition = starter.placeTypes.find((definition) => definition.key === "stairs");

  const elevator = physicalNavigationActionDefinition(elevatorDefinition);
  const stairs = physicalNavigationActionDefinition(stairsDefinition);
  assert.equal(elevator.actionId, `navigation.place.${elevatorDefinition.definitionId}`);
  assert.equal(elevator.label, "Trova Ascensore");
  assert.ok(elevator.controlledVoiceAliases.includes("dov'è ascensore"));
  assert.equal(stairs.actionId, `navigation.place.${stairsDefinition.definitionId}`);
  assert.equal(stairs.label, "Trova Scale");
  assert.ok(stairs.controlledVoiceAliases.includes("trova scala"));
  assert.ok(stairs.controlledVoiceAliases.includes("dove sono le scale"));

  const toiletsDefinition = starter.placeTypes.find((definition) => definition.key === "toilets");
  const toilets = physicalNavigationActionDefinition(toiletsDefinition);
  assert.ok(toilets.controlledVoiceAliases.includes("dov'è il bagno"));
});

test("ogni luogo può produrre una destinazione specifica visibile e vocale", () => {
  const action = placeNavigationActionDefinition({
    placeId: "sala-etrusca",
    label: "Sala etrusca",
    aliases: ["etruschi"],
  });
  assert.equal(action.actionId, "navigation.destination.sala-etrusca");
  assert.equal(action.type, "NAVIGATE_TO_PLACE");
  assert.equal(action.label, "Vai a Sala etrusca");
  assert.ok(action.controlledVoiceAliases.includes("portami a sala etrusca"));
  assert.ok(action.controlledVoiceAliases.includes("vai a etruschi"));
});
