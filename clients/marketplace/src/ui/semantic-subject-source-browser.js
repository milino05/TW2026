import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundSemanticSubjectSourceBrowser extends HTMLElement {
  editorialContextId = null;
  source = "collection";
  query = "";
  page = 1;
  pageSize = 10;
  data = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({ editorialContextId, source = null } = {}) {
    const changed = this.editorialContextId && editorialContextId && this.editorialContextId !== editorialContextId;
    this.editorialContextId = editorialContextId || null;
    if (source && ["collection", "space", "global"].includes(source)) this.source = source;
    if (changed) { this.query = ""; this.page = 1; this.data = null; }
    if (this.isConnected) void this.load();
  }

  async load() {
    if (!this.editorialContextId || this.source === "global") { this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.data = await editorialRepository.graphSubjectCandidates(this.editorialContextId, {
        scope: this.source,
        q: this.query,
        page: this.page,
        limit: this.pageSize,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Ricerca dei soggetti non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  switchSource(source) {
    if (!["collection", "space", "global"].includes(source) || source === this.source) return;
    this.source = source;
    this.query = "";
    this.page = 1;
    this.data = null;
    void this.load();
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-semantic-source-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    void this.load();
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const source = target.closest("[data-semantic-source]");
    if (source) { this.switchSource(source.dataset.semanticSource); return; }
    const nextSource = target.closest("[data-next-semantic-source]");
    if (nextSource) { this.switchSource(nextSource.dataset.nextSemanticSource); return; }
    const page = target.closest("[data-semantic-source-page]");
    if (page) { this.page = Math.max(1, Number(page.dataset.semanticSourcePage) || 1); void this.load(); return; }
    const candidate = target.closest("[data-semantic-source-subject]");
    if (!candidate) return;
    const row = (this.data?.results || []).find((entry) => id(entry.subject) === id(candidate.dataset.semanticSourceSubject));
    if (!row?.subject) return;
    this.dispatchEvent(new CustomEvent("subject-selected", {
      detail: { subject: row.subject, source: this.source === "collection" ? "collection_content" : "content_space" },
      bubbles: true,
      composed: true,
    }));
  };

  coverageLabel(coverage = {}) {
    const collection = Number(coverage.collectionItemCount || 0);
    const space = Number(coverage.contentSpaceItemCount || 0);
    if (collection) return `${collection} ${collection === 1 ? "contenuto nella raccolta" : "contenuti nella raccolta"}`;
    if (space) return `${space} ${space === 1 ? "contenuto nello spazio" : "contenuti nello spazio"}`;
    return "Soggetto ArtAround";
  }

  renderRows() {
    const results = this.data?.results || [];
    if (!results.length) {
      const next = this.source === "collection" ? "space" : "global";
      const label = this.source === "collection" ? "Cerca nello spazio editoriale" : "Cerca in ArtAround e Wikidata";
      return `<div class="empty-state compact"><h4>${this.query ? "Nessun soggetto corrispondente" : "Nessun soggetto disponibile in questo livello"}</h4><p>Prosegui al livello successivo senza interrompere il flusso di lavoro.</p><button type="button" class="button-secondary" data-next-semantic-source="${next}">${label}</button></div>`;
    }
    return `<div class="semantic-inventory-list">${results.map((row) => `<button type="button" class="semantic-inventory-card" data-semantic-source-subject="${escapeHtml(id(row.subject))}"><span><strong>${escapeHtml(row.subject?.preferredLabel || "Soggetto")}</strong><small>${escapeHtml(row.subject?.description || "")}</small></span>${row.inGraph ? `<span class="status" data-tone="success">Già nel grafo</span>` : `<span class="status">${escapeHtml(this.coverageLabel(row.presentationCoverage))}</span>`}</button>`).join("")}</div>`;
  }

  renderPagination() {
    const pagination = this.data?.pagination || {};
    const page = Number(pagination.page || this.page || 1);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dei soggetti"><button type="button" data-semantic-source-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${totalPages}</span><button type="button" data-semantic-source-page="${page + 1}" ${page >= totalPages || this.busy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  render() {
    const tabs = `<div class="button-row semantic-source-tabs" role="tablist" aria-label="Origine del soggetto"><button type="button" class="button-secondary" data-semantic-source="collection" role="tab" aria-selected="${this.source === "collection"}">Raccolta</button><button type="button" class="button-secondary" data-semantic-source="space" role="tab" aria-selected="${this.source === "space"}">Spazio editoriale</button><button type="button" class="button-secondary" data-semantic-source="global" role="tab" aria-selected="${this.source === "global"}">ArtAround</button></div>`;
    if (this.source === "global") {
      this.innerHTML = `${tabs}<div class="semantic-source-explanation"><p>Cerca fra i Subject di ArtAround. Se non esiste una corrispondenza, il resolver prosegue su Wikidata e infine permette la creazione manuale.</p></div><artaround-semantic-entity-picker></artaround-semantic-entity-picker>`;
      return;
    }
    const title = this.source === "collection" ? "Soggetti dei contenuti della raccolta" : "Soggetti dei contenuti dello spazio";
    this.innerHTML = `${tabs}<form data-semantic-source-search role="search"><label>${escapeHtml(title)}<input name="q" value="${escapeHtml(this.query)}" placeholder="Cerca un soggetto"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderRows()}${this.renderPagination()}`;
  }
}

customElements.define("artaround-semantic-subject-source-browser", ArtAroundSemanticSubjectSourceBrowser);
