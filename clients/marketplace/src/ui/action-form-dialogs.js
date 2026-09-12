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
 * Action dialog for backend operations that explicitly require a message.
 * Escape, backdrop, X and Annulla always resolve to null; they never execute
 * the operation. Message text is local ephemeral decision state, not an
 * authoring draft, so cancelling it does not trigger a second discard dialog.
 */
export function openMessageActionDialog({
  eyebrow = "Workflow",
  title = "Richiedi modifiche",
  description = "Spiega in modo sintetico cosa deve essere corretto prima di continuare.",
  label = "Motivazione",
  placeholder = "Descrivi le modifiche richieste",
  confirmLabel = "Invia richiesta",
  initialValue = "",
} = {}) {
  return new Promise((resolve) => {
    const state = { message: String(initialValue || ""), error: null };
    let dialog = null;
    let settled = false;
    const formId = `message-action-${Math.random().toString(36).slice(2)}`;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    dialog = createTaskDialog({
      eyebrow,
      title,
      description,
      size: "compact",
      kind: "dialog",
      initialFocus: "textarea[name='message']",
      renderBody: () => `${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}<form id="${formId}" data-message-action-form><label>${escapeHtml(label)}<textarea name="message" rows="6" required maxlength="1000" placeholder="${escapeHtml(placeholder)}">${escapeHtml(state.message)}</textarea></label></form>`,
      renderFooter: () => `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button><button type="submit" form="${formId}">${escapeHtml(confirmLabel)}</button>`,
      isDirty: () => false,
      onDismiss: () => { dialog = null; finish(null); },
      onInput: (event) => {
        const field = event.target instanceof HTMLTextAreaElement ? event.target : null;
        if (!field?.form?.matches("[data-message-action-form]")) return;
        state.message = field.value;
        if (state.error && state.message.trim()) {
          state.error = null;
          dialog?.render();
          dialog?.focus("textarea[name='message']");
        }
      },
      onSubmit: (event) => {
        const form = event.target instanceof HTMLFormElement ? event.target : null;
        if (!form?.matches("[data-message-action-form]")) return;
        event.preventDefault();
        const message = String(new FormData(form).get("message") || "").trim();
        if (!message) {
          state.error = "Inserisci una motivazione prima di continuare.";
          dialog?.render();
          dialog?.focus("textarea[name='message']");
          return;
        }
        dialog?.close({ notify: false });
        dialog = null;
        finish(message);
      },
    });
  });
}

/**
 * Rich confirmation surface for a single bounded decision whose context needs
 * more structure than the compact global Action Dialog can express.
 */
export function openRichActionDialog({
  eyebrow = "Conferma",
  title = "Conferma azione",
  description = "",
  body = "",
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  dangerous = false,
} = {}) {
  return new Promise((resolve) => {
    let dialog = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(Boolean(value));
    };

    dialog = createTaskDialog({
      eyebrow,
      title,
      description,
      size: "compact",
      kind: "dialog",
      initialFocus: "[data-rich-action-cancel]",
      renderBody: () => body,
      renderFooter: () => `<button type="button" class="button-secondary" data-rich-action-cancel>${escapeHtml(cancelLabel)}</button><button type="button" class="${dangerous ? "danger" : ""}" data-rich-action-confirm>${escapeHtml(confirmLabel)}</button>`,
      isDirty: () => false,
      onDismiss: () => { dialog = null; finish(false); },
      onClick: (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-rich-action-cancel]")) {
          dialog?.close({ notify: false });
          dialog = null;
          finish(false);
          return;
        }
        if (target?.closest("[data-rich-action-confirm]")) {
          dialog?.close({ notify: false });
          dialog = null;
          finish(true);
        }
      },
    });
  });
}
