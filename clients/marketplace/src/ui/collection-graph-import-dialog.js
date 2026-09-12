import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function shortId(value) { const valueId = id(value); return valueId ? valueId.slice(-8) : "—"; }

export class ArtAroundCollectionGraphImportDialog extends HTMLElement {
  config = null;
  taskDialog = null;
  view = "list";
  sources = [];
  restorableEdges = [];
  currentSourceId = null;
  query = "";
  page = 1;
  choices = null;
  selectedGraph = null;
  preview = null;
  selectedItems = new Map();
  busy = false;
  error = null;

  connectedCallback() {}

  disconnectedCallback() {
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }

  configure(config = {}) {
    this.config = config;
    this.view = "list";
    this.sources = [];
    this.restorableEdges = [];
    this.currentSourceId = null;
    this.resetTransientState();
    this.ensureDialog();
    this.render();
    void this.loadManager();
  }

  ensureDialog() {
    if (this.taskDialog) return;
    this.taskDialog = createTaskDialog({
      eyebrow: "Grafo semantico",
      title: "Gestisci sorgenti",
      description: "Collega grafi riutilizzabili, importa contenuti e gestisci gli aggiornamenti senza duplicare il grafo locale della Raccolta.",
      size: "large",
      initialFocus: "[data-source-manager-add], [data-source-manager-source-id], [data-modal-dismiss]",
      renderBody: () => this.renderBody(),
      renderFooter: () => `<button type="button" class="button-secondary" data-modal-dismiss>Chiudi</button>`,
      isBusy: () => this.busy,
      onDismiss: () => {
        this.taskDialog = null;
        if (this.isConnected) this.remove();
      },
      onClick: this.onClick,
      onSubmit: this.onSubmit,
      onChange: this.onChange,
    });
  }

  editable() { return this.config?.editable !== false; }
  currentSource() { return this.sources.find((entry) => id(entry.id) === id(this.currentSourceId)) || null; }

  resetTransientState() {
    this.query = "";
    this.page = 1;
    this.choices = null;
    this.selectedGraph = null;
    this.preview = null;
    this.selectedItems.clear();
    this.error = null;
  }

  close() {
    this.taskDialog?.close();
    this.taskDialog = null;
    if (this.isConnected) this.remove();
  }

  notify(detail = {}) {
    this.dispatchEvent(new CustomEvent("collection-graph-source-changed", { bubbles: true, detail }));
  }

  focusFirst() {
    const selector = this.view === "list"
      ? "[data-source-manager-source-id], [data-source-manager-add], [data-modal-dismiss]"
      : "[data-source-manager-back], input, select, button";
    this.taskDialog?.focus(selector);
  }

  render() {
    this.ensureDialog();
    this.taskDialog?.render();
  }

  async loadManager({ preserveView = true } = {}) {
    if (!this.config?.editorialContextId) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const [sources, restorable] = await Promise.all([
        editorialRepository.graphImportSources(this.config.editorialContextId),
        editorialRepository.restorableGraphEdges(this.config.editorialContextId),
      ]);
      this.sources = sources?.results || [];
      this.restorableEdges = restorable?.results || [];
      if (this.currentSourceId && !this.currentSource()) {
        this.currentSourceId = null;
        this.view = "list";
      }
      if (!preserveView) this.view = "list";
      if (this.view === "restorable" && !this.restorableEdges.length) this.view = "list";
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare le sorgenti";
    } finally {
      this.busy = false;
      this.render();
      this.focusFirst();
    }
  }

  goList() {
    this.view = "list";
    this.currentSourceId = null;
    this.resetTransientState();
    this.render();
    this.focusFirst();
  }

  openDetail(sourceId) {
    const source = this.sources.find((entry) => id(entry.id) === id(sourceId));
    if (!source) return;
    this.currentSourceId = id(source.id);
    this.view = "detail";
    this.resetTransientState();
    this.render();
    this.focusFirst();
  }

  openAdd() {
    if (!this.editable()) return;
    this.view = "add";
    this.resetTransientState();
    this.render();
    void this.loadChoices();
  }

  openImport() {
    const source = this.currentSource();
    if (!source || !this.editable()) return;
    this.view = "import";
    this.preview = source.preview || null;
    this.selectedItems.clear();
    this.error = null;
    this.render();
    this.focusFirst();
  }

  openRestorable() {
    if (!this.restorableEdges.length) return;
    this.view = "restorable";
    this.currentSourceId = null;
    this.resetTransientState();
    this.render();
    this.focusFirst();
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
        excludeSemanticGraphIds: [
          this.config.localSemanticGraphId,
          ...this.sources.map((entry) => id(entry.sourceSemanticGraphId)),
        ].filter(Boolean),
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
      const selector = this.taskDialog?.layer.querySelector(`[data-import-subject-item="${CSS.escape(subjectId)}"]`);
      const itemId = selector instanceof HTMLSelectElement ? selector.value : this.preferredItem(row);
      if (itemId) this.selectedItems.set(subjectId, itemId);
      return;
    }
    if (target.matches("[data-import-subject-item]")) {
      const subjectId = target.dataset.importSubjectItem;
      const toggle = this.taskDialog?.layer.querySelector(`[data-import-subject-toggle="${CSS.escape(subjectId)}"]`);
      if (toggle instanceof HTMLInputElement && toggle.checked) {
        if (target.value) this.selectedItems.set(subjectId, target.value);
        else this.selectedItems.delete(subjectId);
      }
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-source-manager-back]")) {
      if (this.view === "import") {
        this.view = "detail";
        this.preview = null;
        this.selectedItems.clear();
        this.error = null;
        this.render();
        this.focusFirst();
      } else this.goList();
      return;
    }
    const sourceCard = target.closest("[data-source-manager-source-id]");
    if (sourceCard) { this.openDetail(sourceCard.dataset.sourceManagerSourceId); return; }
    if (target.closest("[data-source-manager-add]")) { this.openAdd(); return; }
    if (target.closest("[data-source-manager-restorable]")) { this.openRestorable(); return; }
    if (target.closest("[data-source-manager-import]")) { this.openImport(); return; }
    if (target.closest("[data-source-manager-check-update]")) { await this.requestUpdate(); return; }
    if (target.closest("[data-source-manager-detach]")) { await this.requestDetach(); return; }
    const restoreButton = target.closest("[data-source-manager-restore-edge]");
    if (restoreButton) { void this.restoreEdge(restoreButton.dataset.sourceManagerRestoreEdge); return; }

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
    if (!this.selectedGraph || this.busy || !this.editable()) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const result = await editorialRepository.attachGraphImportSource(this.config.editorialContextId, id(this.selectedGraph));
      this.notify({ action: "source-added", source: result?.source || null });
      this.view = "list";
      this.selectedGraph = null;
      this.choices = null;
      await this.loadManager();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Sorgente non aggiunta";
      this.busy = false;
      this.render();
    }
  }

  async importContents(itemIds) {
    const sourceId = id(this.currentSourceId);
    if (!sourceId || this.busy || !this.editable()) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const imported = await editorialRepository.importGraphSubjects(this.config.editorialContextId, sourceId, itemIds);
      this.notify({ action: "contents-imported", sourceId, imported });
      this.view = "detail";
      this.preview = null;
      this.selectedItems.clear();
      await this.loadManager();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Importazione non completata";
      this.busy = false;
      this.render();
    }
  }

  async requestUpdate() {
    const source = this.currentSource();
    if (!source || !this.editable() || this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const preview = await editorialRepository.graphImportSourceUpdatePreview(this.config.editorialContextId, id(source.id));
      if (!preview?.updateAvailable) {
        this.error = "La sorgente è già aggiornata.";
        return;
      }
      const diff = preview.diff || {};
      const confirmed = await openActionDialog({
        title: `Aggiornare “${source.preview?.source?.name || "questa sorgente"}”?`,
        message: `La nuova revisione aggiunge ${Number(diff.addedSubjectCount || 0)} soggetti e ${Number(diff.addedRelationCount || 0)} collegamenti; nella sorgente risultano rimossi ${Number(diff.removedSubjectCount || 0)} soggetti e ${Number(diff.removedRelationCount || 0)} collegamenti. Le scelte locali restano separate dalla sorgente.`,
        confirmLabel: "Aggiorna sorgente",
        cancelLabel: "Annulla",
      });
      if (!confirmed) return;
      await editorialRepository.updateGraphImportSource(this.config.editorialContextId, id(source.id));
      this.notify({ action: "source-updated", sourceId: id(source.id) });
      await this.loadManager();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Sorgente non aggiornata";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async requestDetach() {
    const source = this.currentSource();
    if (!source || !this.editable() || this.busy) return;
    const confirmed = await openActionDialog({
      title: `Scollegare “${source.preview?.source?.name || "questa sorgente"}”?`,
      message: "I contenuti e i collegamenti già presenti nella Raccolta restano invariati. Verrà rimossa soltanto la sorgente riutilizzabile e non saranno più proposti i suoi aggiornamenti.",
      confirmLabel: "Scollega sorgente",
      cancelLabel: "Annulla",
      tone: "danger",
    });
    if (!confirmed) return;
    await this.detachSource();
  }

  async detachSource() {
    const source = this.currentSource();
    if (!source || !this.editable() || this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await editorialRepository.detachGraphImportSource(this.config.editorialContextId, id(source.id));
      this.notify({ action: "source-detached", sourceId: id(source.id) });
      this.view = "list";
      this.currentSourceId = null;
      await this.loadManager();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Sorgente non scollegata";
      this.busy = false;
      this.render();
    }
  }

  async restoreEdge(suppressionId) {
    if (!suppressionId || !this.editable() || this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await editorialRepository.restoreGraphEdge(this.config.editorialContextId, suppressionId);
      this.notify({ action: "edge-restored", suppressionId });
      await this.loadManager();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Collegamento non ripristinato";
      this.busy = false;
      this.render();
    }
  }

  subviewHeading(title, { back = false } = {}) {
    return `<div class="section-heading source-manager-header"><div>${back ? `<button type="button" class="source-manager-back" data-source-manager-back>← Sorgenti</button>` : `<span class="eyebrow">Sorgenti</span>`}<h3>${escapeHtml(title)}</h3></div></div>`;
  }

  renderSourceCard(source) {
    const preview = source.preview || {};
    const summary = preview.summary || {};
    const available = Number(summary.inCollectionSubjectCount || 0) + Number(summary.directlyImportableSubjectCount || 0) + Number(summary.ambiguousSubjectCount || 0);
    return `<button type="button" class="source-manager-card" data-source-manager-source-id="${escapeHtml(id(source.id))}"><span class="source-manager-card-icon">${icon("link", { size: 20 })}</span><span class="source-manager-card-body"><span class="source-manager-card-top"><strong>${escapeHtml(preview.source?.name || "Sorgente")}</strong>${source.updateAvailable ? `<span class="status warning">Aggiornamento</span>` : ""}</span><small>rev ${escapeHtml(shortId(source.sourceGraphRevisionId))}</small><span>${Number(summary.activeSubjectCount || 0)} attivi · ${available} disponibili · ${Number(summary.sourceRelationCount || 0)} collegamenti</span></span><span class="source-manager-card-arrow">${icon("chevron", { size: 16 })}</span></button>`;
  }

  renderList() {
    return `${this.subviewHeading("Sorgenti collegate")}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      ${this.busy && !this.sources.length ? `<artaround-progress-state>Caricamento…</artaround-progress-state>` : `<div class="source-manager-grid">${this.sources.map((source) => this.renderSourceCard(source)).join("")}${this.editable() ? `<button type="button" class="source-manager-card source-manager-card--add" data-source-manager-add><span class="source-manager-card-plus">${icon("plus", { size: 28 })}</span><strong>Aggiungi sorgente</strong></button>` : ""}</div>`}
      ${this.restorableEdges.length ? `<button type="button" class="source-manager-restorable-entry" data-source-manager-restorable><span>${icon("undo", { size: 17 })}</span><strong>Collegamenti ripristinabili</strong><span class="count">${this.restorableEdges.length}</span><span>${icon("chevron", { size: 15 })}</span></button>` : ""}`;
  }

  renderDetail() {
    const source = this.currentSource();
    if (!source) return this.renderList();
    const preview = source.preview || {};
    const summary = preview.summary || {};
    const available = Number(summary.inCollectionSubjectCount || 0) + Number(summary.directlyImportableSubjectCount || 0) + Number(summary.ambiguousSubjectCount || 0);
    return `${this.subviewHeading(preview.source?.name || "Sorgente", { back: true })}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="source-manager-detail-stats"><span><small>Revisione</small><strong>${escapeHtml(shortId(source.sourceGraphRevisionId))}</strong></span><span><small>Subject attivi</small><strong>${Number(summary.activeSubjectCount || 0)}</strong></span><span><small>Contenuti disponibili</small><strong>${available}</strong></span><span><small>Collegamenti</small><strong>${Number(summary.sourceRelationCount || 0)}</strong></span></div>
      ${this.editable() ? `<div class="source-manager-detail-actions"><button type="button" data-source-manager-import>Importa contenuti</button>${source.updateAvailable ? `<button type="button" class="button-secondary" data-source-manager-check-update>Aggiorna sorgente</button>` : ""}<button type="button" class="button-secondary danger" data-source-manager-detach>Scollega sorgente</button></div>` : ""}`;
  }

  renderSources() {
    const results = this.choices?.results || [];
    const pagination = this.choices?.pagination || { page: this.page, totalPages: 0 };
    return `${this.subviewHeading("Aggiungi sorgente", { back: true })}
      <form data-graph-source-search role="search" class="collection-graph-search"><label>Cerca<input name="q" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="collection-graph-choice-list">${results.map((graph) => {
        const coverage = graph.currentSpaceCoverage || {};
        const selected = id(graph) === id(this.selectedGraph);
        return `<button type="button" class="collection-graph-choice-card" data-graph-source-choice="${escapeHtml(id(graph))}" aria-pressed="${selected}" ${this.busy ? "disabled" : ""}><span class="collection-graph-choice-icon">${icon("link", { size: 18 })}</span><span class="collection-graph-choice-copy"><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><small>${escapeHtml(graph.description || "")}</small><span>${Number(graph.subjectCount || 0)} soggetti · ${Number(graph.relationCount || 0)} relazioni</span><span>${Number(coverage.coveredSubjectCount || 0)}/${Number(coverage.totalSubjectCount || 0)} con contenuti nello Spazio</span></span></button>`;
      }).join("") || `<artaround-empty-state><p>${this.busy ? "Caricamento…" : "Nessuna nuova sorgente compatibile disponibile."}</p></artaround-empty-state>`}</div>
      ${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine"><button type="button" data-graph-source-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-graph-source-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
      <div class="operations"><button type="button" data-attach-source ${!this.selectedGraph || this.busy ? "disabled" : ""}>${this.busy ? "Aggiunta…" : "Aggiungi sorgente"}</button></div>`;
  }

  renderRow(row) {
    const subjectId = id(row.subject?.id);
    const selectable = this.rowSelectable(row);
    const candidates = row.itemCandidates || [];
    const checked = this.selectedItems.has(subjectId);
    const statusLabel = row.status === "active" ? "Già attivo"
      : row.status === "in_collection" ? "Già nella Raccolta"
        : row.status === "addable" ? "Disponibile"
          : row.status === "ambiguous" ? `${candidates.length} contenuti possibili`
            : "Non disponibile";
    const conflict = row.classificationConflict
      ? `<small class="collection-graph-import-warning">La classificazione locale verrà mantenuta.</small>`
      : "";
    const selector = row.status === "ambiguous"
      ? `<select data-import-subject-item="${escapeHtml(subjectId)}" aria-label="Contenuto per ${escapeHtml(row.subject?.label || "Subject")}"><option value="">Scegli il contenuto…</option>${candidates.map((candidate) => `<option value="${escapeHtml(id(candidate.itemId))}" ${this.selectedItems.get(subjectId) === id(candidate.itemId) ? "selected" : ""}>${escapeHtml(candidate.label || `Contenuto ${id(candidate.itemId).slice(-6)}`)}</option>`).join("")}</select>`
      : candidates.length ? `<small>${escapeHtml(candidates[0].label || "Contenuto disponibile")}</small>` : "";
    return `<article class="collection-graph-import-row ${selectable ? "" : "is-disabled"}"><label><input type="checkbox" data-import-subject-toggle="${escapeHtml(subjectId)}" ${selectable ? "" : "disabled"} ${checked ? "checked" : ""}><span><strong>${escapeHtml(row.subject?.label || "Subject")}</strong><small>${escapeHtml(statusLabel)} · ${Number(row.sourceRelationCount || 0)} collegamenti</small>${conflict}</span></label>${selector}</article>`;
  }

  renderImport() {
    const summary = this.preview?.summary || {};
    return `${this.subviewHeading("Importa contenuti", { back: true })}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="collection-graph-import-summary"><span><strong>${Number(summary.activeSubjectCount || 0)}</strong> già attivi</span><span><strong>${Number(summary.inCollectionSubjectCount || 0)}</strong> già nella Raccolta</span><span><strong>${Number(summary.directlyImportableSubjectCount || 0)}</strong> importabili</span><span><strong>${Number(summary.ambiguousSubjectCount || 0)}</strong> da scegliere</span><span><strong>${Number(summary.unavailableSubjectCount || 0)}</strong> non disponibili</span>${Number(summary.classificationConflictCount || 0) ? `<span><strong>${Number(summary.classificationConflictCount)}</strong> classificazioni diverse</span>` : ""}</div>
      <form data-graph-import-form class="collection-graph-import-form"><div class="collection-graph-import-toolbar"><button type="button" class="button-secondary" data-select-direct-imports>Seleziona tutti i disponibili</button><span>${this.selectedItems.size} selezionati</span></div><div class="collection-graph-import-list">${(this.preview?.results || []).map((row) => this.renderRow(row)).join("")}</div><div class="operations"><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Importazione…" : "Importa contenuti"}</button></div></form>`;
  }

  renderRestorable() {
    return `${this.subviewHeading("Collegamenti ripristinabili", { back: true })}
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <div class="source-manager-restorable-list">${this.restorableEdges.map((entry) => `<article><div><strong>${escapeHtml(entry.sourceSubject?.label || "Subject")} — ${escapeHtml(entry.relation?.label || "collegamento")} → ${escapeHtml(entry.targetSubject?.label || "Subject")}</strong><small>${(entry.supportSources || []).map((source) => escapeHtml(source.name || "Sorgente")).join(" · ")}</small></div>${this.editable() ? `<button type="button" class="button-secondary" data-source-manager-restore-edge="${escapeHtml(id(entry.id))}">Ripristina</button>` : ""}</article>`).join("")}</div>`;
  }

  renderBody() {
    if (this.view === "detail") return this.renderDetail();
    if (this.view === "add") return this.renderSources();
    if (this.view === "import") return this.renderImport();
    if (this.view === "restorable") return this.renderRestorable();
    return this.renderList();
  }
}

if (!customElements.get("artaround-collection-graph-import-dialog")) {
  customElements.define("artaround-collection-graph-import-dialog", ArtAroundCollectionGraphImportDialog);
}
