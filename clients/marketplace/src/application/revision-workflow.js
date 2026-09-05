import { presentAvailableOperations, workflowOperationKey } from "./operation-presentation.js";

const ORDER = [
  "check",
  "request_review",
  "withdraw_review",
  "request_changes",
  "approve_review",
  "approve_review_and_publish",
  "publish_without_review",
  "publish",
];

function workflowRank(code) {
  const key = workflowOperationKey(code);
  const index = ORDER.indexOf(key);
  return index < 0 ? ORDER.length : index;
}

export function isRevisionWorkflowOperation(operation) {
  return Boolean(workflowOperationKey(operation?.code));
}

/**
 * Filters and orders backend-authoritative operations for a revision workflow surface.
 * No missing operation is ever inferred or synthesized here.
 */
export function revisionWorkflowOperations(availableOperations, overridesByCode = {}) {
  return presentAvailableOperations(availableOperations, overridesByCode)
    .filter(isRevisionWorkflowOperation)
    .sort((left, right) => workflowRank(left.code) - workflowRank(right.code));
}
