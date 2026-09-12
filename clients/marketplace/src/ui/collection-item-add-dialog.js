import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { mountModalInteraction } from "../application/modal-interaction.js";
import { icon } from "./icons.js";
import "./content-space-item-add-dialog.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function statusLabel(value) { return ({ draft: "Bozza", in_review: "In revisione", published: "Pubblicata", superseded: "Superata" })[value] || value || "Da completare"; }

export class ArtAroundCollectionItemAddDialog extends HTMLElement {
  editorialContextId = null;
  contentSpaceId = null;
  collectionName = "Raccolta";
  spaceName = "Spazio editoriale";
  ownerType = "user";
  ownerId = null;
  query = "";
  page = 1;
  pageSize = 12;
  data = null;
  busy = false;
  error = null;
  notice = null;
  _dialogInteraction = null;
  _dialogLayer = null;

  connectedCallback() {
    this.editorialContextId = this.getAttribute("editorial-context-id") || null;
    this.contentSpaceId = this.getAttribute("content-space-id") || null;
    this.collectionName = this.getAttribute("collection-name") || "Raccolta";
    this.spaceName = this.getAttribute("space-name") || "Spazio editoriale";
    this.ownerType = this.getAttribute("owner-type") || "user";
    this.ownerId = this.getAttribute("owner-id") || null;
    this.addEventListener("library-item-added", this.onSpaceItemReady);
    this.addEventListener("library-item-open", this.onSpaceItemReady);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("library-item-added", this.onSpaceItemReady);
    this.removeEventListener("library-item-open", this.onSpaceItemReady);
    this.releaseDialogInteraction({ restoreFocus: false });
  }

  releaseDialogInteraction({ restoreFocus = false } = {}) {
    if (this._dialogLayer) {
      this._dialogLayer.removeEventListener("click", this.onClick);
      this._dialogLayer.removeEventListener("submit", this.onSubmit);
    }
    this._dialogInteraction?.release?.({ restoreFocus });
    this._dialogInteraction = null;
    this._dialogLayer = null;
  }

  syncDialogInteraction() {
    const layer = this.querySelector(".collection-item-add-modal-layer");
    if (!(layer instanceof HTMLElement)) return;
    this._dialogLayer = layer;
    layer.addEventListener("click", this.onClick);
    layer.addEventListener("submit", this.onSubmit);
    this._dialogInteraction = mountModalInteraction({
      layer,
      panel: () => layer.querySelector(".collection-item-add-modal"),
      kind: "modal",
      initialFocus: '[name="q"]',
      canDismiss: () => !this.busy,
      onRequestDismiss: () => {
        this.close();
        return true;
      },
      lockScroll: true,
    });
  }

  close() {
    this.releaseDialogInteraction({ restoreFocus: true });
    this.dispatchEvent(new CustomEvent("collection-item-add-close", { bubbles: true }));
    this.remove();
  }

  async load() {
    if (!this.editorialContextId) { this.error = "Raccolta non specificata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.data = await editorialRepository.candidates(this.editorialContextId, {
        q: this.query,
        page: this.page,
        limit: this.pageSize,
      });
      const totalPages = Number(this.data?.pagination?.totalPages || 0);
      if (this.page > 1 && totalPages > 0 && this.page > totalPages) {
        this.page = totalPages;
        this.data = await editorialRepository.candidates(this.editorialContextId, {
          q: this.query,
          page: this.page,
          limit: this.pageSize,
        });
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i contenuti disponibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async addItem(itemId) {
    if (!itemId || this.busy) return;
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      await editorialRepository.addEntry(this.editorialContextId, { itemId, curationSignals: [] });
      this.notice = "Contenuto aggiunto alla raccolta.";
      this.dispatchEvent(new CustomEvent("collection-item-added", { bubbles: true, detail: { itemId } }));
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere il contenuto alla raccolta";
      this.busy = false;
      this.render();
    }
  }

  openSpaceItemFlow() {
    if (!this.contentSpaceId || this.querySelector("artaround-content-space-item-add-dialog")) return;
    const dialog = document.createElement("artaround-content-space-item-add-dialog");
    dialog.setAttribute("content-space-id", this.contentSpaceId);
    dialog.setAttribute("space-name", this.spaceName);
    dialog.setAttribute("owner-type", this.ownerType);
    dialog.setAttribute("origin", "collection");
    if (this.ownerId) dialog.setAttribute("owner-id", this.ownerId);
    this.append(dialog);
  }

  onSpaceItemReady = (event) => {
    event.stopPropagation();
    const itemId = event.detail?.itemId;
    if (itemId) void this.addItem(itemId);
  };

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-collection-item-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    this.notice = null;
    void this.load();
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-add-content-to-space]")) { this.openSpaceItemFlow(); return; }
    const add = target.closest("button[data-add-collection-item]");
    if (add) { void this.addItem(add.dataset.addCollectionItem); return; }
    const pageButton = target.closest("button[data-collection-item-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.collectionItemPage) || 1);
      this.notice = null;
      void this.load();
    }
  };

  renderCandidate(row) {
    const subject = row?.subject || {};
    const revision = row?.revision || {};
    const title = revision.label || subject.label || "Contenuto";
    const compatibility = row.compatibleEdition
      ? `${revision.version ? `Versione v${escapeHtml(revision.version)} · ` : ""}${escapeHtml(statusLabel(revision.status))}`
      : "Nessuna Edition compatibile: potrai completarla successivamente.";
    return `<article class="asset owned collection-add-item-card"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">Disponibile nello spazio</p><h3>${escapeHtml(title)}</h3></div>${row.compatibleEdition ? `<span class="status" data-tone="success">Compatibile</span>` : `<span class="status" data-tone="warning">Da completare</span>`}</header><div class="asset-copy"><p class="muted">Soggetto: ${escapeHtml(subject.label || "Non disponibile")}</p>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<p class="note">${compatibility}</p></div><footer class="operations"><button type="button" data-add-collection-item="${escapeHtml(id(row.itemId))}" ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Aggiungi</button></footer></article>`;
  }

  renderPagination() {
    const pagination = this.data?.pagination || { page: this.page, totalPages: 0 };
    const current = Number(pagination.page || this.page);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dei contenuti disponibili"><button type="button" data-collection-item-page="${current - 1}" ${current <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${current} di ${totalPages}</span><button type="button" data-collection-item-page="${current + 1}" ${current >= totalPages || this.busy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  render() {
    this.releaseDialogInteraction({ restoreFocus: false });
    const results = this.data?.results || [];
    const total = Number(this.data?.pagination?.total || 0);
    const body = `${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}${this.notice ? `<artaround-callout tone="success" role="status">${escapeHtml(this.notice)}</artaround-callout>` : ""}<form class="inline-form" data-collection-item-search role="search"><label>Cerca nello spazio<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form><div class="section-heading"><div><span class="eyebrow">Contenuti disponibili</span><h2>${total} Item da aggiungere</h2><p>Sono mostrati soltanto i contenuti dello spazio che non fanno già parte della raccolta.</p></div></div>${this.busy && !this.data ? `<div class="empty-state compact"><p>Caricamento…</p></div>` : results.length ? `<div class="asset-grid">${results.map((row) => this.renderCandidate(row)).join("")}</div>` : `<div class="empty-state compact"><h3>Nessun contenuto disponibile</h3><p>${this.query ? "Prova una ricerca diversa oppure aggiungi un contenuto allo spazio." : "Tutti i contenuti disponibili nello spazio sono già nella raccolta, oppure lo spazio è ancora vuoto."}</p></div>`}${this.renderPagination()}`;
    this.innerHTML = `<div class="artaround-modal-layer collection-item-add-modal-layer" data-modal-backdrop="true" role="presentation"><section class="artaround-task-modal artaround-task-modal--large collection-item-add-modal" role="dialog" aria-modal="true" aria-label="Aggiungi contenuti alla raccolta" aria-busy="${this.busy}"><header class="artaround-task-modal__header task-modal-header"><div><span class="eyebrow">${escapeHtml(this.collectionName)}</span><h1>Aggiungi contenuti alla raccolta</h1><p>Spazio editoriale: <strong>${escapeHtml(this.spaceName)}</strong></p></div><button type="button" class="button-secondary small artaround-task-modal__close" data-modal-dismiss aria-label="Chiudi">×</button></header><div class="artaround-task-modal__body">${body}</div><footer class="artaround-task-modal__footer task-secondary-action collection-item-add-escalation"><div><strong>Non è ancora nello spazio?</strong><p>Cerca prima un contenuto riutilizzabile; la creazione di un contenuto indipendente richiede una scelta esplicita.</p></div><div class="button-row"><button type="button" class="button-secondary" data-add-content-to-space ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Trova o crea contenuto</button><button type="button" class="button-secondary" data-modal-dismiss ${this.busy ? "disabled" : ""}>Chiudi</button></div></footer></section></div>`;
    this.syncDialogInteraction();
  }
}

customElements.define("artaround-collection-item-add-dialog", ArtAroundCollectionItemAddDialog);
