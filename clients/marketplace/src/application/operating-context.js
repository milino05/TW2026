const STORAGE_KEY = "artaround.marketplace.operating-context.v1";
export const OPERATING_CONTEXT_CHANGED = "artaround:operating-context-changed";

function text(value) { return String(value || "").trim(); }

function normalizedContext(value) {
  const type = value?.type === "organization" ? "organization" : value?.type === "user" ? "user" : null;
  const id = text(value?.id);
  const name = text(value?.name);
  if (!type || !id || !name) return null;
  return {
    type,
    id,
    name,
    roles: type === "organization" && Array.isArray(value?.roles)
      ? value.roles.map((role) => ({ id: text(role?.id), name: text(role?.name) })).filter((role) => role.id && role.name)
      : [],
    isOwner: type === "organization" && value?.isOwner === true,
  };
}

export function availableOperatingContexts(workspace) {
  if (!workspace?.account?.id || !workspace?.account?.username) return [];
  return [
    {
      type: "user",
      id: String(workspace.account.id),
      name: String(workspace.account.username),
      roles: [],
      isOwner: true,
    },
    ...(workspace.organizations || []).map((organization) => ({
      type: "organization",
      id: String(organization.id),
      name: String(organization.name),
      roles: organization.roles || [],
      isOwner: organization.isOwner === true,
    })),
  ];
}

export function readOperatingContext() {
  try {
    return normalizedContext(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function validateOperatingContext(workspace) {
  const selected = readOperatingContext();
  if (!selected) return null;
  const available = availableOperatingContexts(workspace);
  const current = available.find((entry) => entry.type === selected.type && String(entry.id) === String(selected.id)) || null;
  if (!current) {
    clearOperatingContext({ silent: true });
    return null;
  }
  return current;
}

export function setOperatingContext(context) {
  const normalized = normalizedContext(context);
  if (!normalized) throw new Error("Area di lavoro non valida");
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(OPERATING_CONTEXT_CHANGED, { detail: normalized }));
  return normalized;
}

export function clearOperatingContext({ silent = false } = {}) {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {}
  if (!silent) window.dispatchEvent(new CustomEvent(OPERATING_CONTEXT_CHANGED, { detail: null }));
}

export function operatingPrincipal(context = readOperatingContext()) {
  const normalized = normalizedContext(context);
  if (!normalized) return null;
  return { principalType: normalized.type, principalId: normalized.id };
}

export function contextKindLabel(context = readOperatingContext()) {
  return context?.type === "organization" ? "Organizzazione" : "Area personale";
}
