const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { assertOrganizationMembership, assertOrganizationPermission } = require("./organizationAuthorization.service");

const OWNER_TYPES = Object.freeze(["user", "organization"]);
function sameId(a, b) { return String(a || "") === String(b || ""); }
function userCanActForOwner(user, { ownerType, ownerId }) { return ownerType === "user" && sameId(user?._id, ownerId); }

async function assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode = null }) {
  if (!OWNER_TYPES.includes(ownerType)) {
    throw new AppError("Owner type non valido", 400, [{ field: "ownerType", code: "INVALID_ENUM", allowedValues: OWNER_TYPES }]);
  }
  const user = await getActiveUserOrFail(actorUserId);
  if (ownerType === "user") {
    if (!userCanActForOwner(user, { ownerType, ownerId })) throw new AppError("L'utente non puo agire per il proprietario indicato", 403);
    return user;
  }
  if (permissionCode) await assertOrganizationPermission({ userId: actorUserId, organizationId: ownerId, permissionCode });
  else await assertOrganizationMembership({ userId: actorUserId, organizationId: ownerId });
  return user;
}

module.exports = { OWNER_TYPES, userCanActForOwner, assertCanActForOwner };
