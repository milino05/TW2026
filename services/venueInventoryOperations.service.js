function id(value) { return String(value?._id || value?.id || value || ""); }
function operation(code, label) { return { code, label }; }

function projectPendingProposal(proposal, actorUserId) {
  if (!proposal) return null;
  return {
    id: proposal._id,
    status: proposal.status || "pending",
    proposedByUserId: proposal.proposedByUserId,
    createdAt: proposal.createdAt,
    message: proposal.message || null,
    isOwn: id(proposal.proposedByUserId) === id(actorUserId),
  };
}

function relationshipState({ inventory, proposal }) {
  if (inventory?.venueTargetId) return inventory.status || "unplaced";
  if (proposal) return "proposal_pending";
  return "absent";
}

function projectVenueInventoryOperations({ inventory = null, proposal = null, effectivePermissions = [], actorUserId }) {
  const permissions = effectivePermissions instanceof Set ? effectivePermissions : new Set(effectivePermissions || []);
  const projectedProposal = projectPendingProposal(proposal, actorUserId);
  const alreadyInventoried = Boolean(inventory?.venueTargetId);
  const operations = [];

  if (alreadyInventoried) {
    if (permissions.has("venue.view")) operations.push(operation("venue.inventory.open", "Apri inventario"));
    if (inventory?.status === "exposed") operations.push(operation("venue.map.show", "Mostra sulla mappa"));
  } else if (projectedProposal) {
    if (permissions.has("venue.inventory.manage")) operations.push(operation("venue.inventory.accept_proposal", "Accetta nell'inventario"));
    if (projectedProposal.isOwn) operations.push(operation("venue.inventory.withdraw_proposal", "Ritira proposta"));
  } else if (permissions.has("venue.inventory.manage")) {
    operations.push(operation("venue.inventory.add", "Aggiungi all'inventario"));
  } else if (permissions.has("venue.inventory.propose")) {
    operations.push(operation("venue.inventory.propose", "Proponi"));
  }

  return {
    proposal: projectedProposal,
    relationshipState: relationshipState({ inventory, proposal: projectedProposal }),
    availableOperations: operations,
  };
}

module.exports = { projectPendingProposal, relationshipState, projectVenueInventoryOperations };
