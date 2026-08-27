const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { effectivePermissionsForMembership } = require("./organizationAuthorization.service");

function sameId(a, b) { return String(a || "") === String(b || ""); }

async function resolveActorPrincipals(actorUserId) {
  const user = await getActiveUserOrFail(actorUserId);
  const memberships = await OrganizationMembership.find({ userId: user._id })
    .populate("roleAssignments.roleId")
    .lean();
  const organizationIds = memberships.map((entry) => entry.organizationId);
  const activeOrganizations = organizationIds.length
    ? await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("_id owners").lean()
    : [];
  const organizationById = new Map(activeOrganizations.map((entry) => [String(entry._id), entry]));
  const organizationPrincipals = memberships
    .filter((entry) => organizationById.has(String(entry.organizationId)) && entry.roleAssignments.length > 0)
    .map((entry) => {
      const organization = organizationById.get(String(entry.organizationId));
      return {
        type: "organization",
        id: entry.organizationId,
        roles: entry.roleAssignments.map((assignment) => ({ id: assignment.roleId._id, name: assignment.roleId.name })),
        isOwner: organization.owners.some((owner) => sameId(owner.userId, user._id)),
        effectivePermissions: effectivePermissionsForMembership(entry),
      };
    });
  return {
    user,
    principals: [{ type: "user", id: user._id, roles: [], isOwner: true, effectivePermissions: [] }, ...organizationPrincipals],
  };
}

async function assertCanActForPrincipal({ actorUserId, principalType, principalId, permissionCode = null }) {
  const { user, principals } = await resolveActorPrincipals(actorUserId);
  if (principalType === "user" && sameId(user._id, principalId)) return user;
  const principal = principals.find((entry) => entry.type === "organization" && sameId(entry.id, principalId));
  if (principal && (!permissionCode || principal.effectivePermissions.includes(permissionCode))) return user;
  throw new AppError("Principal non disponibile per l'actor corrente", 403, [{
    code: permissionCode ? "ORGANIZATION_PERMISSION_REQUIRED" : "PRINCIPAL_AUTHORITY_REQUIRED",
    ...(permissionCode ? { permissionCode } : {}),
  }]);
}

module.exports = { resolveActorPrincipals, assertCanActForPrincipal };
