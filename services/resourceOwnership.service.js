const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { hasOrganizationRole } = require("./organizationAuthorization.service");

const OWNER_TYPES = Object.freeze(["user", "organization"]);

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function userCanActForOwner(user, { ownerType, ownerId }, { minimumOrganizationRole = "operator" } = {}) {
  if (ownerType === "user") return sameId(user?._id, ownerId);
  if (ownerType === "organization") {
    return hasOrganizationRole(user, ownerId, minimumOrganizationRole);
  }
  return false;
}

async function assertCanActForOwner({
  actorUserId,
  ownerType,
  ownerId,
  minimumOrganizationRole = "operator",
}) {
  if (!OWNER_TYPES.includes(ownerType)) {
    throw new AppError("Owner type non valido", 400, [{
      field: "ownerType",
      code: "INVALID_ENUM",
      allowedValues: OWNER_TYPES,
    }]);
  }
  const user = await getActiveUserOrFail(actorUserId);
  if (!userCanActForOwner(user, { ownerType, ownerId }, { minimumOrganizationRole })) {
    throw new AppError("L'utente non puo agire per il proprietario indicato", 403);
  }
  return user;
}

module.exports = {
  OWNER_TYPES,
  userCanActForOwner,
  assertCanActForOwner,
};
