const { Adoption, ADOPTION_ACTIONS } = require("../models/adoption.model");
const AppError = require("../utils/AppError");

function sameRef(a, b) {
  return Boolean(a && b)
    && a.resourceType === b.resourceType
    && String(a.resourceId || "") === String(b.resourceId || "");
}

async function recordAdoptionFromAccess({
  access,
  actorUserId,
  action,
  sourceResourceRef = null,
  sourceSnapshotRef = null,
  targetResourceRef = null,
  resultResourceRef = null,
}) {
  if (access?.basis !== "entitlement" || !access.entitlement) return null;
  if (!ADOPTION_ACTIONS.includes(action)) {
    throw new AppError("Azione Adoption non supportata", 500, [{ code: "INVALID_ADOPTION_ACTION", action }]);
  }
  const resolvedSource = sourceResourceRef || access.requestedResourceRef;
  const resolvedSnapshot = sourceSnapshotRef || access.resolvedSnapshotRef || access.entitlement.baselineSnapshotRef;
  if (!resolvedSource || !resolvedSnapshot) {
    throw new AppError("Adoption senza sorgente risolvibile", 500, [{ code: "ADOPTION_SOURCE_REQUIRED" }]);
  }
  if (access.resolvedSnapshotRef && !sameRef(resolvedSnapshot, access.resolvedSnapshotRef)) {
    throw new AppError("Adoption non coerente con la snapshot autorizzata", 500, [{ code: "ADOPTION_SNAPSHOT_MISMATCH" }]);
  }
  return Adoption.create({
    beneficiaryType: access.entitlement.beneficiaryType,
    beneficiaryId: access.entitlement.beneficiaryId,
    entitlementId: access.entitlement._id,
    sourceResourceRef: resolvedSource,
    sourceSnapshotRef: resolvedSnapshot,
    action,
    targetResourceRef,
    resultResourceRef,
    adoptedBy: actorUserId,
  });
}

module.exports = { recordAdoptionFromAccess };
