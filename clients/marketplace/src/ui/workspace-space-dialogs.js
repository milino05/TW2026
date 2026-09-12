import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }

function spaceChoice(space, currentSpace) {
  const stats = space.stats || {};
  const selected = id(space) === id(currentSpace);
  return `<button type="button" class="task-resource-choice" data-choose-space="${escapeHtml(id(space))}" aria-current="${selected ? "true" : "false"}"><span class="task-resource-choice__mark">${icon("workspace", { size: 18 })}</span><span class="task-resource-choice__copy"><strong>${escapeHtml(space.name)}</strong><small>${escapeHtml(space.description || "Nessuna descrizione")}</small><span class="task-resource-choice__meta">${Number(stats.collectionCount || 0)} raccolte · ${Number(stats.itemCount || 0)} contenuti</span></span>${selected ? `<span class="task-resource-choice__state">Corrente</span>` : `<span class="task-resource-choice__chevron">${icon("chevron", { size: 15 })}</span>`}</button>`;
}

export function openSpaceSelectionDialog({
  spaces = [],
  currentSpace = null,
  canCreate = false,
  eyebrow = "Spazio editoriale",
  title = "Scegli dove lavorare",
  description = "La scelta definisce il corpus usato dalle sezioni Raccolte e Contenuti della Libreria.",
  onChoose,
  onCreate,
  onDismiss,
} = {}) {
  const state = { query: "" };
  let dialog = null;
  const filtered = () => {
    const query = state.query.trim().toLowerCase();
    return spaces.filter((space) => !query || `${space.name || ""} ${space.description || ""}`.toLowerCase().includes(query));
  };
  const renderResults = () => {
    const visible = filtered();
    if (!visible.length) return `<div class="empty-state compact"><h3>Nessuno spazio trovato</h3><p>Prova con un nome o una descrizione diversa.</p></div>`;
    const current = visible.find((space) => id(space) === id(currentSpace)) || null;
    const others = visible.filter((space) => id(space) !== id(currentSpace));
    return `${current ? `<section class="task-selection-group"><div class="task-selection-group__heading"><span class="eyebrow">Spazio corrente</span></div><div class="task-resource-choice-list task-resource-choice-list--single">${spaceChoice(current, currentSpace)}</div></section>` : ""}${others.length ? `<section class="task-selection-group"><div class="task-selection-group__heading"><span class="eyebrow">${current ? "Altri spazi" : "Spazi disponibili"}</span><span class="count">${others.length}</span></div><div class="task-resource-choice-list">${others.map((space) => spaceChoice(space, currentSpace)).join("")}</div></section>` : ""}`;
  };
  dialog = createTaskDialog({
    eyebrow,
    title,
    description,
    size: "large",
    initialFocus: "input[name='spaceQuery']",
    renderBody: () => `<div class="task-selection-layout"><div class="task-selection-toolbar"><label>Cerca spazio<input name="spaceQuery" value="${escapeHtml(state.query)}" placeholder="Nome o descrizione" autocomplete="off"></label><span class="task-selection-summary">${spaces.length} ${spaces.length === 1 ? "spazio" : "spazi"}</span></div><div data-space-selection-results>${renderResults()}</div></div>`,
    renderFooter: () => `${canCreate ? `<button type="button" class="button-secondary" data-create-space>${icon("plus", { size: 15 })} Nuovo spazio</button><span class="task-modal-footer-spacer" aria-hidden="true"></span>` : ""}<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button>`,
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onInput: (event, controller) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.name !== "spaceQuery") return;
      state.query = input.value;
      const results = controller.layer.querySelector("[data-space-selection-results]");
      if (results instanceof HTMLElement) results.innerHTML = renderResults();
    },
    onClick: (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const chosen = target?.closest("[data-choose-space]");
      if (chosen) {
        const space = spaces.find((entry) => id(entry) === String(chosen.dataset.chooseSpace || ""));
        if (!space) return;
        dialog?.close({ notify: false });
        dialog = null;
        onChoose?.(space);
        return;
      }
      if (target?.closest("[data-create-space]")) {
        dialog?.close({ notify: false });
        dialog = null;
        onCreate?.();
      }
    },
  });
  return dialog;
}

export function openSpaceEditorDialog({ mode = "create", initial = {}, stats = {}, canDelete = false, onSave, onDelete, onDismiss } = {}) {
  const creating = mode === "create";
  const state = {
    name: String(initial.name || ""),
    description: String(initial.description || ""),
    dirty: false,
    busy: false,
    error: null,
  };
  let dialog = null;
  const formId = creating ? "space-create-dialog-form" : "space-settings-dialog-form";

  async function save(form) {
    if (state.busy) return;
    const data = new FormData(form);
    state.name = String(data.get("name") || "").trim();
    state.description = String(data.get("description") || "").trim();
    if (!state.name) return;
    state.busy = true;
    state.error = null;
    dialog?.render();
    try {
      await onSave?.({ name: state.name, description: state.description || null });
      state.dirty = false;
      dialog?.close({ notify: false });
      dialog = null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Operazione sullo spazio non completata";
      state.busy = false;
      dialog?.render();
      dialog?.focus("input[name='name']");
    }
  }

  dialog = createTaskDialog({
    eyebrow: creating ? "Nuovo spazio" : "Spazio editoriale",
    title: creating ? "Crea uno spazio editoriale" : "Impostazioni dello spazio",
    description: creating ? "Crea un corpus editoriale separato per Raccolte e Contenuti." : "Modifica l'identità dello spazio senza cambiare i contenuti che contiene.",
    size: "compact",
    initialFocus: "input[name='name']",
    renderBody: () => `${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}<form id="${formId}" data-space-dialog-form><label>Nome<input name="name" required maxlength="160" value="${escapeHtml(state.name)}"></label><label>Descrizione<textarea name="description" rows="5">${escapeHtml(state.description)}</textarea></label></form>${!creating && canDelete ? `<section class="task-danger-zone"><span class="eyebrow">Zona pericolosa</span><h3>Elimina spazio</h3><p>${Number(stats.collectionCount || 0) ? `Lo spazio contiene ancora ${Number(stats.collectionCount || 0)} raccolte attive e non può essere eliminato.` : "Gli Item non vengono eliminati in cascata. Il backend blocca l'operazione se un contenuto posseduto rimarrebbe senza altri spazi attivi."}</p><button type="button" class="button-secondary danger" data-delete-space ${Number(stats.collectionCount || 0) || state.busy ? "disabled" : ""}>${icon("trash", { size: 15 })} Elimina spazio</button></section>` : ""}`,
    renderFooter: () => `<button type="button" class="button-secondary" data-modal-dismiss ${state.busy ? "disabled" : ""}>Annulla</button><button type="submit" form="${formId}" ${state.busy ? "disabled" : ""}>${state.busy ? "Salvataggio…" : creating ? "Crea spazio" : "Salva modifiche"}</button>`,
    isBusy: () => state.busy,
    isDirty: () => state.dirty,
    onDiscard: () => { state.dirty = false; },
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onInput: (event) => {
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!field?.form?.matches("[data-space-dialog-form]")) return;
      if (field.name === "name") state.name = field.value;
      if (field.name === "description") state.description = field.value;
      state.dirty = true;
    },
    onClick: async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-delete-space]") || state.busy) return;
      const deleted = await onDelete?.();
      if (deleted !== false) {
        dialog?.close({ notify: false });
        dialog = null;
      }
    },
    onSubmit: (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.matches("[data-space-dialog-form]")) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      void save(form);
    },
  });
  return dialog;
}
