import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import "./item-detail-dialog.js";
import "./collection-item-add-dialog.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function statusLabel(value) { return ({ draft: "Bozza", in_review: "In revisione", published: "Pubblicata", superseded: "Superata" })[value] || value || "Da completare"; }

export class ArtAroundEditorialCollectionContentManager extends HTMLElement {
  editorialContextId = null;
  contentSpaceId = null;
  namespaceId = null;
  editable = false;
  locked = false;
  entriesData = null;
  entriesBusy = false;
  error = null;
  addFlowChanged = false;
  entriesState = new QueryState({ query: "", page: 1, pageSize: 12 });
  entriesBrowser = null;

  connectedCallback() {
    this.ensureBrowser();
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("library-item-detail-close", this.onItemDetailClose);
    this.addEventListener("library-item-detail-changed", this.onItemDetailChanged);
    this.addEventListener("collection-item-added", this.onCollectionItemAdded);
    this.addEventListener("collection-item-add-close", this.onCollectionItemAddClose);
    void this.refresh();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("library-item-detail-close", this.onItemDetailClose);
    this.removeEventListener("library-item-detail-changed", this.onItemDetailChanged);
    this.removeEventListener("collection-item-added", this.onCollectionItemAdded);
    this.removeEventListener("collection-item-add-close", this.onCollectionItemAddClose);
    this.entriesBrowser?.dispose();
    this.entriesBrowser = null;
  }

  ensureBrowser() {
    if (this.entriesBrowser) return;
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

  configure({ editorialContextId, contentSpaceId, namespaceId, editable = false, locked = false } = {}) {
    const changed = this.editorialContextId && editorialContextId && id(this.editorialContextId) !== id(editorialContextId);
    this.editorialContextId = editorialContextId || null;
    this.contentSpaceId = contentSpaceId || null;
    this.namespaceId = namespaceId || null;
    this.editable = editable === true;
    this.locked = locked === true;
    if (changed) {
      this.entriesState.setQuery("");
      this.entriesData = null;
      this.addFlowChanged = false;
    }
    if (this.isConnected) { this.ensureBrowser(); void this.refresh(); }
  }

  async refresh() {
    if (!this.editorialContextId) { this.render(); return; }
    this.error = null;
    await this.entriesBrowser.refresh();
  }

  openItemDetail(itemId) {
    if (!itemId || !this.contentSpaceId) return;
    this.querySelector("artaround-item-detail-dialog")?.remove();
    const dialog = document.createElement("artaround-item-detail-dialog");
    dialog.setAttribute("content-space-id", this.contentSpaceId);
    dialog.setAttribute("item-id", itemId);
    dialog.setAttribute("initial-collection-id", this.editorialContextId);
    this.append(dialog);
  }

  async openAddDialog() {
    if (!this.editorialContextId || !this.contentSpaceId || this.querySelector("artaround-collection-item-add-dialog")) return;
    this.error = null;
    try {
      const studio = await editorialRepository.studio(this.editorialContextId);
      const dialog = document.createElement("artaround-collection-item-add-dialog");
      dialog.setAttribute("editorial-context-id", this.editorialContextId);
      dialog.setAttribute("content-space-id", this.contentSpaceId);
      dialog.setAttribute("collection-name", studio.context?.name || "Raccolta");
      dialog.setAttribute("space-name", studio.contentSpace?.name || "Spazio editoriale");
      dialog.setAttribute("owner-type", studio.contentSpace?.ownerType || "user");
      dialog.setAttribute("owner-id", id(studio.contentSpace?.ownerId));
      this.addFlowChanged = false;
      this.append(dialog);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile aprire il selettore dei contenuti";
      this.render();
    }
  }

  onCollectionItemAdded = (event) => {
    event.stopPropagation();
    this.addFlowChanged = true;
    this.entriesData = null;
  };

  onCollectionItemAddClose = (event) => {
    event.stopPropagation();
    const changed = this.addFlowChanged;
    this.addFlowChanged = false;
    void this.refresh().then(() => {
      if (changed) this.dispatchEvent(new CustomEvent("editorial-content-changed", { bubbles: true }));
    });
  };

  onItemDetailChanged = () => { this.entriesData = null; };
  onItemDetailClose = () => { void this.refresh(); };

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-search-entries]")) return;
    event.preventDefault();
    this.entriesState.setQuery(String(new FormData(form).get("q") || "").trim());
    void this.entriesBrowser.refresh();
  };

  async removeEntry(entryId) {
    try {
      await editorialRepository.removeEntry(this.editorialContextId, entryId);
      return true;
    } catch (error) {
      if (error?.code !== "COLLECTION_ITEM_GRAPH_SUBJECT_IN_USE") throw error;
      const impact = error.details?.[0]?.context || {};
      const relationCount = Number(impact.relationCount || 0);
      const confirmed = await openActionDialog({
        title: "Rimuovere anche il soggetto dal grafo?",
        message: `Questo è l'ultimo contenuto della Raccolta che rappresenta un soggetto usato nel grafo. Continuando verranno rimossi il nodo${relationCount ? ` e ${relationCount} ${relationCount === 1 ? "relazione" : "relazioni"}` : ""}. Il contenuto resterà nello Spazio editoriale.`,
        confirmLabel: "Rimuovi contenuto e collegamenti",
        tone: "danger",
      });
      if (!confirmed) return false;
      await editorialRepository.removeEntry(this.editorialContextId, entryId, { cascadeGraph: true });
      return true;
    }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("button[data-add-collection-content]")) { void this.openAddDialog(); return; }
    const inspect = target.closest("button[data-inspect-content]");
    if (inspect) { this.openItemDetail(inspect.dataset.inspectContent); return; }
    const entryPage = target.closest("button[data-entry-page]");
    if (entryPage) {
      this.entriesState.setPage(Math.max(1, Number(entryPage.dataset.entryPage) || 1));
      void this.entriesBrowser.refresh();
      return;
    }
    const remove = target.closest("button[data-remove-entry]");
    if (remove && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questo contenuto dalla Raccolta?",
        message: "Il contenuto resterà nello Spazio editoriale e potrà continuare a essere usato da altre Raccolte.",
        confirmLabel: "Rimuovi dalla Raccolta",
        tone: "danger",
      });
      if (!confirmed) return;
      this.error = null;
      try {
        if (!await this.removeEntry(remove.dataset.removeEntry)) return;
        this.entriesData = null;
        await this.refresh();
        this.dispatchEvent(new CustomEvent("editorial-content-changed", { bubbles: true }));
        this.dispatchEvent(new CustomEvent("editorial-graph-changed", { bubbles: true }));
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Operazione non completata";
        this.render();
      }
    }
  };

  renderEntry(row) {
    const entry = row?.entry || {};
    const revision = row?.revision || {};
    const subject = row?.subject || {};
    const item = row?.item || {};
    const presentationState = revision.status ? statusLabel(revision.status) : "Da completare";
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Contenuto</p><h3>${escapeHtml(revision.label || subject.preferredLabel || "Contenuto")}</h3></div><span class="status">${escapeHtml(presentationState)}</span></header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.preferredLabel || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}${!row.edition ? `<p class="note">Non esiste ancora una versione compatibile con le Regole editoriali della Raccolta. Puoi mantenerlo nella selezione e completarlo prima della revisione.</p>` : ""}</div><footer class="operations"><button type="button" class="button-secondary" data-inspect-content="${escapeHtml(id(item))}">Dettagli</button>${this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-entry="${escapeHtml(id(entry))}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</footer></article>`;
  }

  renderPagination(pagination = {}) {
    const page = Number(pagination.page || 1);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dei contenuti"><button type="button" data-entry-page="${page - 1}" ${page <= 1 || this.entriesBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${totalPages}</span><button type="button" data-entry-page="${page + 1}" ${page >= totalPages || this.entriesBusy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  render() {
    if (!this.editorialContextId) { this.innerHTML = `<div class="empty-state"><p>Preparazione dei contenuti…</p></div>`; return; }
    const entries = this.entriesData?.results || [];
    const pagination = this.entriesData?.pagination || { page: this.entriesState.page, total: 0, totalPages: 0 };
    const disabledNote = this.locked ? `<div class="inline-notice">${icon("lock", { size: 16 })}<span>La composizione è bloccata durante la revisione.</span></div>` : "";
    this.innerHTML = `<style>artaround-editorial-collection-content-manager{display:grid;gap:1rem}artaround-editorial-collection-content-manager>section{display:grid;gap:1rem}artaround-editorial-collection-content-manager .inline-notice{display:flex;gap:.5rem;align-items:center;padding:.7rem .85rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--sage-50)}</style>${disabledNote}${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<section aria-busy="${this.entriesBusy}"><div class="section-heading"><div><span class="eyebrow">Contenuti</span><h2>${Number(pagination.total || 0)} nella Raccolta</h2><p>Questa è la selezione editoriale della Raccolta. I contenuti restano risorse dello Spazio anche quando vengono rimossi da qui.</p></div>${this.editable && !this.locked ? `<button type="button" data-add-collection-content>${icon("plus", { size: 16 })} Aggiungi contenuti</button>` : ""}</div><form class="inline-form" data-search-entries role="search"><label>Cerca nella Raccolta<input name="q" value="${escapeHtml(this.entriesState.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.entriesBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${entries.length ? `<div class="asset-grid">${entries.map((row) => this.renderEntry(row)).join("")}</div>` : `<div class="empty-state"><h3>${this.entriesState.query ? "Nessun contenuto trovato" : "La Raccolta è vuota"}</h3><p>${this.entriesState.query ? "Prova una ricerca diversa." : this.editable && !this.locked ? "Usa “Aggiungi contenuti” per scegliere gli Item già disponibili nello Spazio editoriale." : "Non ci sono contenuti nella Raccolta."}</p></div>`}${this.renderPagination(pagination)}</section>`;
  }
}

customElements.define("artaround-editorial-collection-content-manager", ArtAroundEditorialCollectionContentManager);
