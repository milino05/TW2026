const test = require("node:test");
const assert = require("node:assert/strict");
const { projectVenueInventoryOperations } = require("../services/venueInventoryOperations.service");

function codes(result) { return result.availableOperations.map((entry) => entry.code); }

test("Subject/Venue operations distinguish propose, manage, pending and inventory states", () => {
  const proposer = projectVenueInventoryOperations({ effectivePermissions: ["venue.view", "venue.inventory.propose"], actorUserId: "u1" });
  assert.deepEqual(codes(proposer), ["venue.inventory.propose"]);
  assert.equal(proposer.relationshipState, "absent");

  const manager = projectVenueInventoryOperations({ effectivePermissions: ["venue.view", "venue.inventory.propose", "venue.inventory.manage"], actorUserId: "u2" });
  assert.deepEqual(codes(manager), ["venue.inventory.add"]);

  const pendingOwn = projectVenueInventoryOperations({
    proposal: { _id: "p1", status: "pending", proposedByUserId: "u1" },
    effectivePermissions: ["venue.view", "venue.inventory.propose"],
    actorUserId: "u1",
  });
  assert.deepEqual(codes(pendingOwn), ["venue.inventory.withdraw_proposal"]);
  assert.equal(pendingOwn.relationshipState, "proposal_pending");

  const pendingManager = projectVenueInventoryOperations({
    proposal: { _id: "p1", status: "pending", proposedByUserId: "u1" },
    effectivePermissions: ["venue.view", "venue.inventory.propose", "venue.inventory.manage"],
    actorUserId: "u2",
  });
  assert.deepEqual(codes(pendingManager), ["venue.inventory.accept_proposal"]);
  assert.ok(!codes(pendingManager).includes("venue.inventory.add"));

  const exposed = projectVenueInventoryOperations({
    inventory: { venueTargetId: "t1", status: "exposed" },
    effectivePermissions: ["venue.view", "venue.inventory.manage"],
    actorUserId: "u2",
  });
  assert.deepEqual(codes(exposed), ["venue.inventory.open", "venue.map.show"]);
});
