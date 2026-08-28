const test = require("node:test");
const assert = require("node:assert/strict");

const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");
const { physicalNavigationActionDefinition } = require("../config/runtimeActions");

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
});
