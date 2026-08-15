const User = require("../models/user");
const AppError = require("../utils/AppError");

const ROLE_RANK = {
  operator: 1,
  manager: 2,
};

function sameId(a, b) {
  return String(a) === String(b);
}

async function getActiveUserOrFail(userId) {
  const user = await User.findOne({ _id: userId, status: "active" });

  if (!user) {
    throw new AppError("Utente non autorizzato", 403);
  }

  return user;
}

function getMuseumMembership(user, museumId) {
  return (user.memberships || []).find((membership) => sameId(membership.museumId, museumId)) || null;
}

function hasMuseumRole(user, museumId, minimumRole) {
  const membership = getMuseumMembership(user, museumId);
  return Boolean(
    membership &&
      ROLE_RANK[membership.role] &&
      ROLE_RANK[membership.role] >= ROLE_RANK[minimumRole],
  );
}

async function assertMuseumRole({ userId, museumId, minimumRole }) {
  if (!ROLE_RANK[minimumRole]) {
    throw new Error(`Ruolo minimo sconosciuto: ${minimumRole}`);
  }

  const user = await getActiveUserOrFail(userId);

  if (!hasMuseumRole(user, museumId, minimumRole)) {
    throw new AppError(
      minimumRole === "manager"
        ? "E richiesto il ruolo di manager del museo"
        : "E richiesto il ruolo di operatore o manager del museo",
      403,
    );
  }

  return user;
}

module.exports = {
  ROLE_RANK,
  getActiveUserOrFail,
  getMuseumMembership,
  hasMuseumRole,
  assertMuseumRole,
};
