export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatPrice(pricing) {
  if (!pricing || pricing.type === "free") return "Gratis";
  const amount = Number(pricing.amountMinor || 0) / 100;
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: pricing.currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${pricing.currency || ""}`.trim();
  }
}

export function formatDate(value) {
  if (!value) return "Data non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data non disponibile";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatRevenue(revenueByCurrency = {}) {
  const entries = Object.entries(revenueByCurrency);
  if (!entries.length) return "—";
  return entries.map(([currency, amountMinor]) => formatPrice({ type: "paid", currency, amountMinor })).join(" · ");
}

export function principalValue(principal) {
  return `${principal?.type || "user"}:${principal?.id || ""}`;
}

export function principalOptions(principals = [], selectedValue = "") {
  return principals.map((principal) => {
    const value = principalValue(principal);
    const role = principal.type === "organization" && principal.role ? ` · ${principal.role}` : "";
    return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(principal.name || "Principal")}${escapeHtml(role)}</option>`;
  }).join("");
}

function scopedPrincipalOptions(principals = [], selectedValue = "") {
  return principals.map((principal) => {
    const value = principalValue(principal);
    const suffix = principal.type === "organization" ? " · organizzazione" : " · personale";
    return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(principal.name || "Account")}${suffix}</option>`;
  }).join("");
}

export function beneficiaryOptions(principals = [], selectedValue = "") {
  return scopedPrincipalOptions(principals, selectedValue);
}

export function sellerPrincipalOptions(principals = [], selectedValue = "") {
  return scopedPrincipalOptions(principals, selectedValue);
}

export function marketplaceResourceLabel(resourceType) {
  if (["item_edition", "item_revision"].includes(resourceType)) return "Contenuto";
  if (["visit", "visit_revision"].includes(resourceType)) return "Visita";
  if (["editorial_context", "editorial_release"].includes(resourceType)) return "Raccolta editoriale";
  if (["namespace", "namespace_revision"].includes(resourceType)) return "Regole editoriali";
  return "Risorsa";
}

export function hasOperation(operations = [], code) {
  return operations.some((operation) => operation.code === code);
}
