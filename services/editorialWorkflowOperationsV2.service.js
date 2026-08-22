const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);

function operation(code, label, extra = {}) {
  return { code, label, ...extra };
}

function isOrganizationEditor(role) {
  return role === "operator" || role === "manager";
}

function projectEditorialWorkflowOperations({ ownerType, actorRole, revision }) {
  if (!revision) return [];
  const status = revision.status;
  const integrityValid = revision.integrity?.status === "valid";
  const operations = [];

  if (status === "draft") {
    operations.push(operation("workflow.check", "Controlla consistenza"));
  }

  if (ownerType === "user") {
    if (status === "draft" && integrityValid) {
      operations.push(operation("workflow.publish", "Pubblica"));
    }
    return operations;
  }

  if (ownerType !== "organization" || !isOrganizationEditor(actorRole)) return operations;

  if (status === "draft" && integrityValid) {
    operations.push(operation("workflow.request_review", "Invia in revisione"));
  }
  if (status === "in_review") {
    operations.push(operation("workflow.withdraw_review", "Ritira dalla revisione"));
    if (actorRole === "manager") {
      operations.push(operation("workflow.request_changes", "Richiedi modifiche", { requiresMessage: true }));
      if (integrityValid) operations.push(operation("workflow.publish", "Approva e pubblica"));
    }
  }

  return operations;
}

function mayEditEditorialRevision(revision) {
  return Boolean(revision && EDITABLE_STATUSES.has(revision.status));
}

module.exports = {
  projectEditorialWorkflowOperations,
  mayEditEditorialRevision,
};
