import { navigate } from "../application/router.js";
import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundEditorialSpaceView extends HTMLElement {
  contentSpaceId = null;
  section = "collections";
  data = null;
  items = null;
  busy = false;
  contentBusy = false;
  error = null;
  contentError = null;
  contentQuery = null;
  contentBrowser = null;

  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.contentSpaceId = params.get("contentSpaceId");
    this.section = ["collections", "content", "settings"].includes(params.get("section")) ? params.get("section") : "collections";
    this.contentQuery = new QueryState({ query: params.get("q") || "", page: Math.max(1, Number(params.get("page")) || 1), pageSize: 20 });
    this.contentBrowser = new ResourceBrowserController({
      queryState: this.contentQuery,
      load: async ({ query, page, pageSize }) => {
        const result = await editorialRepository.listSpaceItems(this.contentSpaceId, { q: query, page, limit: pageSize });
        return { ...result, items: result?.results || [], total: Number(result?.pagination?.total || 0) };
      },
      onStateChange: (state) => {
        this.contentBusy = state.loading;
        this.contentError = state.error;
        if (state.result) this.items = state.result;
        if (this.isConnected) this.render();
      },
    });
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.contentBrowser?.dispose();
  }

  async load() {
    if (!this.contentSpaceId) { this.error = "Spazio editoriale non specificato"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      this.data = await editorialRepository.spaceProjection(this.contentSpaceId);
      if (this.section === "content") await this.contentBrowser.refresh();
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aprire lo spazio editoriale"; }
    finally { this.busy = false; this.render(); }
  }

  syncUrl() {
    const params = new URLSearchParams({ contentSpaceId: this.contentSpaceId, section: this.section });
    if (this.section === "content") {
      if (this.contentQuery.query) params.set("q", this.contentQuery.query);
      if (this.contentQuery.page > 1) params.set("page", String(this.contentQuery.page));
    }
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }

  setSection(section) {
    this.section = section;
    this.syncUrl();
    if (section === "content" && !this.items && !this.contentBusy) { void this.contentBrowser.refresh(); return; }
    this.render();
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-content-search]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.contentQuery.setQuery(String(data.get("q") || "").trim());
    this.syncUrl();
    void this.contentBrowser.refresh();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest("button[data-space-section]");
    if (tab) { this.setSection(tab.dataset.spaceSection); return; }
    const collection = target?.closest("[data-collection-id]");
    if (collection) { navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(collection.dataset.collectionId)}`); return; }
    if (target?.closest("[data-new-collection]")) { navigate(`/workspace/editorial-collection-new?contentSpaceId=${encodeURIComponent(this.contentSpaceId)}`); return; }
    const item = target?.closest("[data-open-item]");
    if (item) { navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(item.dataset.openItem)}`); return; }
    const page = target?.closest("button[data-content-page]");
    if (page) {
      this.contentQuery.setPage(Math.max(1, Number(page.dataset.contentPage) || 1));
      this.syncUrl();
      void this.contentBrowser.refresh();
      return;
    }
    if (target?.closest("[data-delete-space]")) await this.removeSpace();
  };

  async removeSpace() {
    if (!this.data?.permissions?.canManageSpace) return;
    const confirmed = await openActionDialog({
      title: `Eliminare lo spazio “${this.data.space.name}”?`,
      message: "Gli Item resteranno disponibili, ma le membership dello spazio verranno rimosse. L'operazione è bloccata se esistono raccolte attive.",
      confirmLabel: "Elimina spazio",
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true; this.render();
    try { await editorialRepository.removeSpace(this.contentSpaceId); navigate("/workspace/editorial-spaces"); }
    catch (error) { this.error = error instanceof Error ? error.message : "Eliminazione non completata"; this.busy = false; this.render(); }
  }

  renderCollections() {
    const collections = this.data.collections || [];
    return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Raccolte</span><h2>Raccolte editoriali</h2><p>Ogni raccolta seleziona contenuti di questo spazio e applica regole editoriali e un grafo semantico.</p></div>${this.data.permissions.canCreateCollection ? `<button type="button" data-new-collection>${icon("plus", { size: 16 })} Nuova raccolta</button>` : ""}</div>${collections.length ? `<div class="asset-grid">${collections.map((collection) => {
      const state = collection.reviewActive ? "In revisione" : collection.published ? "Pubblicata" : "Bozza di lavoro";
      return `<article class="asset owned"><header><span class="asset-icon">${icon("catalog", { size: 20 })}</span><div><p class="badge">Raccolta editoriale</p><h3>${escapeHtml(collection.name)}</h3></div><span class="status">${escapeHtml(state)}</span></header><div class="asset-copy"><p>${escapeHtml(collection.shortDescription || "Raccolta editoriale")}</p><p class="muted"><strong>Regole editoriali:</strong> ${escapeHtml(collection.namespace?.name || "Non disponibili")}</p><div class="stats"><span><strong>${Number(collection.itemCount || 0)}</strong> contenuti</span></div></div><footer class="operations"><button type="button" data-collection-id="${escapeHtml(collection.id)}">Apri Studio ${icon("chevron", { size: 14 })}</button></footer></article>`;
    }).join("")}</div>` : `<div class="empty-state"><h3>Nessuna raccolta</h3><p>I contenuti possono appartenere allo spazio senza essere ancora selezionati da una raccolta. Crea una raccolta quando vuoi curarne una selezione con regole e relazioni.</p>${this.data.permissions.canCreateCollection ? `<button type="button" data-new-collection>${icon("plus", { size: 15 })} Crea raccolta</button>` : ""}</div>`}</section>`;
  }

  renderContentCard(row) {
    const subject = row.subject || {};
    return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 20 })}</span><div><p class="badge">Soggetto</p><h3>${escapeHtml(subject.label || "Soggetto non disponibile")}</h3></div></header><div class="asset-copy">${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : `<p class="muted">Contenuto disponibile nello spazio editoriale.</p>`}<div class="stats"><span><strong>${Number(row.editionCount || 0)}</strong> ${Number(row.editionCount || 0) === 1 ? "presentazione" : "presentazioni"}</span><span><strong>${Number(row.collectionUsageCount || 0)}</strong> ${Number(row.collectionUsageCount || 0) === 1 ? "raccolta" : "raccolte"}</span></div></div><footer class="operations"><button type="button" class="button-secondary" data-open-item="${escapeHtml(id(row.itemId))}">${icon("edit", { size: 15 })} Apri contenuto</button></footer></article>`;
  }

  renderContent() {
    const rows = this.items?.results || [];
    const pagination = this.items?.pagination || { page: this.contentQuery.page, total: 0, totalPages: 0 };
    const query = this.contentQuery?.query || "";
    return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Inventario editoriale</span><h2>Contenuti dello spazio</h2><p>Lo spazio contiene Item indipendenti dalle singole raccolte. Uno stesso contenuto può essere selezionato da più raccolte.</p></div><span class="count">${Number(pagination.total || 0)}</span></div><div class="panel"><form class="inline-form" data-content-search role="search"><label>Cerca per soggetto<input name="q" value="${escapeHtml(query)}" placeholder="Opera, autore, tema…"></label><button type="submit" ${this.contentBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form></div>${this.contentError ? `<p role="alert">${escapeHtml(this.contentError)}</p>` : ""}${this.contentBusy && !this.items ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : rows.length ? `<div class="asset-grid">${rows.map((row) => this.renderContentCard(row)).join("")}</div>` : `<div class="empty-state"><h3>${query ? "Nessun contenuto corrispondente" : "Nessun contenuto nello spazio"}</h3><p>${query ? "Prova con un altro soggetto o rimuovi il filtro di ricerca." : "I contenuti possono essere aggiunti allo spazio dai flussi editoriali che lavorano su questo corpus."}</p></div>`}<nav class="pagination" aria-label="Pagine dei contenuti"><button type="button" data-content-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.contentBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)}${Number(pagination.totalPages || 0) ? ` di ${Number(pagination.totalPages)}` : ""}</span><button type="button" data-content-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.contentBusy ? "disabled" : ""}>Successiva →</button></nav></section>`;
  }

  renderSettings() {
    return `<section class="workspace-section"><div class="asset-grid"><article class="panel"><span class="eyebrow">Spazio editoriale</span><h2>${escapeHtml(this.data.space.name)}</h2><p>${escapeHtml(this.data.space.description || "Nessuna descrizione")}</p><div class="stats"><span><strong>${Number(this.data.stats.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(this.data.stats.collectionCount || 0)}</strong> raccolte</span></div></article><article class="panel danger-zone"><span class="eyebrow">Zona pericolosa</span><h2>Elimina spazio</h2><p>Non è consentito eliminare uno spazio che contiene raccolte attive. Gli Item non vengono mai eliminati in cascata.</p>${this.data.permissions.canManageSpace ? `<button type="button" class="button-secondary danger" data-delete-space>${icon("trash", { size: 16 })} Elimina spazio</button>` : `<p class="note">Non disponi del permesso di gestione dello spazio.</p>`}</article></div></section>`;
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Apertura spazio editoriale…</p></div></main>`; return; }
    if (this.error && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Spazio editoriale</h1><p role="alert">${escapeHtml(this.error)}</p><a class="button-link secondary" data-route href="/workspace/editorial-spaces">Torna agli spazi editoriali</a></div></main>`; return; }
    if (!this.data) return;
    const section = this.section === "content" ? this.renderContent() : this.section === "settings" ? this.renderSettings() : this.renderCollections();
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy || this.contentBusy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-spaces">Spazi editoriali</a><span aria-hidden="true">/</span><span>${escapeHtml(this.data.space.name)}</span></nav><header class="page-header"><div><span class="eyebrow">Spazio editoriale</span><h1>${escapeHtml(this.data.space.name)}</h1><p>${escapeHtml(this.data.space.description || "Corpus di contenuti condiviso da più raccolte editoriali.")}</p></div><div class="stats"><span><strong>${Number(this.data.stats.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(this.data.stats.collectionCount || 0)}</strong> raccolte</span></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<nav class="button-row" aria-label="Sezioni dello spazio"><button type="button" data-space-section="collections" class="${this.section === "collections" ? "" : "button-secondary"}" aria-pressed="${this.section === "collections"}">Raccolte</button><button type="button" data-space-section="content" class="${this.section === "content" ? "" : "button-secondary"}" aria-pressed="${this.section === "content"}">Contenuti</button><button type="button" data-space-section="settings" class="${this.section === "settings" ? "" : "button-secondary"}" aria-pressed="${this.section === "settings"}">Impostazioni</button></nav>${section}</main>`;
  }
}
customElements.define("artaround-editorial-space-view", ArtAroundEditorialSpaceView);
