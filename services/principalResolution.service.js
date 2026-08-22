const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { hasOrganizationRole } = require("./organizationAuthorization.service");

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

async function resolveActorPrincipals(actorUserId) {
  const user = await getActiveUserOrFail(actorUserId);
  const membershipIds = (user.organizationMemberships || [])
    .filter((entry) => ["operator", "manager"].includes(entry.role))
    .map((entry) => entry.organizationId);
  const activeOrganizations = membershipIds.length
    ? await Organization.find({ _id: { $in: membershipIds }, lifecycleStatus: "active" }).select("_id").lean()
    : [];
  const activeIds = new Set(activeOrganizations.map((entry) => String(entry._id)));
  const organizationPrincipals = (user.organizationMemberships || [])
    .filter((entry) => activeIds.has(String(entry.organizationId)))
    .map((entry) => ({ type: "organization", id: entry.organizationId, role: entry.role }));
  return {
    user,
    principals: [{ type: "user", id: user._id, role: "owner" }, ...organizationPrincipals],
  };
}

async function assertCanActForPrincipal({ actorUserId, principalType, principalId, minimumOrganizationRole = "operator" }) {
  const { user } = await resolveActorPrincipals(actorUserId);
  if (principalType === "user" && sameId(user._id, principalId)) return user;
  if (principalType === "organization" && hasOrganizationRole(user, principalId, minimumOrganizationRole)) {
    const organization = await Organization.exists({ _id: principalId, lifecycleStatus: "active" });
    if (organization) return user;
  }
  throw new AppError("Principal non disponibile per l'actor corrente", 403, [{ code: "PRINCIPAL_AUTHORITY_REQUIRED" }]);
}

module.exports = {
  resolveActorPrincipals,
  assertCanActForPrincipal,
};
