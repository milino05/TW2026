import { navigate } from "../application/router.js";
import {
  contextKindLabel,
  operatingPrincipal,
  readOperatingContext,
} from "../application/operating-context.js";
import { setEditorialSpacePreference } from "../application/editorial-space-preference.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
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

export class ArtAroundEditorialCollectionCreateView extends HTMLElement {
  context = readOperatingContext();
  preflight = null;
  spaces = [];
  requestedContentSpaceId = null;
  selectedSpace = null;
  selectedNamespaceId = "";
  step = "details";
  busy = false;
  creating = false;
  error = null;
  dirty = false;
  draft = { displayName: "", shortDescription: "", description: "" };
  taskDialog = null;

  connectedCallback() {
    this.requestedContentSpaceId = this.getAttribute("content-space-id")
      || new URLSearchParams(window.location.search).get("contentSpaceId")
      || null;
    this.innerHTML = "";
    this.taskDialog = createTaskDialog({
      eyebrow: "Nuova Raccolta editoriale",
      title: "Crea una Raccolta",
      description: "Organizza contenuti e collegamenti nello spazio editoriale corrente.",
      size: "large",
      initialFocus: "input[name='displayName']",
      renderBody: () => this.renderBody(),
      renderFooter: () => this.renderFooter(),
      isBusy: () => this.creating,
      isDirty: () => this.dirty,
      onDiscard: () => { this.dirty = false; },
      onDismiss: () => navigate(this.backHref()),
      onClick: this.onDialogClick,
      onSubmit: this.onDialogSubmit,
      onInput: this.onDialogInput,
      onChange: this.onDialogChange,
    });
    void this.load();
  }

  disconnectedCallback() {
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }

  hasUnsavedChanges() { return this.dirty; }
  discardUnsavedChanges() { this.dirty = false; }
  backHref() { return "/workspace"; }

  captureDraft(form) {
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    for (const field of ["displayName", "shortDescription", "description"]) {
      if (form.elements.namedItem(field)) this.draft[field] = String(data.get(field) || "");
    }
  }

  onDialogInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-collection-details]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
    this.dirty = true;
  };

  onDialogChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target?.matches("select[name='namespaceId']")) return;
    if (target.value === this.selectedNamespaceId) return;
    this.selectedNamespaceId = target.value;
    this.dirty = true;
  };

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.taskDialog?.render(); return; }
    this.busy = true;
    this.error = null;
    this.taskDialog?.render();
    try {
      const [preflight, spaces] = await Promise.all([
        marketplaceRepository.authoringPreflight(principal),
        editorialRepository.listSpaces({ ownerType: this.context.type, ownerId: this.context.id }),
      ]);
      this.preflight = preflight;
      this.spaces = spaces || [];
      this.selectedSpace = this.requestedContentSpaceId
        ? this.spaces.find((space) => id(space) === String(this.requestedContentSpaceId)) || null
        : null;
      if (this.selectedSpace) setEditorialSpacePreference(principal, id(this.selectedSpace), { silent: true });
      const namespaces = this.preflight?.collection?.usableNamespaces || [];
      this.selectedNamespaceId = namespaces.some((entry) => id(entry.id) === id(this.selectedNamespaceId))
        ? this.selectedNamespaceId
        : id(namespaces[0]?.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova raccolta";
    } finally {
      this.busy = false;
      this.taskDialog?.render();
      if (this.preflight?.collection?.allowed) this.taskDialog?.focus("input[name='displayName']");
    }
  }

  onDialogClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-step]")) {
      this.error = null;
      this.step = "details";
      this.taskDialog?.render();
      this.taskDialog?.focus("input[name='displayName']");
    }
  };

  onDialogSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-collection-details]")) {
      event.preventDefault();
      this.captureDraft(form);
      if (!form.reportValidity()) return;
      this.step = "rules";
      this.error = null;
      this.taskDialog?.render();
      this.taskDialog?.focus("select[name='namespaceId']");
      return;
    }
    if (form.matches("[data-collection-rules]")) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      void this.createCollection();
    }
  };

  async createCollection() {
    if (!this.preflight?.collection?.allowed || !this.selectedSpace || this.creating) return;
    if (!this.draft.displayName.trim()) {
      this.step = "details";
      this.error = "Inserisci il nome della Raccolta.";
      this.taskDialog?.render();
      return;
    }
    if (!this.selectedNamespaceId) {
      this.step = "rules";
      this.error = "Seleziona le Regole editoriali della Raccolta.";
      this.taskDialog?.render();
      return;
    }

    this.creating = true;
    this.busy = true;
    this.error = null;
    this.taskDialog?.render();
    try {
      const created = await editorialRepository.createCollection({
        ownerType: this.context.type,
        ownerId: this.context.id,
        contentSpaceId: id(this.selectedSpace),
        namespaceId: this.selectedNamespaceId,
        displayName: this.draft.displayName.trim(),
        shortDescription: this.draft.shortDescription.trim() || null,
        description: this.draft.description.trim() || null,
      });
      const editorialContextId = id(created?.editorialContext);
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      this.dirty = false;
      this.taskDialog?.close({ restoreFocus: false, notify: false });
      this.taskDialog = null;
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}&section=relations`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata";
      this.creating = false;
      this.busy = false;
      this.taskDialog?.render();
    }
  }

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h3>Scegli prima uno spazio editoriale</h3><p>Le Raccolte appartengono allo spazio editoriale corrente della Libreria.</p></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h3>Spazio non disponibile</h3><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h3>La Raccolta non può ancora essere creata</h3><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p></div>`;
  }

  renderContextBanner() {
    if (!this.selectedSpace) return "";
    return `<section class="collection-create-context-banner" aria-label="Contesto della Raccolta"><span class="collection-create-context-icon">${icon("workspace", { size: 20 })}</span><div><span class="eyebrow">Spazio editoriale</span><strong>${escapeHtml(this.selectedSpace.name)}</strong><p>${escapeHtml(contextKindLabel(this.context))}: ${escapeHtml(this.context.name)} · La Raccolta verrà creata qui.</p></div></section>`;
  }

  renderStepper() {
    const steps = [["details", "1", "Dettagli"], ["rules", "2", "Regole"]];
    const currentIndex = steps.findIndex(([key]) => key === this.step);
    return `<ol class="collection-create-stepper" aria-label="Creazione Raccolta">${steps.map(([key, number, label], index) => `<li class="${key === this.step ? "is-current" : index < currentIndex ? "is-complete" : ""}" ${key === this.step ? 'aria-current="step"' : ""}><span>${index < currentIndex ? "✓" : number}</span><strong>${label}</strong></li>`).join("")}</ol>`;
  }

  renderDetailsStep() {
    return `<form id="collection-create-details-form" class="collection-create-form collection-create-form--modal" data-collection-details>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Passaggio 1 di 2</span><h3>Dettagli della Raccolta</h3><p>Definisci un'identità chiara. Potrai modificare questi dettagli anche dopo la creazione.</p></div></header><div class="collection-create-fields">
        <label>Nome della Raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano" value="${escapeHtml(this.draft.displayName)}"></label>
        <label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Una sintesi facoltativa" value="${escapeHtml(this.draft.shortDescription)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Obiettivo, pubblico o criterio curatoriale">${escapeHtml(this.draft.description)}</textarea></label>
      </div></section>
    </form>`;
  }

  renderRulesStep() {
    const namespaces = this.preflight?.collection?.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(id(namespace.id))}" ${id(namespace.id) === id(this.selectedNamespaceId) ? "selected" : ""}>${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    return `<form id="collection-create-rules-form" class="collection-create-form collection-create-form--modal" data-collection-rules>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Passaggio 2 di 2</span><h3>Regole editoriali</h3><p>Determinano classificazioni, relazioni e modalità di presentazione disponibili nella Raccolta.</p></div></header><div class="collection-create-fields collection-create-fields--compact">
        <label>Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select></label>
      </div></section>
    </form>`;
  }

  renderBody() {
    if (this.busy && !this.preflight) return `<artaround-progress-state>Preparazione della nuova Raccolta…</artaround-progress-state>`;
    if (this.error && !this.preflight) return `<div class="empty-state"><artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout></div>`;
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) return this.blocker();
    const stepBody = this.step === "rules" ? this.renderRulesStep() : this.renderDetailsStep();
    return `${this.renderContextBanner()}${this.renderStepper()}${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<div class="collection-create-modal-body">${stepBody}</div>`;
  }

  renderFooter() {
    if (this.busy && !this.preflight) return `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button>`;
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) return `<button type="button" class="button-secondary" data-modal-dismiss>Torna alla Libreria</button>`;
    if (this.step === "rules") return `<button type="button" class="button-secondary" data-back-step>← Indietro</button><button type="submit" form="collection-create-rules-form" ${this.creating ? "disabled" : ""}>${this.creating ? "Creazione…" : "Crea Raccolta"}</button>`;
    return `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button><button type="submit" form="collection-create-details-form">Continua ${icon("chevron", { size: 15 })}</button>`;
  }
}

customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
