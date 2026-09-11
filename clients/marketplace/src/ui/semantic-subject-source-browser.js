import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function stringIds(values = []) { return (values || []).map(String); }
function intersects(left = [], right = []) { const wanted = new Set(stringIds(right)); return stringIds(left).some((value) => wanted.has(value)); }

export class ArtAroundSemanticSubjectSourceBrowser extends HTMLElement {
  editorialContextId = null;
  source = "collection";
  allowedSources = ["collection", "space", "global"];
  mode = "select";
  query = "";
  page = 1;
  pageSize = 24;
  data = null;
  busy = false;
  error = null;
  excludeSubjectIds = [];
  requiredClassIds = [];
  subjectClasses = [];
  focusSubjectId = null;
  focusLabel = "soggetto corrente";
  selectedRow = null;

  connectedCallback() {
    if (!this.editorialContextId) this.editorialContextId = String(this.getAttribute("editorial-context-id") || "").trim() || null;
    const initialSource = String(this.getAttribute("source") || "").trim();
    if (["collection", "space", "global"].includes(initialSource)) this.source = initialSource;
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({
    editorialContextId,
    source = null,
    allowedSources = null,
    mode = null,
    excludeSubjectIds = null,
    requiredClassIds = null,
    subjectClasses = null,
    focusSubjectId = null,
    focusLabel = null,
  } = {}) {
    const changed = this.editorialContextId && editorialContextId && this.editorialContextId !== editorialContextId;
    this.editorialContextId = editorialContextId || null;
    if (Array.isArray(allowedSources) && allowedSources.length) this.allowedSources = allowedSources.filter((value) => ["collection", "space", "global"].includes(value));
    if (source && this.allowedSources.includes(source)) this.source = source;
    else if (!this.allowedSources.includes(this.source)) [this.source] = this.allowedSources;
    if (mode) this.mode = mode;
    if (excludeSubjectIds) this.excludeSubjectIds = stringIds(excludeSubjectIds);
    if (requiredClassIds) this.requiredClassIds = stringIds(requiredClassIds);
    if (subjectClasses) this.subjectClasses = subjectClasses;
    this.focusSubjectId = focusSubjectId || null;
    if (focusLabel) this.focusLabel = focusLabel;
    if (changed) { this.query = ""; this.page = 1; this.data = null; }
    this.selectedRow = null;
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
        excludeSubjectIds: this.excludeSubjectIds,
        requiredClassDefinitionIds: this.requiredClassIds,
        includeUnclassified: true,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Ricerca dei soggetti non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  switchSource(source) {
    if (!this.allowedSources.includes(source) || source === this.source) return;
    this.source = source;
    this.query = "";
    this.page = 1;
    this.data = null;
    this.selectedRow = null;
    void this.load();
  }

  classLabel(definitionId) {
    return this.subjectClasses.find((entry) => String(entry.definitionId) === String(definitionId))?.label || definitionId;
  }

  compatible(row) {
    const subjectId = id(row?.subject);
    if (!subjectId || this.excludeSubjectIds.includes(subjectId)) return false;
    if (!this.requiredClassIds.length) return true;
    const classes = stringIds(row?.subjectClassDefinitionIds);
    return !classes.length || intersects(classes, this.requiredClassIds);
  }

  visibleRows() {
    return (this.data?.results || []).filter((row) => this.compatible(row));
  }

  emitSelected(row) {
    this.dispatchEvent(new CustomEvent("subject-selected", {
      detail: {
        subject: row.subject,
        row,
        source: this.source === "collection" ? "collection_content" : this.source === "space" ? "content_space" : "global",
      },
      bubbles: true,
      composed: true,
    }));
  }

  emitAction(action, row) {
    this.dispatchEvent(new CustomEvent("subject-browser-action", {
      detail: { action, row, source: this.source },
      bubbles: true,
      composed: true,
    }));
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-semantic-source-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    this.selectedRow = null;
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
    if (page) { this.page = Math.max(1, Number(page.dataset.semanticSourcePage) || 1); this.selectedRow = null; void this.load(); return; }
    const action = target.closest("[data-browser-action]");
    if (action && this.selectedRow) { this.emitAction(action.dataset.browserAction, this.selectedRow); return; }
    const candidate = target.closest("[data-semantic-source-subject], [data-use-inventory-subject]");
    if (!candidate) return;
    const subjectId = candidate.dataset.semanticSourceSubject || candidate.dataset.useInventorySubject;
    const row = this.visibleRows().find((entry) => id(entry.subject) === id(subjectId));
    if (!row?.subject) return;
    if (this.mode === "browse") {
      this.selectedRow = row;
      this.render();
      return;
    }
    this.emitSelected(row);
  };

  coverageLabel(coverage = {}) {
    const collection = Number(coverage.collectionItemCount || 0);
    const space = Number(coverage.contentSpaceItemCount || 0);
    if (collection) return `${collection} ${collection === 1 ? "contenuto nella raccolta" : "contenuti nella raccolta"}`;
    if (space) return `${space} ${space === 1 ? "contenuto nello spazio" : "contenuti nello spazio"}`;
    return "Soggetto ArtAround";
  }

  renderClassChips(row) {
    const classes = stringIds(row?.subjectClassDefinitionIds);
    if (!classes.length) return `<span class="semantic-subject-class-empty">Categoria non assegnata</span>`;
    return `<span class="semantic-subject-class-list">${classes.map((definitionId) => `<span class="semantic-subject-class-chip">${escapeHtml(this.classLabel(definitionId))}</span>`).join("")}</span>`;
  }

  renderRows() {
    const results = this.visibleRows();
    if (!results.length) {
      const availableNext = this.allowedSources.filter((value) => value !== this.source);
      const next = availableNext[0] || null;
      const label = next === "space" ? "Cerca nello spazio editoriale" : next === "global" ? "Cerca in ArtAround e Wikidata" : next === "collection" ? "Torna alla raccolta" : "";
      return `<div class="empty-state compact"><h4>${this.query ? "Nessun soggetto corrispondente" : "Nessun soggetto disponibile in questo livello"}</h4><p>${this.requiredClassIds.length ? "Non ci sono soggetti compatibili con il collegamento scelto; i soggetti senza categoria restano selezionabili." : "Prosegui al livello successivo senza interrompere il flusso di lavoro."}</p>${next ? `<button type="button" class="button-secondary" data-next-semantic-source="${next}">${label}</button>` : ""}</div>`;
    }
    return `<div class="semantic-inventory-list">${results.map((row) => {
      const subjectId = id(row.subject);
      const selected = id(this.selectedRow?.subject) === subjectId;
      return `<button type="button" class="semantic-inventory-card${selected ? " is-selected" : ""}" data-semantic-source-subject="${escapeHtml(subjectId)}" data-use-inventory-subject="${escapeHtml(subjectId)}" aria-pressed="${selected}"><span><strong>${escapeHtml(row.subject?.preferredLabel || "Soggetto")}</strong><small>${escapeHtml(row.subject?.description || "")}</small>${this.renderClassChips(row)}</span><span class="semantic-inventory-meta">${Number(row.relationCount || 0)} relazioni</span><span class="status">${row.inGraph ? "Nel grafo" : escapeHtml(this.coverageLabel(row.presentationCoverage))}</span></button>`;
    }).join("")}</div>`;
  }

  renderSelectionActions() {
    if (this.mode !== "browse" || !this.selectedRow) return "";
    const subject = this.selectedRow.subject || {};
    const inCollection = Number(this.selectedRow.presentationCoverage?.collectionItemCount || 0) > 0;
    return `<div class="semantic-browser-selection"><div><span class="eyebrow">Soggetto selezionato</span><strong>${escapeHtml(subject.preferredLabel || "Soggetto")}</strong></div><div class="button-row">${inCollection ? `<button type="button" class="button-secondary" data-browser-action="focus">Mostra nel grafo</button>` : ""}${this.focusSubjectId && id(subject) !== id(this.focusSubjectId) ? `<button type="button" data-browser-action="connect">Collega a ${escapeHtml(this.focusLabel)}</button>` : ""}</div></div>`;
  }

  renderPagination() {
    const pagination = this.data?.pagination || {};
    const page = Number(pagination.page || this.page || 1);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dei soggetti"><button type="button" data-semantic-source-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${totalPages}</span><button type="button" data-semantic-source-page="${page + 1}" ${page >= totalPages || this.busy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  renderTabs() {
    if (this.allowedSources.length <= 1) return "";
    const labels = { collection: "Nella raccolta", space: "Nello spazio editoriale", global: "ArtAround" };
    return `<div class="button-row semantic-source-tabs" role="tablist" aria-label="Origine del soggetto">${this.allowedSources.map((source) => `<button type="button" class="button-secondary" data-semantic-source="${source}" role="tab" aria-selected="${this.source === source}">${labels[source]}</button>`).join("")}</div>`;
  }

  render() {
    const tabs = this.renderTabs();
    if (this.source === "global") {
      this.innerHTML = `${tabs}<div class="semantic-source-explanation"><p>Cerca fra i Subject di ArtAround. Se non esiste una corrispondenza, il resolver prosegue su Wikidata e infine permette la creazione manuale.</p></div><artaround-semantic-entity-picker></artaround-semantic-entity-picker>`;
      return;
    }
    const title = this.source === "collection" ? "Soggetti dei contenuti della raccolta" : "Soggetti dei contenuti dello spazio";
    this.innerHTML = `${tabs}<form data-semantic-source-search role="search"><label>${escapeHtml(title)}<input name="q" value="${escapeHtml(this.query)}" placeholder="Cerca un soggetto"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderRows()}${this.renderPagination()}${this.renderSelectionActions()}`;
  }
}

customElements.define("artaround-semantic-subject-source-browser", ArtAroundSemanticSubjectSourceBrowser);
