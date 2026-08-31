const WORKFLOW_PRESENTATION = Object.freeze({
  check: { kind: "workflow", intent: "neutral", label: "Controlla consistenza" },
  request_review: { kind: "workflow", intent: "primary", label: "Invia in revisione" },
  withdraw_review: { kind: "workflow", intent: "secondary", label: "Ritira dalla revisione" },
  request_changes: { kind: "workflow", intent: "warning", label: "Richiedi modifiche" },
  publish: { kind: "workflow", intent: "primary", label: "Pubblica" },
  approve_review_and_publish: { kind: "workflow", intent: "primary", label: "Approva e pubblica" },
  publish_without_review: { kind: "workflow", intent: "primary", label: "Pubblica" },
});

function normalizedCode(value) { return String(value || "").trim(); }

export function operationFamily(code) {
  const value = normalizedCode(code);
  if (!value) return "unknown";
  if (value.includes("workflow") || Object.keys(WORKFLOW_PRESENTATION).some((suffix) => value.endsWith(`.${suffix}`))) return "workflow";
  if (/remove|delete|trash|detach|withdraw/i.test(value)) return "destructive";
  if (/create|add|copy|fork|materialize|accept/i.test(value)) return "constructive";
  return "command";
}

function workflowSuffix(code) {
  const value = normalizedCode(code);
  return Object.keys(WORKFLOW_PRESENTATION).find((suffix) => value.endsWith(`.${suffix}`) || value === suffix) || null;
}

function inferredPresentation(code) {
  const suffix = workflowSuffix(code);
  if (suffix) return WORKFLOW_PRESENTATION[suffix];
  const family = operationFamily(code);
  if (family === "destructive") return { kind: family, intent: "danger" };
  if (family === "constructive") return { kind: family, intent: "primary" };
  return { kind: family, intent: "secondary" };
}

/**
 * Adds presentation metadata to one operation that already exists in the backend projection.
 * It never synthesizes an operation or decides whether the user is authorized to invoke it.
 */
export function operationDescriptor(operation, overrides = {}) {
  if (!operation || typeof operation !== "object") throw new TypeError("operationDescriptor requires a backend operation.");
  const code = normalizedCode(operation.code);
  if (!code) throw new TypeError("Backend operation is missing code.");
  const inferred = inferredPresentation(code);
  return {
    ...operation,
    presentation: {
      kind: inferred.kind,
      intent: inferred.intent,
      label: String(operation.label || inferred.label || code),
      requiresMessage: operation.requiresMessage === true,
      ...overrides,
    },
  };
}

export function presentAvailableOperations(operations, overridesByCode = {}) {
  if (!Array.isArray(operations)) return [];
  return operations.map((operation) => operationDescriptor(operation, overridesByCode[operation.code] || {}));
}

export function findPresentedOperation(operations, code, overridesByCode = {}) {
  return presentAvailableOperations(operations, overridesByCode).find((operation) => operation.code === code) || null;
}
