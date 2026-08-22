const test = require("node:test");
const assert = require("node:assert/strict");

const { getRoutingAttributeCatalog } = require("../services/routingAttributeCatalog.service");
const { navigationActionDefinition } = require("../config/runtimeActions");

test("canonical facility catalog includes elevator and stairs with controlled voice actions", () => {
  const catalog = getRoutingAttributeCatalog();
  assert.equal(catalog.placeIntents.includes("FIND_ELEVATOR"), true);
  assert.equal(catalog.placeIntents.includes("FIND_STAIRS"), true);

  const elevator = navigationActionDefinition("FIND_ELEVATOR");
  const stairs = navigationActionDefinition("FIND_STAIRS");
  assert.equal(elevator.actionId, "navigation.place.find_elevator");
  assert.equal(elevator.label, "Trova un ascensore");
  assert.ok(elevator.controlledVoiceAliases.includes("dov'è l'ascensore"));
  assert.equal(stairs.actionId, "navigation.place.find_stairs");
  assert.equal(stairs.label, "Trova le scale");
  assert.ok(stairs.controlledVoiceAliases.includes("dove sono le scale"));
});
