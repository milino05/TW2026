const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { permissionClosure, permissionsAreSubset } = require("./organizationPermissionRegistry.service");

function id(value) { return String(value?._id || value || ""); }

function effectivePermissionsForMembership(membership) {
  const codes = (membership?.roleAssignments || []).flatMap((assignment) => (
    assignment.roleId?.permissionCodes || []
  ));
  return permissionClosure(codes);
}

async function resolveOrganizationAuthority({ userId, organizationId, session = null }) {
  const [user, organization, membership] = await Promise.all([
    getActiveUserOrFail(userId),
    Organization.findOne({ _id: organizationId, lifecycleStatus: "active" }).session(session).lean(),
    OrganizationMembership.findOne({ organizationId, userId })
      .populate("roleAssignments.roleId")
      .session(session)
      .lean(),
  ]);
  if (!organization) throw new AppError("Organizzazione non trovata", 404);
  const isOwner = organization.owners.some((owner) => id(owner.userId) === id(userId));
  const roleAssignments = (membership?.roleAssignments || []).filter((assignment) => assignment.roleId);
  return {
    user,
    organization,
    membership: membership ? { ...membership, roleAssignments } : null,
    roles: roleAssignments.map((assignment) => assignment.roleId),
    effectivePermissions: effectivePermissionsForMembership({ roleAssignments }),
    isOwner,
  };
}

async function assertOrganizationMembership({ userId, organizationId, session = null }) {
  const authority = await resolveOrganizationAuthority({ userId, organizationId, session });
  if (!authority.membership || authority.roles.length === 0) {
    throw new AppError("Membership attiva richiesta per questa organizzazione", 403, [{ code: "ORGANIZATION_MEMBERSHIP_REQUIRED" }]);
  }
  return authority;
}

async function assertOrganizationPermission({ userId, organizationId, permissionCode, session = null }) {
  const authority = await assertOrganizationMembership({ userId, organizationId, session });
  if (!authority.effectivePermissions.includes(permissionCode)) {
    throw new AppError("Non disponi del permesso richiesto", 403, [{
      code: "ORGANIZATION_PERMISSION_REQUIRED",
      permissionCode,
    }]);
  }
  return authority;
}

async function hasOrganizationPermission({ userId, organizationId, permissionCode }) {
  try {
    const authority = await assertOrganizationMembership({ userId, organizationId });
    return authority.effectivePermissions.includes(permissionCode);
  } catch (error) {
    if ([403, 404].includes(error?.status)) return false;
    throw error;
  }
}

function assertDelegationCeiling({ authority, permissionCodes }) {
  const requested = permissionClosure(permissionCodes);
  if (!authority.isOwner && !permissionsAreSubset(requested, authority.effectivePermissions)) {
    throw new AppError("Non puoi delegare permessi che non possiedi", 403, [{ code: "DELEGATION_CEILING_EXCEEDED" }]);
  }
  return requested;
}

module.exports = {
  effectivePermissionsForMembership,
  resolveOrganizationAuthority,
  assertOrganizationMembership,
  assertOrganizationPermission,
  hasOrganizationPermission,
  assertDelegationCeiling,
};
