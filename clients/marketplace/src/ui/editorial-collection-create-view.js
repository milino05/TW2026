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
    this.requestedContentSpaceId = new URLSearchParams(window.location.search).get("contentSpaceId") || null;
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
  }

  hasUnsavedChanges() { return this.dirty; }
  discardUnsavedChanges() { this.dirty = false; }

  captureDraft(form = this.querySelector("[data-create-collection]")) {
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    for (const field of ["displayName", "shortDescription", "description"]) {
      if (form.elements.namedItem(field)) this.draft[field] = String(data.get(field) || "");
    }
  }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-create-collection]")) return;
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

  backHref() { return "/workspace"; }

  onChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target?.matches("select[name='namespaceId']")) return;
    this.captureDraft(target.form);
    if (target.value !== this.selectedNamespaceId) {
      this.selectedNamespaceId = target.value;
      this.graphSelection = null;
      this.graphError = null;
      this.dirty = true;
      this.render();
    }
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-back-space]")) {
      navigate(this.backHref());
      return;
    }
    const graphAction = target.closest("[data-collection-graph-action]");
    if (graphAction) {
      this.captureDraft();
      const requestedMode = graphAction.dataset.collectionGraphAction;
      const mode = requestedMode === "edit"
        ? (this.graphSelection?.graphMode === "new" ? "new" : "existing")
        : requestedMode;
      this.openGraphDialog(mode === "existing" ? "existing" : "new");
    }
  };

  openGraphDialog(mode) {
    if (!this.selectedNamespaceId || !this.selectedSpace || !this.context) {
      this.graphError = "Seleziona prima le Regole editoriali della Raccolta.";
      this.render();
      return;
    }
    this.graphError = null;
    const dialog = document.createElement("artaround-collection-graph-dialog");
    dialog.addEventListener("collection-graph-selected", (event) => {
      this.graphSelection = event.detail?.selection || null;
      this.graphError = null;
      this.dirty = true;
      this.render();
    }, { once: true });
    document.body.append(dialog);
    dialog.configure({
      mode,
      ownerType: this.context.type,
      ownerId: this.context.id,
      namespaceId: this.selectedNamespaceId,
      contentSpaceId: id(this.selectedSpace),
      currentSelection: this.graphSelection,
    });
  }

  async createCollection(form) {
    this.captureDraft(form);
    if (!form.reportValidity()) return;
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
      ...(["shared", "fork"].includes(graphMode) ? {
        semanticGraphId: this.graphSelection.semanticGraphId,
      } : {}),
      ...(["new", "fork"].includes(graphMode) ? {
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

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-collection]")) return;
    event.preventDefault();
    if (!this.preflight?.collection?.allowed || !this.selectedSpace || this.busy) return;
    await this.createCollection(form);
  };

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h1>Scegli prima uno spazio editoriale</h1><p>Le raccolte appartengono allo spazio editoriale corrente della Libreria. Seleziona lo spazio e avvia la creazione dalla sezione Raccolte.</p><a class="button-link" data-route href="/workspace">Apri la Libreria</a></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>Spazio non disponibile</h1><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p><a class="button-link" data-route href="/workspace">Torna alla Libreria</a></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>La raccolta non può ancora essere creata</h1><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
  }

  renderContextBanner() {
    return `<section class="collection-create-context-banner" aria-label="Contesto della Raccolta"><span class="collection-create-context-icon">${icon("workspace", { size: 20 })}</span><div><span class="eyebrow">Spazio editoriale</span><strong>${escapeHtml(this.selectedSpace.name)}</strong><p>${escapeHtml(contextKindLabel(this.context))}: ${escapeHtml(this.context.name)} · La Raccolta verrà creata in questo spazio.</p></div></section>`;
  }

  renderGraphChooser() {
    if (!this.graphSelection) {
      return `<div class="collection-graph-action-grid" role="group" aria-label="Scegli struttura semantica" aria-invalid="${Boolean(this.graphError)}" ${this.graphError ? 'aria-describedby="collection-graph-error"' : ""}>
        <button type="button" class="collection-graph-action-card" data-collection-graph-action="new"><span class="collection-graph-action-icon">${icon("plus", { size: 21 })}</span><span><strong>Crea un nuovo grafo</strong><small>Parti da una struttura semantica vuota e indipendente.</small></span><span class="collection-graph-action-arrow">${icon("chevron", { size: 16 })}</span></button>
        <button type="button" class="collection-graph-action-card" data-collection-graph-action="existing"><span class="collection-graph-action-icon">${icon("link", { size: 21 })}</span><span><strong>Usa un grafo esistente</strong><small>Scegli tra i grafi compatibili con queste Regole editoriali.</small></span><span class="collection-graph-action-arrow">${icon("chevron", { size: 16 })}</span></button>
      </div>${this.graphError ? `<artaround-field-feedback id="collection-graph-error">${escapeHtml(this.graphError)}</artaround-field-feedback>` : ""}`;
    }

    const selection = this.graphSelection;
    const graph = selection.graph || {};
    const modeLabel = selection.graphMode === "new"
      ? "Nuovo grafo"
      : selection.graphMode === "fork"
        ? `Copia indipendente${graph.sourceName ? ` da ${graph.sourceName}` : ""}`
        : "Grafo condiviso";
    const stats = selection.graphMode === "new"
      ? "Verrà creato insieme alla Raccolta."
      : `${Number(graph.subjectCount || 0)} soggetti · ${Number(graph.relationCount || 0)} relazioni`;
    const summaryIcon = selection.graphMode === "new" ? "plus" : selection.graphMode === "fork" ? "copy" : "link";
    return `<article class="collection-graph-selection-summary"><span class="collection-graph-action-icon">${icon(summaryIcon, { size: 20 })}</span><div><span class="eyebrow">${escapeHtml(modeLabel)}</span><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><p>${escapeHtml(stats)}</p></div><button type="button" class="button-secondary small" data-collection-graph-action="edit">Modifica</button></article>`;
  }

  renderForm() {
    const namespaces = this.preflight.collection.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(id(namespace.id))}" ${id(namespace.id) === id(this.selectedNamespaceId) ? "selected" : ""}>${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    return `<form class="collection-create-form" data-create-collection>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Informazioni</span><h2>Dettagli della Raccolta</h2><p>Definisci un'identità chiara. Potrai modificare questi dettagli anche dopo la creazione.</p></div></header><div class="collection-create-fields">
        <label>Nome della Raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano" value="${escapeHtml(this.draft.displayName)}"></label>
        <label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Una sintesi facoltativa" value="${escapeHtml(this.draft.shortDescription)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Obiettivo, pubblico o criterio curatoriale">${escapeHtml(this.draft.description)}</textarea></label>
      </div></section>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Regole editoriali</span><h2>Vocabolario della Raccolta</h2><p>Determina classificazioni, relazioni e modalità di presentazione disponibili.</p></div></header><div class="collection-create-fields collection-create-fields--compact"><label>Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select><span class="note">Dopo la creazione la Raccolta continuerà a usare queste Regole editoriali.</span></label></div></section>
      <section class="collection-create-section"><header class="section-heading"><div><span class="eyebrow">Struttura semantica</span><h2>Grafo della Raccolta</h2><p>Crea una nuova struttura oppure riusa un grafo compatibile. Nessun grafo nuovo viene salvato finché non crei la Raccolta.</p></div></header>${this.renderGraphChooser()}</section>
      <footer class="collection-create-actions"><button type="button" class="button-secondary" data-back-space>Annulla</button><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Creazione…" : `Crea Raccolta ${icon("chevron", { size: 15 })}`}</button></footer>
    </form>`;
  }

  render() {
    if (this.busy && !this.preflight) {
      this.innerHTML = `<main class="page"><artaround-progress-state>Preparazione della nuova Raccolta…</artaround-progress-state></main>`;
      return;
    }
    if (this.error && !this.preflight) {
      this.innerHTML = `<main class="page"><div class="empty-state"><h1>Nuova Raccolta</h1><artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout></div></main>`;
      return;
    }
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) {
      this.innerHTML = `<main class="page workspace-page">${this.blocker()}</main>`;
      return;
    }
    this.innerHTML = `<main class="page workspace-page collection-create-page" aria-busy="${this.busy}">
      <nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><span>${escapeHtml(this.selectedSpace.name)}</span><span aria-hidden="true">/</span><span>Nuova Raccolta</span></nav>
      <header class="page-header collection-create-header"><div><span class="eyebrow">Nuova Raccolta editoriale</span><h1>Crea una Raccolta</h1><p>Organizza contenuti e relazioni all'interno dello spazio editoriale corrente.</p></div></header>
      ${this.renderContextBanner()}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      ${this.renderForm()}
    </main>`;
  }
}

customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
