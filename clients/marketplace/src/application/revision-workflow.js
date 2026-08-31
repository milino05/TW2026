import { presentAvailableOperations } from "./operation-presentation.js";

const ORDER = [
  "check",
  "request_review",
  "withdraw_review",
  "request_changes",
  "approve_review_and_publish",
  "publish_without_review",
  "publish",
];

function workflowRank(code) {
  const value = String(code || "");
  const index = ORDER.findIndex((suffix) => value === suffix || value.endsWith(`.${suffix}`));
  return index < 0 ? ORDER.length : index;
}

export function isRevisionWorkflowOperation(operation) {
  const code = String(operation?.code || "");
  return code.includes("workflow") || ORDER.some((suffix) => code === suffix || code.endsWith(`.${suffix}`));
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
