const { ensureStarterRoles, replaceMembershipWithStarterRole } = require("../../services/organizationBootstrap.service");

async function assignStarterRole({ organization, user, starterKey = "administrator", actorUserId = organization.createdBy }) {
  await ensureStarterRoles({ organizationId: organization._id, actorUserId });
  return replaceMembershipWithStarterRole({ organizationId: organization._id, userId: user._id, starterKey, actorUserId });
}

module.exports = { assignStarterRole };
