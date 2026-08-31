function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/**
 * Standardizes loading/error/empty/ready rendering for string-based Marketplace views.
 * The caller still owns the ready markup and the condition that makes a collection empty.
 */
export function renderAsyncBoundary({
  loading = false,
  error = null,
  empty = false,
  loadingMessage = "Caricamento…",
  errorTitle = "Operazione non disponibile",
  emptyTitle = "Nessun contenuto",
  emptyMessage = "Non ci sono elementi da mostrare.",
  ready = "",
} = {}) {
  if (loading) return `<artaround-progress-state tone="info">${escapeHtml(loadingMessage)}</artaround-progress-state>`;
  if (error) return `<artaround-callout tone="danger" role="alert"><strong>${escapeHtml(errorTitle)}</strong><p>${escapeHtml(error)}</p></artaround-callout>`;
  if (empty) return `<artaround-empty-state><h2>${escapeHtml(emptyTitle)}</h2><p>${escapeHtml(emptyMessage)}</p></artaround-empty-state>`;
  return typeof ready === "function" ? ready() : String(ready || "");
}
