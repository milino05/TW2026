export type OperationIntent = "primary" | "secondary" | "neutral" | "warning" | "danger";
export type OperationKind = "workflow" | "destructive" | "constructive" | "command" | "unknown";

export type BackendOperation = {
  code: string;
  label?: string;
  requiresMessage?: boolean;
  [key: string]: unknown;
};

export type OperationPresentation = {
  kind: OperationKind;
  intent: OperationIntent;
  label: string;
  requiresMessage: boolean;
};

const workflowPresentation: Record<string, Partial<OperationPresentation>> = {
  check: { kind: "workflow", intent: "neutral", label: "Controlla consistenza" },
  request_review: { kind: "workflow", intent: "primary", label: "Invia in revisione" },
  withdraw_review: { kind: "workflow", intent: "secondary", label: "Ritira dalla revisione" },
  request_changes: { kind: "workflow", intent: "warning", label: "Richiedi modifiche" },
  publish: { kind: "workflow", intent: "primary", label: "Pubblica" },
  approve_review_and_publish: { kind: "workflow", intent: "primary", label: "Approva e pubblica" },
  publish_without_review: { kind: "workflow", intent: "primary", label: "Pubblica" },
};

function workflowSuffix(code: string) {
  return Object.keys(workflowPresentation).find((suffix) => code === suffix || code.endsWith(`.${suffix}`)) || null;
}

export function operationFamily(code: string): OperationKind {
  const value = String(code || "").trim();
  if (!value) return "unknown";
  if (value.includes("workflow") || workflowSuffix(value)) return "workflow";
  if (/remove|delete|trash|detach|withdraw/i.test(value)) return "destructive";
  if (/create|add|copy|fork|materialize|accept/i.test(value)) return "constructive";
  return "command";
}

function inferredPresentation(code: string): Partial<OperationPresentation> {
  const suffix = workflowSuffix(code);
  if (suffix) return workflowPresentation[suffix];
  const kind = operationFamily(code);
  if (kind === "destructive") return { kind, intent: "danger" };
  if (kind === "constructive") return { kind, intent: "primary" };
  return { kind, intent: "secondary" };
}

/** Presentation metadata only; availability remains backend-authoritative. */
export function operationDescriptor<T extends BackendOperation>(operation: T, overrides: Partial<OperationPresentation> = {}): T & { presentation: OperationPresentation } {
  if (!operation || typeof operation !== "object" || !String(operation.code || "").trim()) {
    throw new TypeError("operationDescriptor requires a backend operation with code.");
  }
  const code = String(operation.code);
  const inferred = inferredPresentation(code);
  return {
    ...operation,
    presentation: {
      kind: inferred.kind || "command",
      intent: inferred.intent || "secondary",
      label: String(operation.label || inferred.label || code),
      requiresMessage: operation.requiresMessage === true,
      ...overrides,
    },
  };
}

export function presentAvailableOperations<T extends BackendOperation>(operations: T[] | null | undefined, overridesByCode: Record<string, Partial<OperationPresentation>> = {}) {
  if (!Array.isArray(operations)) return [];
  return operations.map((operation) => operationDescriptor(operation, overridesByCode[operation.code] || {}));
}
