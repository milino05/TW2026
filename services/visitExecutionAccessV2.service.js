const User = require("../models/user");
const AppError = require("../utils/AppError");

async function assertCanExecuteVisitV2(visit, userId) {
  if (!visit) throw new AppError("Visita non trovata", 404);
  if (visit.ownerType === "user" && String(visit.ownerId) === String(userId)) return { basis: "ownership" };
  if (visit.ownerType === "organization") {
    const user = await User.findById(userId).select("organizationMemberships status").lean();
    const membership = (user?.organizationMemberships || []).find((entry) => String(entry.organizationId) === String(visit.ownerId));
    if (user?.status === "active" && membership) return { basis: "organization_membership", role: membership.role };
  }
  throw new AppError("Accesso all'esecuzione della visita non disponibile", 403, [{ code: "VISIT_EXECUTION_ACCESS_REQUIRED" }]);
}

module.exports = { assertCanExecuteVisitV2 };
