import { navigate } from "../application/router.js";
import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function statusLabel(value) { return ({ draft: "Bozza", in_review: "In revisione", published: "Pubblicata", superseded: "Superata" })[value] || value || "Da completare"; }

export class ArtAroundEditorialCollectionContentManager extends HTMLElement {
  editorialContextId = null;
  contentSpaceId = null;
  namespaceId = null;
  editable = false;
  locked = false;
  mode = "browse";
  entriesData = null;
  candidateData = null;
  externalData = null;
  entriesBusy = false;
  candidatesBusy = false;
  externalBusy = false;
  error = null;
  selected = null;
  entriesState = new QueryState({ query: "", page: 1, pageSize: 12 });
  candidatesState = new QueryState({ query: "", page: 1, pageSize: 12 });
  externalState = new QueryState({ query: "", page: 1, pageSize: 12 });
  entriesBrowser = null;
  candidatesBrowser = null;
  externalBrowser = null;

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
    this.externalBrowser?.dispose();
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
    if (!this.externalBrowser) {
      this.externalBrowser = new ResourceBrowserController({
        queryState: this.externalState,
        load: async ({ query, page, pageSize }) => {
          const result = await editorialRepository.externalCandidates(this.editorialContextId, { q: query, page, limit: pageSize });
          return { ...result, items: result?.results || [], total: Number(result?.pagination?.total || 0) };
        },
        onStateChange: (state) => {
          this.externalBusy = state.loading;
          if (state.error) this.error = state.error;
          if (state.result) this.externalData = state.result;
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
      this.externalState.setQuery("");
      this.entriesData = null;
      this.candidateData = null;
      this.externalData = null;
      this.mode = "browse";
      this.selected = null;
    }
    if (this.isConnected) { this.ensureBrowsers(); void this.refreshCurrent(); }
  }

  async refreshCurrent() {
    if (!this.editorialContextId) { this.render(); return; }
    this.error = null;
    if (this.mode === "external") {
      if (this.externalState.query.trim().length >= 2) await this.externalBrowser.refresh();
      else this.render();
    } else if (this.mode === "add") await this.candidatesBrowser.refresh();
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
      return;
    }
    if (form.matches("[data-search-external]")) {
      event.preventDefault();
      const query = String(new FormData(form).get("q") || "").trim();
      this.externalState.setQuery(query);
      this.selected = null;
      if (query.length < 2) {
        this.externalData = { results: [], pagination: { page: 1, total: 0, totalPages: 0 }, requiresQuery: true };
        this.error = "Inserisci almeno due caratteri per cercare fuori dallo spazio.";
        this.render();
        return;
      }
      this.error = null;
      void this.externalBrowser.refresh();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-content-mode='browse']")) { this.mode = "browse"; this.selected = null; this.render(); if (!this.entriesData) void this.entriesBrowser.refresh(); return; }
    if (target?.closest("[data-content-mode='add']")) { this.mode = "add"; this.selected = null; this.render(); if (!this.candidateData) void this.candidatesBrowser.refresh(); return; }
    if (target?.closest("[data-content-mode='external']")) { this.mode = "external"; this.selected = null; this.error = null; this.render(); return; }
    if (target?.closest("[data-close-content-inspector]")) { this.selected = null; this.render(); return; }
    const inspect = target?.closest("[data-inspect-content]");
    if (inspect) { this.selected = { kind: inspect.dataset.inspectKind, contentId: inspect.dataset.inspectContent }; this.render(); return; }
    const open = target?.closest("button[data-open-item]");
    if (open) { navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(open.dataset.openItem)}&editorialContextId=${encodeURIComponent(this.editorialContextId)}`); return; }
    const entryPage = target?.closest("button[data-entry-page]");
    if (entryPage) { this.entriesState.setPage(Math.max(1, Number(entryPage.dataset.entryPage) || 1)); this.selected = null; void this.entriesBrowser.refresh(); return; }
    const candidatePage = target?.closest("button[data-candidate-page]");
    if (candidatePage) { this.candidatesState.setPage(Math.max(1, Number(candidatePage.dataset.candidatePage) || 1)); this.selected = null; void this.candidatesBrowser.refresh(); return; }
    const externalPage = target?.closest("button[data-external-page]");
    if (externalPage) { this.externalState.setPage(Math.max(1, Number(externalPage.dataset.externalPage) || 1)); this.selected = null; void this.externalBrowser.refresh(); return; }
    const add = target?.closest("button[data-add-item]");
    if (add && this.editable && !this.locked) {
      await this.mutate(() => editorialRepository.addEntry(this.editorialContextId, { itemId: add.dataset.addItem, curationSignals: [] }), { afterAdd: true });
      return;
    }
    const importButton = target?.closest("button[data-import-edition]");
    if (importButton && this.editable && !this.locked) {
      const row = (this.externalData?.results || []).find((entry) => id(entry.itemEditionId) === id(importButton.dataset.importEdition));
      const label = row?.revision?.label || row?.subject?.label || "questo contenuto";
      const confirmed = await openActionDialog({
        title: `Aggiungere “${label}” allo spazio e alla raccolta?`,
        message: "Questa operazione rende il contenuto disponibile nello spazio editoriale e lo aggiunge alla raccolta corrente. Le altre raccolte potranno trovarlo nello spazio, ma non verranno modificate.",
        confirmLabel: "Aggiungi allo spazio e alla raccolta",
      });
      if (!confirmed) return;
      await this.mutate(() => editorialRepository.importExternalCandidate(this.editorialContextId, importButton.dataset.importEdition), { afterAdd: true });
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
      this.externalData = null;
      this.entriesState.setPage(1);
      this.candidatesState.setPage(1);
      this.externalState.setPage(1);
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
    const presentationState = revision.status ? statusLabel(revision.status) : "Da completare";
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Contenuto</p><h3>${escapeHtml(revision.label || subject.preferredLabel || "Contenuto")}</h3></div><span class="status">${escapeHtml(presentationState)}</span></header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.preferredLabel || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<div class="stats"><span><strong>${revision.version ? `v${escapeHtml(revision.version)}` : "—"}</strong> versione</span></div>${!row.edition ? `<p class="note">Non esiste ancora una versione compatibile con le regole editoriali della raccolta. Il contenuto può restare selezionato, ma dovrà essere completato prima della revisione.</p>` : ""}</div><footer class="operations"><button type="button" class="button-secondary" data-inspect-kind="entry" data-inspect-content="${escapeHtml(id(item))}">Dettagli</button><button type="button" class="button-secondary" data-open-item="${escapeHtml(id(item))}">${icon("edit", { size: 15 })} Apri contenuto</button>${this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-entry="${escapeHtml(id(entry))}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</footer></article>`;
  }

  renderCandidate(row) {
    const subject = row?.subject || {};
    const revision = row?.revision || {};
    const compatibleText = row.compatibleEdition
      ? (revision.status ? `Versione ${escapeHtml(statusLabel(revision.status).toLowerCase())}${revision.version ? ` · v${escapeHtml(revision.version)}` : ""}.` : "Versione compatibile disponibile.")
      : "Nessuna versione compatibile con le regole della raccolta: potrai aggiungere il contenuto e completarla successivamente.";
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Disponibile nello spazio</p><h3>${escapeHtml(revision.label || subject.label || "Contenuto")}</h3></div>${row.inCollection ? `<span class="status" data-tone="success">Già nella raccolta</span>` : !row.compatibleEdition ? `<span class="status" data-tone="warning">Da completare</span>` : ""}</header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.label || "Non disponibile")}</p><p>${compatibleText}</p></div><footer class="operations"><button type="button" class="button-secondary" data-inspect-kind="candidate" data-inspect-content="${escapeHtml(row.itemId)}">Dettagli</button>${!row.inCollection && this.editable && !this.locked ? `<button type="button" data-add-item="${escapeHtml(row.itemId)}">${icon("plus", { size: 15 })} Aggiungi alla raccolta</button>` : ""}</footer></article>`;
  }

  renderExternalCandidate(row) {
    const subject = row?.subject || {};
    const revision = row?.revision || {};
    const accessLabel = row?.access?.basis === "entitlement" ? "Acquisito" : "Della tua area di lavoro";
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Fuori dallo spazio</p><h3>${escapeHtml(revision.label || subject.label || "Contenuto")}</h3></div><span class="status">${escapeHtml(accessLabel)}</span></header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.label || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<p>${revision.version ? `Versione v${escapeHtml(revision.version)} · ` : ""}${escapeHtml(statusLabel(revision.status))}</p></div><footer class="operations"><button type="button" class="button-secondary" data-inspect-kind="external" data-inspect-content="${escapeHtml(row.itemEditionId)}">Dettagli</button>${this.editable && !this.locked ? `<button type="button" data-import-edition="${escapeHtml(row.itemEditionId)}">${icon("plus", { size: 15 })} Aggiungi allo spazio e alla raccolta</button>` : ""}</footer></article>`;
  }

  selectedRow() {
    if (!this.selected) return null;
    const rows = this.selected.kind === "external"
      ? (this.externalData?.results || [])
      : this.selected.kind === "candidate" ? (this.candidateData?.results || []) : (this.entriesData?.results || []);
    if (this.selected.kind === "external") return rows.find((row) => id(row.itemEditionId) === id(this.selected.contentId)) || null;
    if (this.selected.kind === "candidate") return rows.find((row) => id(row.itemId) === id(this.selected.contentId)) || null;
    return rows.find((row) => id(row.item) === id(this.selected.contentId)) || null;
  }

  renderInspector() {
    const row = this.selectedRow();
    if (!row) return "";
    const revision = row.revision || {};
    const subject = row.subject || {};
    const item = row.item || {};
    const isCandidate = this.selected.kind === "candidate";
    const isExternal = this.selected.kind === "external";
    const label = revision.label || subject.preferredLabel || subject.label || "Contenuto";
    const eyebrow = isExternal ? "Fuori dallo spazio" : isCandidate ? "Disponibile nello spazio" : "Nella raccolta";
    const itemId = isCandidate ? row.itemId : id(item);
    const versionNote = revision.status
      ? `${revision.version ? `Versione v${escapeHtml(revision.version)} · ` : ""}${escapeHtml(statusLabel(revision.status))}`
      : "Nessuna versione compatibile disponibile: il contenuto dovrà essere completato prima della revisione.";
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector" aria-label="Dettagli contenuto"><div class="section-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${escapeHtml(label)}</h2></div><button type="button" class="button-secondary small" data-close-content-inspector aria-label="Chiudi dettagli">×</button></div><p><strong>Soggetto:</strong> ${escapeHtml(subject.preferredLabel || subject.label || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<p class="note">${versionNote}</p><div class="operations">${itemId ? `<button type="button" class="button-secondary" data-open-item="${escapeHtml(itemId)}">${icon("edit", { size: 15 })} Apri contenuto</button>` : ""}${isExternal && this.editable && !this.locked ? `<button type="button" data-import-edition="${escapeHtml(row.itemEditionId)}">${icon("plus", { size: 15 })} Aggiungi allo spazio e alla raccolta</button>` : ""}${isCandidate && !row.inCollection && this.editable && !this.locked ? `<button type="button" data-add-item="${escapeHtml(row.itemId)}">${icon("plus", { size: 15 })} Aggiungi alla raccolta</button>` : ""}${!isCandidate && !isExternal && this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-entry="${escapeHtml(id(row.entry))}">${icon("trash", { size: 15 })} Rimuovi dalla raccolta</button>` : ""}</div></aside></div>`;
  }

  renderPagination(kind, pagination = {}) {
    const page = Number(pagination.page || 1);
    const totalPages = Number(pagination.totalPages || 0);
    const busy = kind === "entry" ? this.entriesBusy : kind === "candidate" ? this.candidatesBusy : this.externalBusy;
    const attribute = kind === "entry" ? "data-entry-page" : kind === "candidate" ? "data-candidate-page" : "data-external-page";
    return `<nav class="pagination" aria-label="Pagine dei contenuti"><button type="button" ${attribute}="${page - 1}" ${page <= 1 || busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}${totalPages ? ` di ${totalPages}` : ""}</span><button type="button" ${attribute}="${page + 1}" ${!totalPages || page >= totalPages || busy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  renderBrowse() {
    const entries = this.entriesData?.results || [];
    const pagination = this.entriesData?.pagination || { page: this.entriesState.page, total: 0, totalPages: 0 };
    return `<section aria-busy="${this.entriesBusy}"><div class="section-heading"><div><span class="eyebrow">Contenuti</span><h2>${Number(pagination.total || 0)} nella raccolta</h2><p>Questa è la selezione editoriale della raccolta. Rimuovere un contenuto qui non lo rimuove dallo spazio.</p></div>${this.editable && !this.locked ? `<button type="button" data-content-mode="add">${icon("plus", { size: 16 })} Aggiungi contenuti</button>` : ""}</div><form class="panel inline-form" data-search-entries role="search"><label>Cerca nella raccolta<input name="q" value="${escapeHtml(this.entriesState.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.entriesBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${entries.length ? `<div class="asset-grid">${entries.map((row) => this.renderEntry(row)).join("")}</div>` : `<div class="empty-state"><h3>${this.entriesState.query ? "Nessun contenuto corrispondente" : "La raccolta è vuota"}</h3><p>${this.entriesState.query ? "Prova una ricerca diversa." : "Aggiungi contenuti già disponibili nello spazio editoriale."}</p></div>`}${this.renderPagination("entry", pagination)}</section>`;
  }

  renderAdd() {
    const candidates = this.candidateData?.results || [];
    const pagination = this.candidateData?.pagination || { page: this.candidatesState.page, total: 0, totalPages: 0 };
    return `<section aria-busy="${this.candidatesBusy}"><div class="section-heading"><div><span class="eyebrow">Aggiungi alla raccolta</span><h2>Contenuti disponibili nello spazio</h2><p>Seleziona un Item già disponibile nello spazio. La compatibilità con le regole editoriali viene completata separatamente e viene verificata prima della revisione.</p></div><button type="button" class="button-secondary" data-content-mode="browse">← Torna ai contenuti</button></div><form class="panel inline-form" data-search-candidates role="search"><label>Cerca nello spazio<input name="q" value="${escapeHtml(this.candidatesState.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.candidatesBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${candidates.length ? `<div class="asset-grid">${candidates.map((row) => this.renderCandidate(row)).join("")}</div>` : `<div class="empty-state"><h3>Nessun contenuto nello spazio</h3><p>${this.candidatesState.query ? "Prova una ricerca diversa oppure cerca fuori dallo spazio." : "Lo spazio non contiene ancora altri contenuti da selezionare."}</p></div>`}${this.renderPagination("candidate", pagination)}${this.editable && !this.locked ? `<section class="panel editorial-space-escalation"><span class="eyebrow">Operazione sullo spazio</span><h3>Il contenuto non è disponibile qui?</h3><p>Cercare fuori dallo spazio è un'operazione più ampia: se scegli un contenuto, ArtAround lo renderà disponibile nello spazio e lo aggiungerà soltanto a questa raccolta. Le altre raccolte non verranno modificate.</p><div class="button-row"><button type="button" class="button-secondary" data-content-mode="external">${icon("search", { size: 16 })} Cerca fuori dallo spazio</button><button type="button" class="button-secondary" data-create-context-content>${icon("plus", { size: 16 })} Crea nuovo contenuto</button></div></section>` : ""}</section>`;
  }

  renderExternal() {
    const results = this.externalData?.results || [];
    const pagination = this.externalData?.pagination || { page: this.externalState.page, total: 0, totalPages: 0 };
    const hasQuery = this.externalState.query.trim().length >= 2;
    return `<section aria-busy="${this.externalBusy}"><div class="section-heading"><div><span class="eyebrow">Operazione sullo spazio</span><h2>Cerca fuori dallo spazio</h2><p>Qui trovi contenuti ArtAround che la tua area di lavoro può utilizzare ma che non sono ancora disponibili in questo spazio editoriale.</p></div><button type="button" class="button-secondary" data-content-mode="add">← Torna allo spazio</button></div><artaround-callout tone="warning"><strong>Questa operazione modifica anche lo spazio editoriale.</strong> Aggiungendo un risultato, il contenuto diventerà disponibile anche alle altre raccolte dello spazio, ma verrà selezionato automaticamente solo nella raccolta corrente.</artaround-callout><form class="panel inline-form" data-search-external role="search"><label>Cerca in ArtAround<input name="q" value="${escapeHtml(this.externalState.query)}" placeholder="Titolo o soggetto" minlength="2" required></label><button type="submit" class="button-secondary" ${this.externalBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${hasQuery && results.length ? `<div class="asset-grid">${results.map((row) => this.renderExternalCandidate(row)).join("")}</div>` : `<div class="empty-state"><h3>${hasQuery ? "Nessun contenuto utilizzabile trovato" : "Cerca un contenuto già esistente"}</h3><p>${hasQuery ? "Puoi provare un altro titolo o soggetto. Se ArtAround non contiene ciò che serve, crea un nuovo contenuto." : "Inserisci almeno due caratteri. La ricerca non scorre indiscriminatamente tutto il catalogo: è pensata per trovare un contenuto preciso da portare nello spazio."}</p></div>`}${hasQuery ? this.renderPagination("external", pagination) : ""}${this.editable && !this.locked ? `<section class="panel"><span class="eyebrow">Non esiste ancora?</span><h3>Crea un nuovo contenuto</h3><p>Il nuovo Item verrà creato nel contesto di questo spazio e potrà essere selezionato nella raccolta anche prima che la versione compatibile sia completa.</p><button type="button" class="button-secondary" data-create-context-content>${icon("plus", { size: 16 })} Crea nuovo contenuto</button></section>` : ""}</section>`;
  }

  render() {
    if (!this.editorialContextId) { this.innerHTML = `<div class="empty-state"><p>Preparazione dei contenuti…</p></div>`; return; }
    const disabledNote = this.locked ? `<div class="inline-notice">${icon("lock", { size: 16 })}<span>La composizione è bloccata durante la revisione.</span></div>` : "";
    const body = this.mode === "external" ? this.renderExternal() : this.mode === "add" ? this.renderAdd() : this.renderBrowse();
    this.innerHTML = `<style>artaround-editorial-collection-content-manager{display:grid;gap:1rem}artaround-editorial-collection-content-manager section{display:grid;gap:1rem}artaround-editorial-collection-content-manager .inline-notice{display:flex;gap:.5rem;align-items:center;padding:.7rem .85rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--sage-50)}artaround-editorial-collection-content-manager .editorial-space-escalation{margin-top:.4rem}</style>${disabledNote}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${body}${this.renderInspector()}`;
  }
}

customElements.define("artaround-editorial-collection-content-manager", ArtAroundEditorialCollectionContentManager);
