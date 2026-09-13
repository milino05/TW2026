import { createTaskDialog } from "./task-dialog.js";
import "./subject-presence.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export function openSubjectVenueDialog({ subject, subjectId, sourceItemId = null, sourcePreviewMedia = null, principal, onChanged = null, onDismiss = null } = {}) {
  let controller = null;
  const resolvedSubjectId = subjectId || subject?.id || subject?._id || null;
  controller = createTaskDialog({
    eyebrow: "Subject e sedi",
    title: subject?.preferredLabel || subject?.label || "Presenza nelle sedi",
    description: "Consulta lo stato del Subject nelle sedi dell'organizzazione e usa l'azione disponibile per il tuo ruolo.",
    size: "large",
    initialFocus: "[data-presence-action], [data-open-venue-inventory], [data-map-venue], [data-modal-dismiss]",
    renderBody: () => `<artaround-subject-presence data-subject-venue-dialog-surface aria-label="Presenza nelle sedi di ${escapeHtml(subject?.preferredLabel || subject?.label || "questo Subject")}"></artaround-subject-presence>`,
    renderFooter: () => `<button class="button-secondary" type="button" data-modal-dismiss>Chiudi</button>`,
    onDismiss,
  });
  const configure = () => {
    const surface = controller?.layer?.querySelector("artaround-subject-presence[data-subject-venue-dialog-surface]");
    surface?.configure?.({ subjectId: resolvedSubjectId, sourceItemId, sourcePreviewMedia, principal });
  };
  controller.layer.addEventListener("subject-presence-changed", (event) => {
    event.stopPropagation();
    onChanged?.(event.detail || {});
  });
  queueMicrotask(configure);
  return controller;
}
