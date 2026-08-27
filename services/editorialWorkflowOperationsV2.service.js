const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);

function operation(code, label, extra = {}) {
  return { code, label, ...extra };
}

function projectEditorialWorkflowOperations({ ownerType, capabilities = {}, revision, finalizePrivatelyOnCheck = false }) {
  if (!revision) return [];
  const status = revision.status;
  const integrityValid = revision.integrity?.status === "valid";
  const operations = [];

  const canEdit = ownerType === "user" || capabilities.edit === true;
  const canReview = ownerType === "user" || capabilities.review === true;
  const canPublish = ownerType === "user" || capabilities.publish === true;

  if (status === "draft" && canEdit) {
    operations.push(operation("workflow.check", "Controlla consistenza"));
  }

  if (finalizePrivatelyOnCheck) return operations;

  if (ownerType === "user") {
    if (status === "draft" && integrityValid) {
      operations.push(operation("workflow.publish", "Pubblica"));
    }
    return operations;
  }

  if (ownerType !== "organization") return operations;

  if (status === "draft" && integrityValid && canEdit) {
    operations.push(operation("workflow.request_review", "Invia in revisione"));
  }
  if (status === "in_review") {
    if (canEdit) operations.push(operation("workflow.withdraw_review", "Ritira dalla revisione"));
    if (canReview) {
      operations.push(operation("workflow.request_changes", "Richiedi modifiche", { requiresMessage: true }));
    }
    if (canPublish && integrityValid) operations.push(operation("workflow.publish", "Approva e pubblica"));
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
