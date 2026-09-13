const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");

async function getVenueInventoryCapabilities({ organizationId, actorUserId }) {
  const authority = await resolveOrganizationAuthority({ userId: actorUserId, organizationId });
  const permissions = new Set(authority?.effectivePermissions || []);
  return {
    canView: permissions.has("venue.view"),
    canPropose: permissions.has("venue.inventory.propose"),
    canManage: permissions.has("venue.inventory.manage"),
  };
}

module.exports = { getVenueInventoryCapabilities };
