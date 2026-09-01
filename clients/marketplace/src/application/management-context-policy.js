import { readOperatingContext } from "./operating-context.js";

export class OperatingContextMismatchError extends Error {
  constructor(message = "Questa risorsa appartiene a un'altra area di lavoro.") {
    super(message);
    this.name = "OperatingContextMismatchError";
    this.code = "OPERATING_CONTEXT_MISMATCH";
  }
}

function id(value) { return String(value || ""); }

export function assertOwnerOperatingContext(owner, { resourceLabel = "Questa risorsa" } = {}) {
  const context = readOperatingContext();
  const ownerType = owner?.type === "organization" ? "organization" : owner?.type === "user" ? "user" : null;
  const ownerId = id(owner?.id);
  if (!context || !ownerType || !ownerId || context.type !== ownerType || id(context.id) !== ownerId) {
    throw new OperatingContextMismatchError(`${resourceLabel} appartiene a un'altra area di lavoro. Usa “Cambia area” prima di modificarla.`);
  }
  return context;
}

export function assertOrganizationOperatingContext(organizationId, { resourceLabel = "Questa risorsa" } = {}) {
  return assertOwnerOperatingContext(
    { type: "organization", id: organizationId },
    { resourceLabel },
  );
}

export function isOwnerOperatingContext(owner, context = readOperatingContext()) {
  return Boolean(
    context
    && owner?.type
    && owner?.id
    && context.type === owner.type
    && id(context.id) === id(owner.id),
  );
}
