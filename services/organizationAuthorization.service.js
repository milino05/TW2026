const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");

const ROLE_RANK = Object.freeze({
  operator: 1,
  manager: 2,
});

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function getOrganizationMembership(user, organizationId) {
  return (user?.organizationMemberships || []).find(
    (membership) => sameId(membership.organizationId, organizationId),
  ) || null;
}

function hasOrganizationRole(user, organizationId, minimumRole) {
  const membership = getOrganizationMembership(user, organizationId);
  return Boolean(
    membership &&
      ROLE_RANK[membership.role] &&
      ROLE_RANK[minimumRole] &&
      ROLE_RANK[membership.role] >= ROLE_RANK[minimumRole],
  );
}

async function assertOrganizationRole({ userId, organizationId, minimumRole }) {
  if (!ROLE_RANK[minimumRole]) throw new Error(`Ruolo minimo sconosciuto: ${minimumRole}`);
  const user = await getActiveUserOrFail(userId);
  if (!hasOrganizationRole(user, organizationId, minimumRole)) {
    throw new AppError(
      minimumRole === "manager"
        ? "E richiesto il ruolo di manager dell'organizzazione"
        : "E richiesto il ruolo di operator o manager dell'organizzazione",
      403,
    );
  }
  return user;
}

module.exports = {
  ROLE_RANK,
  getOrganizationMembership,
  hasOrganizationRole,
  assertOrganizationRole,
};
