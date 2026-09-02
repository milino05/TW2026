import { navigate } from "../application/router.js";
import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function statusLabel(value) { return ({ draft: "Bozza", in_review: "In revisione", published: "Pubblicata", superseded: "Superata" })[value] || value || "Versione disponibile"; }

export class ArtAroundEditorialCollectionContentManager extends HTMLElement {
  editorialContextId = null;
  contentSpaceId = null;
  namespaceId = null;
  editable = false;
  locked = false;
  mode = "browse";
  entriesData = null;
  candidateData = null;
  entriesBusy = false;
  candidatesBusy = false;
  error = null;
  selected = null;
  entriesState = new QueryState({ query: "", page: 1, pageSize: 12 });
  candidatesState = new QueryState({ query: "", page: 1, pageSize: 12 });
  entriesBrowser = null;
  candidatesBrowser = null;

  connectedCallback() {
    this.ensureBrowsers();
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    void this.refreshCurrent();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.entriesBrowser?.dispose();
    this.candidatesBrowser?.dispose();
  }

  ensureBrowsers() {
    if (!this.entriesBrowser) {
      this.entriesBrowser = new ResourceBrowserController({
        queryState: this.entriesState,
        load: async ({ query, page, pageSize }) => {
          const result = await editorialRepository.entries(this.editorialContextId, { q: query, page, limit: pageSize });
          return { ...result, items: result?.results || [], total: Number(result?.pagination?.total || 0) };
        },
        onStateChange: (state) => {
          this.entriesBusy = state.loading;
          if (state.error) this.error = state.error;
          if (state.result) this.entriesData = state.result;
          if (this.isConnected) this.render();
        },
      });
    }
    if (!this.candidatesBrowser) {
      this.candidatesBrowser = new ResourceBrowserController({
        queryState: this.candidatesState,
        load: async ({ query, page, pageSize }) => {
          const result = await editorialRepository.candidates(this.editorialContextId, { q: query, page, limit: pageSize });
          return { ...result, items: result?.results || [], total: Number(result?.pagination?.total || 0) };
        },
        onStateChange: (state) => {
          this.candidatesBusy = state.loading;
          if (state.error) this.error = state.error;
          if (state.result) this.candidateData = state.result;
          if (this.isConnected) this.render();
        },
      });
    }
  }

  configure({ editorialContextId, contentSpaceId, namespaceId, editable = false, locked = false } = {}) {
    const contextChanged = this.editorialContextId && editorialContextId && this.editorialContextId !== editorialContextId;
    this.editorialContextId = editorialContextId || null;
    this.contentSpaceId = contentSpaceId || null;
    this.namespaceId = namespaceId || null;
    this.editable = editable === true;
    this.locked = locked === true;
    if (contextChanged) {
      this.entriesState.setQuery("");
      this.candidatesState.setQuery("");
      this.entriesData = null;
      this.candidateData = null;
      this.mode = "browse";
      this.selected = null;
    }
    if (this.isConnected) { this.ensureBrowsers(); void this.refreshCurrent(); }
  }

  async refreshCurrent() {
    if (!this.editorialContextId) { this.render(); return; }
    this.error = null;
    if (this.mode === "add") await this.candidatesBrowser.refresh();
    else await this.entriesBrowser.refresh();
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-search-entries]")) {
      event.preventDefault();
      this.entriesState.setQuery(String(new FormData(form).get("q") || "").trim());
      this.selected = null;
      void this.entriesBrowser.refresh();
      return;
    }
    if (form.matches("[data-search-candidates]")) {
      event.preventDefault();
      this.candidatesState.setQuery(String(new FormData(form).get("q") || "").trim());
      this.selected = null;
      void this.candidatesBrowser.refresh();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-content-mode='browse']")) { this.mode = "browse"; this.selected = null; this.render(); if (!this.entriesData) void this.entriesBrowser.refresh(); return; }
    if (target?.closest("[data-content-mode='add']")) { this.mode = "add"; this.selected = null; this.render(); if (!this.candidateData) void this.candidatesBrowser.refresh(); return; }
    if (target?.closest("[data-close-content-inspector]")) { this.selected = null; this.render(); return; }
    const inspect = target?.closest("[data-inspect-content]");
    if (inspect) { this.selected = { kind: inspect.dataset.inspectKind, editionId: inspect.dataset.inspectContent }; this.render(); return; }
    const open = target?.closest("button[data-open-item]");
    if (open) { navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(open.dataset.openItem)}&editorialContextId=${encodeURIComponent(this.editorialContextId)}`); return; }
    const entryPage = target?.closest("button[data-entry-page]");
    if (entryPage) { this.entriesState.setPage(Math.max(1, Number(entryPage.dataset.entryPage) || 1)); this.selected = null; void this.entriesBrowser.refresh(); return; }
    const candidatePage = target?.closest("button[data-candidate-page]");
    if (candidatePage) { this.candidatesState.setPage(Math.max(1, Number(candidatePage.dataset.candidatePage) || 1)); this.selected = null; void this.candidatesBrowser.refresh(); return; }
    const add = target?.closest("button[data-add-edition]");
    if (add && this.editable && !this.locked) {
      await this.mutate(() => editorialRepository.addEntry(this.editorialContextId, { itemEditionId: add.dataset.addEdition, curationSignals: [] }), { afterAdd: true });
      return;
    }
    const remove = target?.closest("button[data-remove-entry]");
    if (remove && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questo contenuto dalla raccolta?",
        message: "Il contenuto resterà nello spazio editoriale e potrà continuare a essere usato da altre raccolte.",
        confirmLabel: "Rimuovi dalla raccolta",
        tone: "danger",
      });
      if (!confirmed) return;
      await this.mutate(() => editorialRepository.removeEntry(this.editorialContextId, remove.dataset.removeEntry));
      return;
    }
    if (target?.closest("button[data-create-context-content]")) {
      const params = new URLSearchParams();
      if (this.contentSpaceId) params.set("contentSpaceId", this.contentSpaceId);
      if (this.editorialContextId) params.set("editorialContextId", this.editorialContextId);
      if (this.namespaceId) params.set("namespaceId", this.namespaceId);
      navigate(`/workspace/item-authoring?${params.toString()}`);
    }
  };

  async mutate(operation, { afterAdd = false } = {}) {
    this.error = null;
    try {
      await operation();
      this.selected = null;
      this.entriesData = null;
      this.candidateData = null;
      this.entriesState.setPage(1);
      if (afterAdd) this.mode = "browse";
      await this.refreshCurrent();
      this.dispatchEvent(new CustomEvent("editorial-content-changed", { bubbles: true }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non completata";
      this.render();
    }
  }

  renderEntry(row) {
    const entry = row?.entry || {};
    const revision = row?.revision || {};
    const subject = row?.subject || {};
    const item = row?.item || {};
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Contenuto</p><h3>${escapeHtml(revision.label || subject.preferredLabel || "Contenuto")}</h3></div><span class="status">${escapeHtml(statusLabel(revision.status))}</span></header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.preferredLabel || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<div class="stats"><span><strong>${revision.version ? `v${escapeHtml(revision.version)}` : "—"}</strong> versione</span></div></div><footer class="operations"><button type="button" class="button-secondary" data-inspect-kind="entry" data-inspect-content="${escapeHtml(id(row.edition))}" data-inspect-content>Dettagli</button><button type="button" class="button-secondary" data-open-item="${escapeHtml(id(item))}">${icon("edit", { size: 15 })} Apri contenuto</button>${this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-entry="${escapeHtml(id(entry))}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</footer></article>`;
  }

  renderCandidate(row) {
    const subject = row?.subject || {};
    const revision = row?.revision || {};
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Disponibile nello spazio</p><h3>${escapeHtml(revision.label || subject.label || "Contenuto")}</h3></div>${row.inCollection ? `<span class="status" data-tone="success">Già nella raccolta</span>` : ""}</header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.label || "Non disponibile")}</p><p>${revision.status ? `Versione ${escapeHtml(statusLabel(revision.status).toLowerCase())}${revision.version ? ` · v${escapeHtml(revision.version)}` : ""}.` : "Versione compatibile con le regole della raccolta."}</p></div><footer class="operations"><button type="button" class="button-secondary" data-inspect-kind="candidate" data-inspect-content="${escapeHtml(row.itemEditionId)}" data-inspect-content>Dettagli</button>${!row.inCollection && this.editable && !this.locked ? `<button type="button" data-add-edition="${escapeHtml(row.itemEditionId)}">${icon("plus", { size: 15 })} Aggiungi alla raccolta</button>` : ""}</footer></article>`;
  }

  selectedRow() {
    if (!this.selected) return null;
    const rows = this.selected.kind === "candidate" ? (this.candidateData?.results || []) : (this.entriesData?.results || []);
    return rows.find((row) => id(row.itemEditionId || row.edition) === id(this.selected.editionId)) || null;
  }

  renderInspector() {
    const row = this.selectedRow();
    if (!row) return "";
    const revision = row.revision || {};
    const subject = row.subject || {};
    const item = row.item || {};
    const isCandidate = this.selected.kind === "candidate";
    const label = revision.label || subject.preferredLabel || subject.label || "Contenuto";
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector" aria-label="Dettagli contenuto"><div class="section-heading"><div><span class="eyebrow">${isCandidate ? "Disponibile nello spazio" : "Nella raccolta"}</span><h2>${escapeHtml(label)}</h2></div><button type="button" class="button-secondary small" data-close-content-inspector aria-label="Chiudi dettagli">×</button></div><p><strong>Soggetto:</strong> ${escapeHtml(subject.preferredLabel || subject.label || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<p class="note">${revision.version ? `Versione v${escapeHtml(revision.version)} · ` : ""}${escapeHtml(statusLabel(revision.status))}</p><div class="operations">${id(item) ? `<button type="button" class="button-secondary" data-open-item="${escapeHtml(id(item))}">${icon("edit", { size: 15 })} Apri contenuto</button>` : ""}${isCandidate && !row.inCollection && this.editable && !this.locked ? `<button type="button" data-add-edition="${escapeHtml(row.itemEditionId)}">${icon("plus", { size: 15 })} Aggiungi alla raccolta</button>` : ""}${!isCandidate && this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-entry="${escapeHtml(id(row.entry))}">${icon("trash", { size: 15 })} Rimuovi dalla raccolta</button>` : ""}</div></aside></div>`;
  }

  renderPagination(kind, pagination = {}) {
    const page = Number(pagination.page || 1);
    const totalPages = Number(pagination.totalPages || 0);
    const busy = kind === "entry" ? this.entriesBusy : this.candidatesBusy;
    const attribute = kind === "entry" ? "data-entry-page" : "data-candidate-page";
    return `<nav class="pagination" aria-label="Pagine dei contenuti"><button type="button" ${attribute}="${page - 1}" ${page <= 1 || busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}${totalPages ? ` di ${totalPages}` : ""}</span><button type="button" ${attribute}="${page + 1}" ${!totalPages || page >= totalPages || busy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  renderBrowse() {
    const entries = this.entriesData?.results || [];
    const pagination = this.entriesData?.pagination || { page: this.entriesState.page, total: 0, totalPages: 0 };
    return `<section aria-busy="${this.entriesBusy}"><div class="section-heading"><div><span class="eyebrow">Contenuti</span><h2>${Number(pagination.total || 0)} nella raccolta</h2><p>Questa è la selezione editoriale della raccolta. Rimuovere un contenuto qui non lo rimuove dallo spazio.</p></div>${this.editable && !this.locked ? `<button type="button" data-content-mode="add">${icon("plus", { size: 16 })} Aggiungi contenuti</button>` : ""}</div><form class="panel inline-form" data-search-entries role="search"><label>Cerca nella raccolta<input name="q" value="${escapeHtml(this.entriesState.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.entriesBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${entries.length ? `<div class="asset-grid">${entries.map((row) => this.renderEntry(row)).join("")}</div>` : `<div class="empty-state"><h3>${this.entriesState.query ? "Nessun contenuto corrispondente" : "La raccolta è vuota"}</h3><p>${this.entriesState.query ? "Modifica la ricerca per vedere altri contenuti." : "Aggiungi contenuti già disponibili nello spazio editoriale."}</p>${this.editable && !this.locked ? `<button type="button" data-content-mode="add">${icon("plus", { size: 15 })} Aggiungi contenuti</button>` : ""}</div>`}${this.renderPagination("entry", pagination)}</section>`;
  }

  renderAdd() {
    const candidates = this.candidateData?.results || [];
    const pagination = this.candidateData?.pagination || { page: this.candidatesState.page, total: 0, totalPages: 0 };
    return `<section aria-busy="${this.candidatesBusy}"><div class="section-heading"><div><span class="eyebrow">Aggiungi alla raccolta</span><h2>Contenuti disponibili nello spazio</h2><p>Questa operazione seleziona un contenuto già presente nello spazio: non modifica le altre raccolte.</p></div><button type="button" class="button-secondary" data-content-mode="browse">← Torna ai contenuti</button></div><form class="panel inline-form" data-search-candidates role="search"><label>Cerca nello spazio<input name="q" value="${escapeHtml(this.candidatesState.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.candidatesBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${candidates.length ? `<div class="asset-grid">${candidates.map((row) => this.renderCandidate(row)).join("")}</div>` : `<div class="empty-state"><h3>Nessun contenuto compatibile nello spazio</h3><p>${this.candidatesState.query ? "Prova una ricerca diversa. Se il contenuto non è ancora nello spazio, puoi crearne uno nuovo nel contesto della raccolta." : "Lo spazio non contiene ancora altri contenuti compatibili con le regole della raccolta."}</p></div>`}${this.renderPagination("candidate", pagination)}${this.editable && !this.locked ? `<section class="panel"><span class="eyebrow">Operazione sullo spazio</span><h3>Il contenuto non esiste ancora nello spazio?</h3><p>Crearne uno nuovo è un'operazione più ampia: il nuovo Item entrerà nello spazio editoriale e verrà poi aggiunto a questa raccolta. Le altre raccolte potranno trovarlo nello spazio, ma non lo riceveranno automaticamente.</p><button type="button" class="button-secondary" data-create-context-content>${icon("plus", { size: 16 })} Crea nuovo contenuto nello spazio</button></section>` : ""}</section>`;
  }

  render() {
    if (!this.editorialContextId) { this.innerHTML = `<div class="empty-state"><p>Preparazione dei contenuti…</p></div>`; return; }
    const disabledNote = this.locked ? `<div class="inline-notice">${icon("lock", { size: 16 })}<span>La composizione è bloccata durante la revisione.</span></div>` : "";
    this.innerHTML = `<style>artaround-editorial-collection-content-manager{display:grid;gap:1rem}artaround-editorial-collection-content-manager section{display:grid;gap:1rem}artaround-editorial-collection-content-manager .inline-notice{display:flex;gap:.5rem;align-items:center;padding:.7rem .85rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--sage-50)}</style>${disabledNote}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.mode === "add" ? this.renderAdd() : this.renderBrowse()}${this.renderInspector()}`;
  }
}

customElements.define("artaround-editorial-collection-content-manager", ArtAroundEditorialCollectionContentManager);
