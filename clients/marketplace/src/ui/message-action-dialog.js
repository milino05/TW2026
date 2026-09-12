import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Action Dialog variant that collects a short textual payload.
 * Escape/backdrop/X always resolve as cancel and never submit the action.
 */
export function openMessageActionDialog({
  eyebrow = "Azione editoriale",
  title = "Inserisci una motivazione",
  description = "",
  label = "Motivazione",
  placeholder = "Spiega brevemente cosa deve essere rivisto",
  initialValue = "",
  required = true,
  confirmLabel = "Continua",
  cancelLabel = "Annulla",
  maxLength = 1000,
} = {}) {
  return new Promise((resolve) => {
    const state = { value: String(initialValue || ""), error: null, settled: false };
    const formId = `message-action-${Math.random().toString(36).slice(2)}-form`;
    let dialog = null;

    const settle = (result) => {
      if (state.settled) return;
      state.settled = true;
      dialog?.close({ notify: false });
      dialog = null;
      resolve(result);
    };

    dialog = createTaskDialog({
      eyebrow,
      title,
      description,
      size: "compact",
      kind: "dialog",
      initialFocus: "textarea[name='message']",
      renderBody: () => `${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}<form id="${formId}" data-message-action-form><label>${escapeHtml(label)}<textarea name="message" rows="5" maxlength="${Number(maxLength)}" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.value)}</textarea></label></form>`,
      renderFooter: () => `<button type="button" class="button-secondary" data-modal-dismiss>${escapeHtml(cancelLabel)}</button><button type="submit" form="${formId}">${escapeHtml(confirmLabel)}</button>`,
      // Typing here is part of a pending action, not a durable authoring draft.
      // Cancelling it must stay the non-destructive Escape path.
      isDirty: () => false,
      onDismiss: () => settle(null),
      onInput: (event) => {
        const field = event.target instanceof HTMLTextAreaElement ? event.target : null;
        if (field?.name === "message") state.value = field.value;
      },
      onSubmit: (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form?.matches("[data-message-action-form]")) return;
        event.preventDefault();
        const message = String(new FormData(form).get("message") || "").trim();
        if (required && !message) {
          state.error = "Inserisci una motivazione prima di continuare.";
          dialog?.render();
          dialog?.focus("textarea[name='message']");
          return;
        }
        settle(message);
      },
    });
  });
}
