import { accountRepository } from "../infrastructure/http/account-repository.js";
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

function resourceCopy(type) {
  if (type === "physical") return {
    eyebrow: "Nuovo vocabolario fisico",
    title: "Crea un vocabolario fisico",
    description: "Definisci la risorsa autonoma che descriverà luoghi, collegamenti e attributi fisici.",
    namePlaceholder: "Es. Vocabolario accessibilità museo",
    descriptionPlaceholder: "Quali esigenze deve coprire?",
    submit: "Crea e configura",
  };
  return {
    eyebrow: "Nuove regole editoriali",
    title: "Crea regole editoriali",
    description: "Crea un Namespace autonomo e poi configurane classificazioni, relazioni e modalità di presentazione.",
    namePlaceholder: "Es. Regole collezione moderna",
    descriptionPlaceholder: "Scopo e pubblico",
    submit: "Crea e configura",
  };
}

export function openResourceCreateDialog({
  type,
  ownerType,
  ownerId,
  applyStarterByDefault = true,
  onCreated = null,
  onDismiss = null,
} = {}) {
  if (!["namespace", "physical"].includes(type)) throw new TypeError("Unknown resource create dialog type");
  const copy = resourceCopy(type);
  const state = {
    name: "",
    description: "",
    startingPoint: applyStarterByDefault ? "starter" : "blank",
    dirty: false,
    busy: false,
    error: null,
  };

  let dialog = null;
  const formId = `resource-create-${type}-form`;

  const renderBody = () => `${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}
    <form id="${formId}" data-resource-create-form>
      <label>Nome<input name="name" required maxlength="160" placeholder="${escapeHtml(copy.namePlaceholder)}" value="${escapeHtml(state.name)}"></label>
      <label>Descrizione<textarea name="description" rows="4" placeholder="${escapeHtml(copy.descriptionPlaceholder)}">${escapeHtml(state.description)}</textarea></label>
      ${type === "physical" ? `<label>Punto di partenza<select name="startingPoint"><option value="starter" ${state.startingPoint === "starter" ? "selected" : ""}>Configurazione ArtAround di base</option><option value="blank" ${state.startingPoint === "blank" ? "selected" : ""}>Parti da zero</option></select></label><p class="note">La scelta prepara soltanto la prima bozza. Il vocabolario rimane una risorsa autonoma e modificabile nel suo editor.</p>` : ""}
    </form>`;

  const renderFooter = () => `<button type="button" class="button-secondary" data-modal-dismiss ${state.busy ? "disabled" : ""}>Annulla</button><button type="submit" form="${formId}" ${state.busy ? "disabled" : ""}>${icon("plus", { size: 16 })} ${state.busy ? "Creazione…" : copy.submit}</button>`;

  const create = async (form) => {
    if (state.busy) return;
    const data = new FormData(form);
    state.name = String(data.get("name") || "").trim();
    state.description = String(data.get("description") || "").trim();
    state.startingPoint = String(data.get("startingPoint") || state.startingPoint);
    if (!state.name) return;
    state.busy = true;
    state.error = null;
    dialog?.render();
    try {
      const created = type === "physical"
        ? await accountRepository.createPhysicalVocabulary({
          ownerType,
          ownerId,
          name: state.name,
          description: state.description,
          applyStarter: state.startingPoint !== "blank",
        })
        : await accountRepository.createNamespace({
          ownerType,
          ownerId,
          name: state.name,
          description: state.description,
        });
      const resource = type === "physical" ? created?.physicalVocabulary : created?.namespace;
      const resourceId = id(resource);
      if (!resourceId) throw new Error("La risorsa è stata creata ma non è stato restituito il suo identificatore");
      state.dirty = false;
      dialog?.close({ restoreFocus: false, notify: false });
      dialog = null;
      onCreated?.({ id: resourceId, resource, response: created });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Creazione non completata";
      state.busy = false;
      dialog?.render();
      dialog?.focus("input[name='name']");
    }
  };

  dialog = createTaskDialog({
    eyebrow: copy.eyebrow,
    title: copy.title,
    description: copy.description,
    size: "compact",
    initialFocus: "input[name='name']",
    renderBody,
    renderFooter,
    isBusy: () => state.busy,
    isDirty: () => state.dirty,
    onDiscard: () => { state.dirty = false; },
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onInput: (event) => {
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (!field?.form?.matches("[data-resource-create-form]")) return;
      if (!Object.prototype.hasOwnProperty.call(state, field.name)) return;
      state[field.name] = field.value;
      state.dirty = true;
    },
    onChange: (event) => {
      const field = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!field?.form?.matches("[data-resource-create-form]")) return;
      if (!Object.prototype.hasOwnProperty.call(state, field.name)) return;
      state[field.name] = field.value;
      state.dirty = true;
    },
    onSubmit: (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.matches("[data-resource-create-form]")) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      void create(form);
    },
  });

  return dialog;
}
