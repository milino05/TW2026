const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function bindingFromAccess({ access, effectiveRevisionId }) {
  const pinned = access?.basis === "entitlement" && access.entitlement?.versionPolicy === "pinned";
  const resolved = access?.resolvedSnapshotRef?.resourceId || effectiveRevisionId || null;
  if (pinned && !resolved) {
    throw new AppError("Dipendenza pinned senza revisione autorizzata", 409, [{ code: "PINNED_DEPENDENCY_REVISION_REQUIRED" }]);
  }
  return {
    versionPolicy: pinned ? "pinned" : "follow_current",
    pinnedRevisionId: pinned ? resolved : null,
    validation: null,
  };
}

function effectiveRevisionId({ binding, publishedRevisionId }) {
  if (binding?.versionPolicy === "pinned") {
    if (!binding.pinnedRevisionId) {
      throw new AppError("Dipendenza pinned senza revisione", 409, [{ code: "PINNED_DEPENDENCY_REVISION_REQUIRED" }]);
    }
    return binding.pinnedRevisionId;
  }
  if (!publishedRevisionId) {
    throw new AppError("La dipendenza live non ha una revisione pubblicata", 409, [{ code: "PUBLISHED_DEPENDENCY_REVISION_REQUIRED" }]);
  }
  return publishedRevisionId;
}

function isValidationFresh({ binding, consumerSnapshotId, dependencyRevisionId }) {
  const validation = binding?.validation;
  return Boolean(
    validation?.checkedAt
    && id(validation.consumerSnapshotId) === id(consumerSnapshotId)
    && id(validation.dependencyRevisionId) === id(dependencyRevisionId)
  );
}

function buildValidation({ consumerSnapshotId, dependencyRevisionId, issues = [], outcome = null, checkedAt = new Date() }) {
  const blocking = (issues || []).some((issue) => issue?.severity !== "warning");
  return {
    consumerSnapshotId: consumerSnapshotId || null,
    dependencyRevisionId,
    status: blocking ? "needs_review" : "valid",
    outcome: outcome || (blocking ? "requires_review" : "compatible"),
    issues: issues || [],
    checkedAt,
  };
}

function projectDependencyState(binding = null) {
  if (!binding) return null;
  const validation = binding.validation || null;
  return {
    versionPolicy: binding.versionPolicy,
    pinnedRevisionId: binding.pinnedRevisionId || null,
    validation: validation ? {
      consumerSnapshotId: validation.consumerSnapshotId || null,
      dependencyRevisionId: validation.dependencyRevisionId || null,
      status: validation.status,
      outcome: validation.outcome || null,
      issues: validation.issues || [],
      checkedAt: validation.checkedAt || null,
    } : null,
  };
}

module.exports = {
  id,
  bindingFromAccess,
  effectiveRevisionId,
  isValidationFresh,
  buildValidation,
  projectDependencyState,
};
