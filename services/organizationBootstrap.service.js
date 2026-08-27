const OrganizationRole = require("../models/organizationRole.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const { STARTER_ROLES } = require("./organizationPermissionRegistry.service");

function normalizeName(value) { return String(value || "").trim().toLocaleLowerCase("it-IT"); }

async function ensureStarterRoles({ organizationId, actorUserId, session = null }) {
  for (const starter of STARTER_ROLES) {
    await OrganizationRole.updateOne(
      { organizationId, starterKey: starter.key },
      {
        $set: {
          name: starter.name,
          normalizedName: normalizeName(starter.name),
          description: starter.description,
          permissionCodes: starter.permissionCodes,
          updatedBy: actorUserId,
        },
        $setOnInsert: { organizationId, starterKey: starter.key, createdBy: actorUserId },
      },
      { upsert: true, session, runValidators: true },
    );
  }
  return OrganizationRole.find({ organizationId, starterKey: { $ne: null } }).session(session);
}

async function replaceMembershipWithStarterRole({ organizationId, userId, starterKey, actorUserId, assignedAt = new Date(), session = null }) {
  const role = await OrganizationRole.findOne({ organizationId, starterKey }).session(session);
  if (!role) throw new Error(`Ruolo starter mancante: ${starterKey}`);
  return OrganizationMembership.findOneAndUpdate(
    { organizationId, userId },
    {
      $set: {
        roleAssignments: [{ roleId: role._id, assignedBy: actorUserId, assignedAt }],
        updatedBy: actorUserId,
      },
      $setOnInsert: { createdBy: actorUserId },
    },
    { upsert: true, new: true, runValidators: true, session },
  );
}

module.exports = { ensureStarterRoles, replaceMembershipWithStarterRole };
