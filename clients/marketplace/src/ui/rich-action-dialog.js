import { createTaskDialog } from "./task-dialog.js";

/**
 * Structured decision dialog for actions whose consequences need more than a
 * short sentence. Content is supplied by trusted Marketplace renderers.
 * Escape/backdrop/X always resolve as false.
 */
export function openRichActionDialog({
  eyebrow = "Conferma",
  title,
  description = "",
  body = "",
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  tone = "neutral",
  size = "compact",
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let dialog = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      dialog?.close({ notify: false });
      dialog = null;
      resolve(Boolean(value));
    };
    dialog = createTaskDialog({
      eyebrow,
      title,
      description,
      size,
      initialFocus: "[data-rich-action-cancel]",
      renderBody: () => `<div class="rich-action-dialog__content" data-tone="${tone}">${body}</div>`,
      renderFooter: () => `<button type="button" class="button-secondary" data-rich-action-cancel>${cancelLabel}</button><button type="button" class="${tone === "danger" ? "danger" : ""}" data-rich-action-confirm>${confirmLabel}</button>`,
      isDirty: () => false,
      onDismiss: () => settle(false),
      onClick: (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-rich-action-cancel]")) settle(false);
        if (target?.closest("[data-rich-action-confirm]")) settle(true);
      },
    });
  });
}
