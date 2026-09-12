import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundCollectionGraphDialog extends HTMLElement {
  config = null;
  mode = "new";
  view = "new";
  query = "";
  page = 1;
  choices = null;
  preview = null;
  busy = false;
  error = null;
  selectedGraph = null;
  returnFocus = null;
  embedded = false;
  newDraft = { name: "", description: "" };
  selectedItems = new Map();

  connectedCallback() {
    this.embedded = this.hasAttribute("embedded");
    if (!this.embedded) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("change", this.onChange);
    this.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("keydown", this.onKeyDown);
  }

  configure(options = {}) {
    this.config = options;
    this.embedded = options.embedded === true || this.hasAttribute("embedded");
    this.mode = options.mode === "existing" ? "existing" : "new";
    this.view = this.mode;
    this.query = "";
    this.page = 1;
    this.choices = null;
    this.preview = null;
    this.error = null;
    this.selectedGraph = null;
    this.selectedItems.clear();
    const current = options.currentSelection || null;
    if (this.mode === "new" && current?.graphMode === "new") {
      this.newDraft = {
        name: String(current.graphDisplayName || ""),
        description: String(current.graphDescription || ""),
      };
    }
    if (this.mode === "existing" && current?.graphMode === "import") {
      this.selectedGraph = current.sourceGraph || current.graph || null;
      for (const itemId of current.importItemIds || []) this.selectedItems.set(String(itemId), String(itemId));
    }
    this.render();
    if (this.mode === "existing") void this.loadChoices();
    else this.focusFirst();
  }

  focusFirst() {
    requestAnimationFrame(() => this.querySelector("input, button, textarea, select")?.focus({ preventScroll: true }));
  }

  close() {
    this.dispatchEvent(new CustomEvent("collection-graph-dialog-close", { bubbles: true }));
    if (this.embedded) return;
    this.remove();
    this.returnFocus?.focus?.({ preventScroll: true });
  }

  select(selection) {
    this.dispatchEvent(new CustomEvent("collection-graph-selected", {
      bubbles: true,
      detail: { selection },
    }));
    if (this.embedded) return;
    this.remove();
    this.returnFocus?.focus?.({ preventScroll: true });
  }

  async loadChoices() {
    if (!this.config) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.choices = await editorialRepository.reusableSemanticGraphs({
        ownerType: this.config.ownerType,
        ownerId: this.config.ownerId,
        namespaceId: this.config.namespaceId,
        contentSpaceId: this.config.contentSpaceId,
        q: this.query,
        page: this.page,
        limit: 12,
      });
      const selectedId = id(this.selectedGraph);
      const refreshed = (this.choices?.results || []).find((graph) => id(graph) === selectedId);
      if (refreshed) this.selectedGraph = refreshed;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i grafi compatibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async loadPreview() {
    if (!this.config || !this.selectedGraph) return;
    this.busy = true;
    this.error = null;
    this.preview = null;
    this.selectedItems.clear();
    this.render();
    try {
      this.preview = await editorialRepository.semanticGraphImportPreview(id(this.selectedGraph), {
        ownerType: this.config.ownerType,
        ownerId: this.config.ownerId,
        namespaceId: this.config.namespaceId,
        contentSpaceId: this.config.contentSpaceId,
      });
      this.view = "import";
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare l'importazione";
    } finally {
      this.busy = false;
      this.render();
      this.focusFirst();
    }
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-import-subject-toggle]")) {
      const subjectId = target.dataset.importSubjectToggle;
      if (!target.checked) {
        this.selectedItems.delete(subjectId);
        return;
      }
      const row = this.preview?.results?.find((entry) => id(entry.subject?.id) === subjectId);
      const select = this.querySelector(`[data-import-subject-item="${CSS.escape(subjectId)}"]`);
      const itemId = select instanceof HTMLSelectElement ? select.value : id(row?.itemCandidates?.[0]?.itemId);
      if (itemId) this.selectedItems.set(subjectId, itemId);
      return;
    }
    if (target.matches("[data-import-subject-item]")) {
      const subjectId = target.dataset.importSubjectItem;
      const toggle = this.querySelector(`[data-import-subject-toggle="${CSS.escape(subjectId)}"]`);
      if (toggle instanceof HTMLInputElement && toggle.checked && target.value) this.selectedItems.set(subjectId, target.value);
    }
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("[data-collection-graph-backdrop]") || target.closest("[data-close-collection-graph-dialog]")) {
      this.close();
      return;
    }
    const choice = target.closest("[data-collection-graph-choice]");
    if (choice) {
      const graph = (this.choices?.results || []).find((entry) => id(entry) === choice.dataset.collectionGraphChoice);
      if (graph) {
        this.selectedGraph = graph;
        this.preview = null;
        this.selectedItems.clear();
        this.error = null;
        this.render();
      }
      return;
    }
    const pageButton = target.closest("[data-collection-graph-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.collectionGraphPage) || 1);
      void this.loadChoices();
      return;
    }
    if (target.closest("[data-preview-graph-import]")) {
      void this.loadPreview();
      return;
    }
    if (target.closest("[data-use-source-only]")) {
      if (!this.selectedGraph) return;
      this.selectImport([]);
      return;
    }
    if (target.closest("[data-import-all-direct]")) {
      for (const row of this.preview?.results || []) {
        const subjectId = id(row.subject?.id);
        if (row.status !== "addable" || row.itemCandidates?.length !== 1) continue;
        this.selectedItems.set(subjectId, id(row.itemCandidates[0].itemId));
      }
      this.render();
      return;
    }
    if (target.closest("[data-back-graph-list]")) {
      this.view = "existing";
      this.preview = null;
      this.selectedItems.clear();
      this.error = null;
      this.render();
    }
  };

  selectImport(itemIds) {
    this.select({
      graphMode: "import",
      semanticGraphId: id(this.selectedGraph),
      importItemIds: itemIds,
      graph: {
        name: this.selectedGraph?.name || "Grafo semantico",
        description: this.selectedGraph?.description || "",
        subjectCount: Number(this.selectedGraph?.subjectCount || 0),
        relationCount: Number(this.selectedGraph?.relationCount || 0),
        selectedSubjectCount: itemIds.length,
      },
      sourceGraph: this.selectedGraph,
    });
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-collection-graph-search]")) {
      event.preventDefault();
      this.query = String(new FormData(form).get("q") || "").trim();
      this.page = 1;
      void this.loadChoices();
      return;
    }
    if (form.matches("[data-new-collection-graph]")) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      this.newDraft = {
        name: String(data.get("name") || "").trim(),
        description: String(data.get("description") || "").trim(),
      };
      this.select({
        graphMode: "new",
        graphDisplayName: this.newDraft.name,
        graphDescription: this.newDraft.description || null,
        graph: {
          name: this.newDraft.name,
          description: this.newDraft.description || null,
          isNew: true,
        },
      });
      return;
    }
    if (form.matches("[data-import-collection-graph]")) {
      event.preventDefault();
      const checked = [...form.querySelectorAll("[data-import-subject-toggle]:checked")];
      const itemIds = [];
      for (const toggle of checked) {
        const subjectId = toggle.dataset.importSubjectToggle;
        const row = this.preview?.results?.find((entry) => id(entry.subject?.id) === subjectId);
        const selector = form.querySelector(`[data-import-subject-item="${CSS.escape(subjectId)}"]`);
        const itemId = selector instanceof HTMLSelectElement ? selector.value : id(row?.itemCandidates?.[0]?.itemId);
        if (!itemId) {
          this.error = `Scegli quale contenuto usare per ${row?.subject?.label || "il Subject selezionato"}.`;
          this.render();
          return;
        }
        itemIds.push(itemId);
      }
      this.selectImport([...new Set(itemIds)]);
    }
  };

  onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.embedded || event.key !== "Tab") return;
    const focusable = [...this.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  renderHeader(title, description) {
    const heading = this.embedded ? "h2" : "h1";
    const closeLabel = this.embedded ? `← Torna alla scelta` : "×";
    return `<header class="task-modal-header collection-graph-dialog-header"><div><span class="eyebrow">Struttura semantica</span><${heading}>${escapeHtml(title)}</${heading}><p>${escapeHtml(description)}</p></div><button type="button" class="button-secondary small" data-close-collection-graph-dialog aria-label="${this.embedded ? "Torna alla scelta del grafo" : "Chiudi"}">${closeLabel}</button></header>`;
  }

  renderNew() {
    return `${this.renderHeader("Crea un nuovo grafo", "Configura una struttura semantica locale e indipendente. Il grafo verrà creato soltanto insieme alla Raccolta.")}
      <form class="collection-graph-dialog-form" data-new-collection-graph>
        <label>Nome del grafo<input name="name" required maxlength="160" placeholder="Relazioni sul Rinascimento" value="${escapeHtml(this.newDraft.name)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Ambito e criterio semantico">${escapeHtml(this.newDraft.description)}</textarea></label>
        <div class="operations"><button type="button" class="button-secondary" data-close-collection-graph-dialog>Annulla</button><button type="submit">Usa questo nuovo grafo</button></div>
      </form>`;
  }

  renderGraphCard(graph) {
    const graphId = id(graph);
    const selected = graphId === id(this.selectedGraph);
    const coverage = graph.currentSpaceCoverage || null;
    const coverageText = coverage && Number(coverage.totalSubjectCount || 0)
      ? `${Number(coverage.coveredSubjectCount || 0)}/${Number(coverage.totalSubjectCount || 0)} Subject hanno contenuti nello Spazio`
      : "Nessun Subject coperto nello Spazio";
    return `<button type="button" class="collection-graph-choice-card" data-collection-graph-choice="${escapeHtml(graphId)}" aria-pressed="${selected}">
      <span class="collection-graph-choice-icon">${icon("link", { size: 18 })}</span>
      <span class="collection-graph-choice-copy"><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><small>${escapeHtml(graph.description || "Grafo semantico riusabile")}</small><span>${Number(graph.subjectCount || 0)} soggetti · ${Number(graph.relationCount || 0)} relazioni</span><span>${escapeHtml(coverageText)}</span></span>
      <span class="status">Sorgente compatibile</span>
    </button>`;
  }

  renderExisting() {
    const results = this.choices?.results || [];
    const pagination = this.choices?.pagination || { page: this.page, totalPages: 0 };
    return `${this.renderHeader("Importa da un grafo esistente", "Il grafo scelto sarà una sorgente pinzata: la Raccolta avrà comunque un proprio grafo locale e indipendente.")}
      <form class="collection-graph-search" data-collection-graph-search role="search"><label>Cerca<input name="q" type="search" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      ${this.busy && !this.choices ? `<artaround-progress-state>Caricamento grafi compatibili…</artaround-progress-state>` : results.length
        ? `<div class="collection-graph-dialog-results"><section class="collection-graph-dialog-group"><span class="eyebrow">Grafi compatibili</span><div class="collection-graph-choice-list">${results.map((graph) => this.renderGraphCard(graph)).join("")}</div></section></div>`
        : `<artaround-empty-state><h3>Nessun grafo compatibile</h3><p>${this.query ? "Prova con un'altra ricerca." : "Non ci sono ancora grafi compatibili con queste Regole editoriali."}</p></artaround-empty-state>`}
      ${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine dei grafi"><button type="button" class="button-secondary" data-collection-graph-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" class="button-secondary" data-collection-graph-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
      ${this.selectedGraph ? `<footer class="collection-graph-dialog-selection"><div><strong>${escapeHtml(this.selectedGraph.name || "Grafo semantico")}</strong><span>${Number(this.selectedGraph.subjectCount || 0)} soggetti · ${Number(this.selectedGraph.relationCount || 0)} relazioni</span></div><div class="operations"><button type="button" data-preview-graph-import>Configura importazione ${icon("chevron", { size: 15 })}</button></div></footer>` : ""}`;
  }

  renderImportRow(row) {
    const subjectId = id(row.subject?.id);
    const candidates = row.itemCandidates || [];
    const selectable = row.status === "addable" || row.status === "ambiguous";
    const checked = this.selectedItems.has(subjectId);
    const statusLabel = row.status === "addable"
      ? "Disponibile"
      : row.status === "ambiguous"
        ? `${candidates.length} contenuti disponibili`
        : "Nessun contenuto nello Spazio";
    const selector = row.status === "ambiguous"
      ? `<select data-import-subject-item="${escapeHtml(subjectId)}" aria-label="Contenuto per ${escapeHtml(row.subject?.label || "Subject")}"><option value="">Scegli il contenuto…</option>${candidates.map((candidate) => `<option value="${escapeHtml(id(candidate.itemId))}" ${this.selectedItems.get(subjectId) === id(candidate.itemId) ? "selected" : ""}>${escapeHtml(candidate.label || `Contenuto ${id(candidate.itemId).slice(-6)}`)}</option>`).join("")}</select>`
      : candidates.length === 1 ? `<small>${escapeHtml(candidates[0].label || "Contenuto disponibile")}</small>` : "";
    return `<article class="collection-graph-import-row ${selectable ? "" : "is-disabled"}"><label><input type="checkbox" data-import-subject-toggle="${escapeHtml(subjectId)}" ${selectable ? "" : "disabled"} ${checked ? "checked" : ""}><span><strong>${escapeHtml(row.subject?.label || "Subject")}</strong><small>${escapeHtml(statusLabel)} · ${Number(row.sourceRelationCount || 0)} relazioni nella sorgente</small></span></label>${selector}</article>`;
  }

  renderImport() {
    const summary = this.preview?.summary || {};
    const rows = this.preview?.results || [];
    return `${this.renderHeader("Scegli cosa importare", `“${this.preview?.source?.name || this.selectedGraph?.name || "Grafo semantico"}” rimarrà una sorgente immutabile; nel canvas entreranno solo i Subject supportati dai contenuti scelti.`)}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="collection-graph-import-summary"><span><strong>${Number(summary.totalSubjectCount || 0)}</strong> Subject sorgente</span><span><strong>${Number(summary.directlyImportableSubjectCount || 0)}</strong> importabili subito</span><span><strong>${Number(summary.ambiguousSubjectCount || 0)}</strong> da scegliere</span><span><strong>${Number(summary.unavailableSubjectCount || 0)}</strong> senza contenuto</span></div>
      <form class="collection-graph-import-form" data-import-collection-graph>
        <div class="collection-graph-import-toolbar"><button type="button" class="button-secondary" data-import-all-direct>Seleziona tutti quelli immediatamente disponibili</button><span>${this.selectedItems.size} selezionati</span></div>
        <div class="collection-graph-import-list">${rows.map((row) => this.renderImportRow(row)).join("")}</div>
        <div class="operations"><button type="button" class="button-secondary" data-back-graph-list>← Cambia sorgente</button><button type="button" class="button-secondary" data-use-source-only>Usa solo come sorgente</button><button type="submit">Importa selezionati</button></div>
      </form>`;
  }

  render() {
    const body = this.view === "import" ? this.renderImport() : this.view === "existing" ? this.renderExisting() : this.renderNew();
    if (this.embedded) {
      this.innerHTML = `<section class="collection-graph-dialog collection-graph-dialog--embedded" aria-label="Configura grafo della Raccolta">${body}</section>`;
      return;
    }
    this.innerHTML = `<div class="context-task-modal-layer collection-graph-dialog-layer" data-collection-graph-backdrop role="presentation"><section class="context-task-modal context-task-modal--large collection-graph-dialog" role="dialog" aria-modal="true" aria-label="Configura grafo della Raccolta">${body}</section></div>`;
  }
}

if (!customElements.get("artaround-collection-graph-dialog")) {
  customElements.define("artaround-collection-graph-dialog", ArtAroundCollectionGraphDialog);
}
