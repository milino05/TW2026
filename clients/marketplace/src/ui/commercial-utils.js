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

export function marketplaceResourceLabel(resourceType) {
  if (["item_edition", "item_revision"].includes(resourceType)) return "Contenuto";
  if (["visit", "visit_revision"].includes(resourceType)) return "Visita";
  if (["editorial_context", "editorial_release"].includes(resourceType)) return "Raccolta editoriale";
  if (["namespace", "namespace_revision"].includes(resourceType)) return "Regole editoriali";
  if (["physical_vocabulary", "physical_vocabulary_revision"].includes(resourceType)) return "Vocabolario fisico";
  return "Risorsa";
}

export function hasOperation(operations = [], code) {
  return operations.some((operation) => operation.code === code);
}
