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
import "./collection-graph-dialog.js";

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
  graphSelection = null;
  graphEditorMode = null;
  step = "details";
  busy = false;
  error = null;
  graphError = null;
  dirty = false;
  draft = {
    displayName: "",
    shortDescription: "",
    description: "",
  };

  connectedCallback() {
    this.requestedContentSpaceId = this.getAttribute("content-space-id")
      || new URLSearchParams(window.location.search).get("contentSpaceId")
      || null;
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("collection-graph-selected", this.onGraphSelected);
    this.addEventListener("collection-graph-dialog-close", this.onGraphClose);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("collection-graph-selected", this.onGraphSelected);
    this.removeEventListener("collection-graph-dialog-close", this.onGraphClose);
  }

  hasUnsavedChanges() { return this.dirty; }
  discardUnsavedChanges() { this.dirty = false; }
  backHref() { return "/workspace"; }

  captureDraft(form = this.querySelector("[data-collection-details]")) {
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    for (const field of ["displayName", "shortDescription", "description"]) {
      if (form.elements.namedItem(field)) this.draft[field] = String(data.get(field) || "");
    }
  }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-collection-details]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
    this.dirty = true;
  };

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
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
      this.render();
    }
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target?.matches("select[name='namespaceId']")) return;
    if (target.value !== this.selectedNamespaceId) {
      this.selectedNamespaceId = target.value;
      this.graphSelection = null;
      this.graphEditorMode = null;
      this.graphError = null;
      this.dirty = true;
      this.render();
    }
  };

  onGraphSelected = (event) => {
    event.stopPropagation();
    this.graphSelection = event.detail?.selection || null;
    this.graphEditorMode = null;
    this.graphError = null;
    this.dirty = true;
    this.render();
  };

  onGraphClose = (event) => {
    event.stopPropagation();
    this.graphEditorMode = null;
    this.graphError = null;
    this.render();
  };

  onKeyDown = (event) => {
    if (event.defaultPrevented || event.key !== "Escape") return;
    event.preventDefault();
    navigate(this.backHref());
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("[data-collection-create-backdrop]") || target.closest("[data-back-space], [data-close-collection-create]")) {
      navigate(this.backHref());
      return;
    }
    if (target.closest("[data-back-step]")) {
      this.error = null;
      this.graphError = null;
      this.graphEditorMode = null;
      this.step = this.step === "graph" ? "rules" : "details";
      this.render();
      return;
    }
    const graphAction = target.closest("[data-collection-graph-action]");
    if (graphAction) {
      if (!this.selectedNamespaceId || !this.selectedSpace) {
        this.graphError = "Seleziona prima le Regole editoriali della Raccolta.";
        this.render();
        return;
      }
      const requestedMode = graphAction.dataset.collectionGraphAction;
      this.graphEditorMode = requestedMode === "edit"
        ? (this.graphSelection?.graphMode === "new" ? "new" : "existing")
        : requestedMode === "existing" ? "existing" : "new";
      this.graphError = null;
      this.render();
      return;
    }
    if (target.closest("[data-submit-collection]")) void this.createCollection();
  };

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-collection-details]")) {
      event.preventDefault();
      this.captureDraft(form);
      if (!form.reportValidity()) return;
      this.step = "rules";
      this.error = null;
      this.render();
      return;
    }
    if (form.matches("[data-collection-rules]")) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      this.step = "graph";
      this.error = null;
      this.render();
    }
  };

  async createCollection() {
    if (!this.preflight?.collection?.allowed || !this.selectedSpace || this.busy) return;
    if (!this.draft.displayName.trim()) {
      this.step = "details";
      this.error = "Inserisci il nome della Raccolta.";
      this.render();
      return;
    }
    if (!this.selectedNamespaceId) {
      this.step = "rules";
      this.error = "Seleziona le Regole editoriali della Raccolta.";
      this.render();
      return;
    }
    if (!this.graphSelection) {
      this.graphError = "Scegli come impostare il grafo semantico della Raccolta.";
      this.render();
      return;
    }

    const graphMode = this.graphSelection.graphMode;
    const payload = {
      ownerType: this.context.type,
      ownerId: this.context.id,
      contentSpaceId: id(this.selectedSpace),
      namespaceId: this.selectedNamespaceId,
      graphMode,
      ...(graphMode === "import" ? {
        semanticGraphId: this.graphSelection.semanticGraphId,
        importItemIds: this.graphSelection.importItemIds || [],
      } : {}),
      ...(graphMode === "new" ? {
        graphDisplayName: String(this.graphSelection.graphDisplayName || "").trim(),
        graphDescription: String(this.graphSelection.graphDescription || "").trim() || null,
      } : {}),
      displayName: this.draft.displayName.trim(),
      shortDescription: this.draft.shortDescription.trim() || null,
      description: this.draft.description.trim() || null,
    };

    this.busy = true;
    this.error = null;
    this.graphError = null;
    this.render();
    try {
      const created = await editorialRepository.createCollection(payload);
      const editorialContextId = id(created?.editorialContext);
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      this.dirty = false;
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata";
      this.busy = false;
      this.render();
    }
  }

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h2>Scegli prima uno spazio editoriale</h2><p>Le Raccolte appartengono allo spazio editoriale corrente della Libreria.</p><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h2>Spazio non disponibile</h2><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h2>La Raccolta non può ancora essere creata</h2><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
  }

  renderContextBanner() {
    if (!this.selectedSpace) return "";
    return `<section class="collection-create-context-banner" aria-label="Contesto della Raccolta"><span class="collection-create-context-icon">${icon("workspace", { size: 20 })}</span><div><span class="eyebrow">Spazio editoriale</span><strong>${escapeHtml(this.selectedSpace.name)}</strong><p>${escapeHtml(contextKindLabel(this.context))}: ${escapeHtml(this.context.name)} · La Raccolta verrà creata qui.</p></div></section>`;
  }

  renderStepper() {
    const steps = [
      ["details", "1", "Dettagli"],
      ["rules", "2", "Regole"],
      ["graph", "3", "Grafo"],
    ];
    const currentIndex = steps.findIndex(([key]) => key === this.step);
    return `<ol class="collection-create-stepper" aria-label="Creazione Raccolta">${steps.map(([key, number, label], index) => `<li class="${key === this.step ? "is-current" : index < currentIndex ? "is-complete" : ""}" ${key === this.step ? 'aria-current="step"' : ""}><span>${index < currentIndex ? "✓" : number}</span><strong>${label}</strong></li>`).join("")}</ol>`;
  }

  renderDetailsStep() {
    return `<form class="collection-create-form collection-create-form--modal" data-collection-details>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Passaggio 1 di 3</span><h2>Dettagli della Raccolta</h2><p>Definisci un'identità chiara. Potrai modificare questi dettagli anche dopo la creazione.</p></div></header><div class="collection-create-fields">
        <label>Nome della Raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano" value="${escapeHtml(this.draft.displayName)}"></label>
        <label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Una sintesi facoltativa" value="${escapeHtml(this.draft.shortDescription)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Obiettivo, pubblico o criterio curatoriale">${escapeHtml(this.draft.description)}</textarea></label>
      </div></section>
      <footer class="collection-create-actions"><button type="button" class="button-secondary" data-back-space>Annulla</button><button type="submit">Continua ${icon("chevron", { size: 15 })}</button></footer>
    </form>`;
  }

  renderRulesStep() {
    const namespaces = this.preflight?.collection?.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(id(namespace.id))}" ${id(namespace.id) === id(this.selectedNamespaceId) ? "selected" : ""}>${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    return `<form class="collection-create-form collection-create-form--modal" data-collection-rules>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Passaggio 2 di 3</span><h2>Regole editoriali</h2><p>Determinano classificazioni, relazioni e modalità di presentazione disponibili nella Raccolta.</p></div></header><div class="collection-create-fields collection-create-fields--compact"><label>Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select><span class="note">Cambiare queste Regole prima della creazione azzera l'eventuale configurazione del grafo.</span></label></div></section>
      <footer class="collection-create-actions"><button type="button" class="button-secondary" data-back-step>← Indietro</button><button type="submit">Continua ${icon("chevron", { size: 15 })}</button></footer>
    </form>`;
  }

  renderGraphChooser() {
    if (!this.graphSelection) {
      return `<div class="collection-graph-action-grid" role="group" aria-label="Scegli struttura semantica" aria-invalid="${Boolean(this.graphError)}" ${this.graphError ? 'aria-describedby="collection-graph-error"' : ""}>
        <button type="button" class="collection-graph-action-card" data-collection-graph-action="new"><span class="collection-graph-action-icon">${icon("plus", { size: 21 })}</span><span><strong>Crea un nuovo grafo</strong><small>Parti da una struttura semantica locale vuota e indipendente.</small></span><span class="collection-graph-action-arrow">${icon("chevron", { size: 16 })}</span></button>
        <button type="button" class="collection-graph-action-card" data-collection-graph-action="existing"><span class="collection-graph-action-icon">${icon("link", { size: 21 })}</span><span><strong>Importa da un grafo esistente</strong><small>Usalo come sorgente e scegli quali contenuti e relazioni attivare.</small></span><span class="collection-graph-action-arrow">${icon("chevron", { size: 16 })}</span></button>
      </div>${this.graphError ? `<artaround-field-feedback id="collection-graph-error">${escapeHtml(this.graphError)}</artaround-field-feedback>` : ""}`;
    }
    const selection = this.graphSelection;
    const graph = selection.graph || {};
    const modeLabel = selection.graphMode === "new" ? "Nuovo grafo locale" : "Sorgente semantica importata";
    const stats = selection.graphMode === "new"
      ? "Verrà creato insieme alla Raccolta."
      : `${Number(graph.selectedSubjectCount || 0)} contenuti selezionati · sorgente con ${Number(graph.subjectCount || 0)} soggetti e ${Number(graph.relationCount || 0)} relazioni`;
    const summaryIcon = selection.graphMode === "new" ? "plus" : "link";
    return `<article class="collection-graph-selection-summary"><span class="collection-graph-action-icon">${icon(summaryIcon, { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(modeLabel)}</span><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><p>${escapeHtml(stats)}</p></div><button type="button" class="button-secondary small" data-collection-graph-action="edit">Modifica</button></article>`;
  }

  renderGraphStep() {
    if (this.graphEditorMode) return `<artaround-collection-graph-dialog embedded></artaround-collection-graph-dialog>`;
    return `<section class="collection-create-section collection-create-graph-step"><header class="section-heading"><div><span class="eyebrow">Passaggio 3 di 3</span><h2>Grafo della Raccolta</h2><p>Crea una struttura locale nuova oppure inizializzala da una revisione sorgente. La Raccolta manterrà sempre un proprio grafo indipendente.</p></div></header>${this.renderGraphChooser()}</section>
      <footer class="collection-create-actions"><button type="button" class="button-secondary" data-back-step>← Indietro</button><button type="button" data-submit-collection ${this.busy ? "disabled" : ""}>${this.busy ? "Creazione…" : "Crea Raccolta"}</button></footer>`;
  }

  syncGraphEditor() {
    if (!this.graphEditorMode) return;
    const graphEditor = this.querySelector("artaround-collection-graph-dialog[embedded]");
    if (!graphEditor || graphEditor.config) return;
    graphEditor.configure({
      embedded: true,
      mode: this.graphEditorMode,
      ownerType: this.context.type,
      ownerId: this.context.id,
      namespaceId: this.selectedNamespaceId,
      contentSpaceId: id(this.selectedSpace),
      currentSelection: this.graphSelection,
    });
  }

  renderBody() {
    if (this.busy && !this.preflight) return `<artaround-progress-state>Preparazione della nuova Raccolta…</artaround-progress-state>`;
    if (this.error && !this.preflight) return `<div class="empty-state"><artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) return this.blocker();
    const stepBody = this.step === "rules" ? this.renderRulesStep() : this.step === "graph" ? this.renderGraphStep() : this.renderDetailsStep();
    return `${this.renderContextBanner()}${this.renderStepper()}${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<div class="collection-create-modal-body">${stepBody}</div>`;
  }

  render() {
    this.innerHTML = `<div class="context-task-modal-layer collection-create-modal-layer" data-collection-create-backdrop role="presentation"><section class="context-task-modal context-task-modal--large collection-create-modal" role="dialog" aria-modal="true" aria-labelledby="collection-create-title" aria-busy="${this.busy}"><header class="task-modal-header collection-create-modal-header"><div><span class="eyebrow">Nuova Raccolta editoriale</span><h1 id="collection-create-title">Crea una Raccolta</h1><p>Organizza contenuti e relazioni nello spazio editoriale corrente.</p></div><button type="button" class="button-secondary small" data-close-collection-create aria-label="Chiudi">×</button></header>${this.renderBody()}</section></div>`;
    this.syncGraphEditor();
  }
}

customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
