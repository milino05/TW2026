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

export class ArtAroundCollectionGraphImportDialog extends HTMLElement {
  config = null;
  mode = "add-source";
  query = "";
  page = 1;
  choices = null;
  selectedGraph = null;
  preview = null;
  selectedItems = new Map();
  busy = false;
  error = null;
  returnFocus = null;

  connectedCallback() {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  configure(config = {}) {
    this.config = config;
    this.mode = config.mode === "import-content" ? "import-content" : "add-source";
    this.query = "";
    this.page = 1;
    this.choices = null;
    this.selectedGraph = null;
    this.preview = this.mode === "import-content" ? config.source?.preview || null : null;
    this.selectedItems.clear();
    this.error = null;
    this.render();
    if (this.mode === "add-source") void this.loadChoices();
    else this.focusFirst();
  }

  close() {
    this.remove();
    this.returnFocus?.focus?.({ preventScroll: true });
  }

  complete(detail = {}) {
    this.dispatchEvent(new CustomEvent("collection-graph-source-changed", { bubbles: true, detail }));
    this.close();
  }

  focusFirst() {
    requestAnimationFrame(() => this.querySelector("button, input, select")?.focus({ preventScroll: true }));
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
        excludeSemanticGraphIds: this.config.excludeSemanticGraphIds || [],
        q: this.query,
        page: this.page,
        limit: 12,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i grafi compatibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  rowSelectable(row) {
    return ["in_collection", "addable", "ambiguous"].includes(row?.status);
  }

  preferredItem(row) {
    const candidates = row?.itemCandidates || [];
    return candidates.length ? id(candidates[0].itemId) : "";
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-import-subject-toggle]")) {
      const subjectId = target.dataset.importSubjectToggle;
      if (!target.checked) { this.selectedItems.delete(subjectId); return; }
      const row = this.preview?.results?.find((entry) => id(entry.subject?.id) === subjectId);
      const selector = this.querySelector(`[data-import-subject-item="${CSS.escape(subjectId)}"]`);
      const itemId = selector instanceof HTMLSelectElement ? selector.value : this.preferredItem(row);
      if (itemId) this.selectedItems.set(subjectId, itemId);
      return;
    }
    if (target.matches("[data-import-subject-item]")) {
      const subjectId = target.dataset.importSubjectItem;
      const toggle = this.querySelector(`[data-import-subject-toggle="${CSS.escape(subjectId)}"]`);
      if (toggle instanceof HTMLInputElement && toggle.checked) {
        if (target.value) this.selectedItems.set(subjectId, target.value);
        else this.selectedItems.delete(subjectId);
      }
    }
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("[data-graph-import-backdrop]") || target.closest("[data-close-graph-import]")) { this.close(); return; }

    const choice = target.closest("[data-graph-source-choice]");
    if (choice) {
      this.selectedGraph = (this.choices?.results || []).find((entry) => id(entry) === choice.dataset.graphSourceChoice) || null;
      this.error = null;
      this.render();
      return;
    }
    const pageButton = target.closest("[data-graph-source-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.graphSourcePage) || 1);
      void this.loadChoices();
      return;
    }
    if (target.closest("[data-attach-source]")) { void this.attachSource(); return; }
    if (target.closest("[data-select-direct-imports]")) {
      for (const row of this.preview?.results || []) {
        if (!["in_collection", "addable"].includes(row.status)) continue;
        const itemId = this.preferredItem(row);
        if (itemId) this.selectedItems.set(id(row.subject?.id), itemId);
      }
      this.render();
    }
  };

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-graph-source-search]")) {
      event.preventDefault();
      this.query = String(new FormData(form).get("q") || "").trim();
      this.page = 1;
      void this.loadChoices();
      return;
    }
    if (!form.matches("[data-graph-import-form]")) return;
    event.preventDefault();
    const itemIds = [];
    for (const toggle of form.querySelectorAll("[data-import-subject-toggle]:checked")) {
      const subjectId = toggle.dataset.importSubjectToggle;
      const row = this.preview?.results?.find((entry) => id(entry.subject?.id) === subjectId);
      const selector = form.querySelector(`[data-import-subject-item="${CSS.escape(subjectId)}"]`);
      const itemId = selector instanceof HTMLSelectElement ? selector.value : this.preferredItem(row);
      if (!itemId) {
        this.error = `Scegli il contenuto da usare per ${row?.subject?.label || "il Subject selezionato"}.`;
        this.render();
        return;
      }
      itemIds.push(itemId);
    }
    if (!itemIds.length) {
      this.error = "Seleziona almeno un contenuto da importare.";
      this.render();
      return;
    }
    void this.importContents([...new Set(itemIds)]);
  };

  async attachSource() {
    if (!this.selectedGraph || this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const result = await editorialRepository.attachGraphImportSource(this.config.editorialContextId, id(this.selectedGraph));
      this.complete({ action: "source-added", source: result?.source || null });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Sorgente non aggiunta";
      this.busy = false;
      this.render();
    }
  }

  async importContents(itemIds) {
    const sourceId = id(this.config?.source?.id);
    if (!sourceId || this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const imported = await editorialRepository.importGraphSubjects(this.config.editorialContextId, sourceId, itemIds);
      this.complete({ action: "contents-imported", sourceId, imported });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Importazione non completata";
      this.busy = false;
      this.render();
    }
  }

  onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...this.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  renderHeader(title, description) {
    return `<header class="task-modal-header"><div><span class="eyebrow">Sorgenti semantiche</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><button type="button" class="button-secondary small" data-close-graph-import aria-label="Chiudi">×</button></header>`;
  }

  renderSources() {
    const results = this.choices?.results || [];
    const pagination = this.choices?.pagination || { page: this.page, totalPages: 0 };
    return `${this.renderHeader("Aggiungi sorgente", "Scegli un grafo compatibile. Verrà pinzata la revisione corrente come sorgente read-only; il grafo locale della Raccolta rimane l'unico modificabile.")}
      <form data-graph-source-search role="search" class="collection-graph-search"><label>Cerca<input name="q" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="collection-graph-choice-list">${results.map((graph) => {
        const coverage = graph.currentSpaceCoverage || {};
        const selected = id(graph) === id(this.selectedGraph);
        return `<button type="button" class="collection-graph-choice-card" data-graph-source-choice="${escapeHtml(id(graph))}" aria-pressed="${selected}" ${this.busy ? "disabled" : ""}><span class="collection-graph-choice-icon">${icon("link", { size: 18 })}</span><span class="collection-graph-choice-copy"><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><small>${escapeHtml(graph.description || "")}</small><span>${Number(graph.subjectCount || 0)} soggetti · ${Number(graph.relationCount || 0)} relazioni</span><span>${Number(coverage.coveredSubjectCount || 0)}/${Number(coverage.totalSubjectCount || 0)} con contenuti nello Spazio</span></span></button>`;
      }).join("") || `<artaround-empty-state><p>${this.busy ? "Caricamento…" : "Nessuna nuova sorgente compatibile disponibile."}</p></artaround-empty-state>`}</div>
      ${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine"><button type="button" data-graph-source-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-graph-source-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
      <div class="operations"><button type="button" class="button-secondary" data-close-graph-import>Annulla</button><button type="button" data-attach-source ${!this.selectedGraph || this.busy ? "disabled" : ""}>${this.busy ? "Aggiunta…" : "Aggiungi sorgente"}</button></div>`;
  }

  renderRow(row) {
    const subjectId = id(row.subject?.id);
    const selectable = this.rowSelectable(row);
    const candidates = row.itemCandidates || [];
    const checked = this.selectedItems.has(subjectId);
    const statusLabel = row.status === "active" ? "Già attivo nel grafo locale"
      : row.status === "in_collection" ? "Già nella Raccolta"
        : row.status === "addable" ? "Disponibile nello Spazio"
          : row.status === "ambiguous" ? `${candidates.length} contenuti possibili`
            : "Nessun contenuto disponibile";
    const conflict = row.classificationConflict
      ? `<small class="collection-graph-import-warning">Classificazione sorgente diversa da quella locale: verrà mantenuta quella della Raccolta.</small>`
      : "";
    const selector = row.status === "ambiguous"
      ? `<select data-import-subject-item="${escapeHtml(subjectId)}" aria-label="Contenuto per ${escapeHtml(row.subject?.label || "Subject")}"><option value="">Scegli il contenuto…</option>${candidates.map((candidate) => `<option value="${escapeHtml(id(candidate.itemId))}" ${this.selectedItems.get(subjectId) === id(candidate.itemId) ? "selected" : ""}>${escapeHtml(candidate.label || `Contenuto ${id(candidate.itemId).slice(-6)}`)}</option>`).join("")}</select>`
      : candidates.length ? `<small>${escapeHtml(candidates[0].label || "Contenuto disponibile")}</small>` : "";
    return `<article class="collection-graph-import-row ${selectable ? "" : "is-disabled"}"><label><input type="checkbox" data-import-subject-toggle="${escapeHtml(subjectId)}" ${selectable ? "" : "disabled"} ${checked ? "checked" : ""}><span><strong>${escapeHtml(row.subject?.label || "Subject")}</strong><small>${escapeHtml(statusLabel)} · ${Number(row.sourceRelationCount || 0)} collegamenti nella sorgente</small>${conflict}</span></label>${selector}</article>`;
  }

  renderImport() {
    const source = this.config?.source || {};
    const summary = this.preview?.summary || {};
    return `${this.renderHeader(`Importa contenuti da “${this.preview?.source?.name || "Sorgente"}”`, "Scegli i contenuti da portare nella Raccolta. I Subject verranno attivati nel grafo locale; i collegamenti compatibili verranno ricavati dall'insieme di tutte le sorgenti pinzate.")}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="collection-graph-import-summary"><span><strong>${Number(summary.activeSubjectCount || 0)}</strong> già attivi</span><span><strong>${Number(summary.inCollectionSubjectCount || 0)}</strong> già nella Raccolta</span><span><strong>${Number(summary.directlyImportableSubjectCount || 0)}</strong> importabili</span><span><strong>${Number(summary.ambiguousSubjectCount || 0)}</strong> da scegliere</span><span><strong>${Number(summary.unavailableSubjectCount || 0)}</strong> non disponibili</span>${Number(summary.classificationConflictCount || 0) ? `<span><strong>${Number(summary.classificationConflictCount)}</strong> classificazioni diverse</span>` : ""}</div>
      <form data-graph-import-form class="collection-graph-import-form"><div class="collection-graph-import-toolbar"><button type="button" class="button-secondary" data-select-direct-imports>Seleziona tutti i disponibili</button><span>${this.selectedItems.size} selezionati</span></div><div class="collection-graph-import-list">${(this.preview?.results || []).map((row) => this.renderRow(row)).join("")}</div><div class="operations"><button type="button" class="button-secondary" data-close-graph-import>Annulla</button><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Importazione…" : "Importa contenuti"}</button></div></form>
      <p class="note">La sorgente resta pinzata alla revisione ${escapeHtml(id(source.sourceGraphRevisionId).slice(-8) || "corrente")}; importare non modifica mai il grafo sorgente.</p>`;
  }

  render() {
    const body = this.mode === "import-content" ? this.renderImport() : this.renderSources();
    this.innerHTML = `<div class="context-task-modal-layer collection-graph-dialog-layer" data-graph-import-backdrop role="presentation"><section class="context-task-modal context-task-modal--large collection-graph-dialog" role="dialog" aria-modal="true" aria-label="Gestisci sorgente semantica">${body}</section></div>`;
  }
}

if (!customElements.get("artaround-collection-graph-import-dialog")) {
  customElements.define("artaround-collection-graph-import-dialog", ArtAroundCollectionGraphImportDialog);
}
