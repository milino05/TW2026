import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
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
function occurrenceLabel(occurrence) {
  return [
    occurrence?.venue?.name,
    occurrence?.location?.floorLabel,
    occurrence?.location?.placeLabel,
    occurrence?.location?.exhibitSlotLabel,
  ].filter(Boolean).join(" · ");
}
function profileSummary(profiles = []) {
  const locales = [...new Set(profiles.map((entry) => entry.locale).filter(Boolean))];
  const suffix = locales.length ? ` · ${locales.join(", ")}` : "";
  return `${profiles.length} ${profiles.length === 1 ? "presentazione" : "presentazioni"}${suffix}`;
}

export class ArtAroundVisitContentAddDialog extends HTMLElement {
  taskDialog = null;
  step = "select";
  query = "";
  page = 1;
  pageSize = 12;
  access = "all";
  source = "all";
  data = null;
  includedRevisionIds = null;
  selected = new Map();
  placements = new Map();
  busy = false;
  error = null;
  searchTimer = null;

  connectedCallback() {
    void this.openDialog();
  }

  disconnectedCallback() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }

  get visitId() { return this.getAttribute("visit-id") || ""; }

  async openDialog() {
    if (this.taskDialog || !this.visitId) return;
    this.taskDialog = createTaskDialog({
      eyebrow: "Costruisci la visita",
      title: "Aggiungi contenuti",
      description: "Scegli tra i contenuti utilizzabili da questa area di lavoro. Le collocazioni fisiche vengono decise nel passaggio successivo.",
      size: "large",
      initialFocus: "input[name='q']",
      renderBody: () => this.renderBody(),
      renderFooter: () => this.renderFooter(),
      isBusy: () => this.busy,
      isDirty: () => this.selected.size > 0,
      onDiscard: () => { this.selected.clear(); this.placements.clear(); },
      onDismiss: () => { this.taskDialog = null; this.remove(); },
      onClick: this.onDialogClick,
      onSubmit: this.onDialogSubmit,
      onInput: this.onDialogInput,
      onChange: this.onDialogChange,
    });
    await this.load();
  }

  async load({ focusSearch = false } = {}) {
    this.busy = true;
    this.error = null;
    this.taskDialog?.render();
    try {
      const projectionRequest = this.includedRevisionIds === null
        ? authoringRepository.visitProjection({ visitId: this.visitId })
        : Promise.resolve(null);
      const [data, projection] = await Promise.all([
        authoringRepository.searchVisitContentCandidates(this.visitId, {
          q: this.query,
          access: this.access,
          source: this.source,
          page: this.page,
          limit: this.pageSize,
        }),
        projectionRequest,
      ]);
      this.data = data;
      if (projection) {
        this.includedRevisionIds = new Set(
          (projection?.visit?.revision?.entries || []).map((entry) => id(entry.itemRevisionId)).filter(Boolean),
        );
      }
      const maxPage = Math.max(1, Math.ceil(Number(this.data?.total || 0) / this.pageSize));
      if (this.page > maxPage) {
        this.page = maxPage;
        this.data = await authoringRepository.searchVisitContentCandidates(this.visitId, {
          q: this.query,
          access: this.access,
          source: this.source,
          page: this.page,
          limit: this.pageSize,
        });
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i contenuti disponibili";
    } finally {
      this.busy = false;
      this.taskDialog?.render();
      if (focusSearch && this.step === "select") requestAnimationFrame(() => this.taskDialog?.focus("input[name='q']"));
    }
  }

  candidateKey(candidate) { return id(candidate?.itemRevisionId); }

  toggleCandidate(candidate) {
    const key = this.candidateKey(candidate);
    if (!key || this.includedRevisionIds?.has(key)) return;
    if (this.selected.has(key)) {
      this.selected.delete(key);
      this.placements.delete(key);
    } else {
      this.selected.set(key, candidate);
    }
    this.taskDialog?.render();
  }

  selectedCandidates() { return [...this.selected.values()]; }

  candidatesNeedingPlacement() {
    return this.selectedCandidates().filter((candidate) => (candidate.placementOptions?.occurrences || []).length > 0);
  }

  placementComplete() {
    return this.candidatesNeedingPlacement().every((candidate) => {
      const choice = this.placements.get(this.candidateKey(candidate));
      if (!choice?.mode) return false;
      return choice.mode !== "physical" || Boolean(choice.venueTargetId);
    });
  }

  continueToPlacement() {
    if (!this.selected.size) return;
    if (!this.candidatesNeedingPlacement().length) {
      void this.submitSelection();
      return;
    }
    this.step = "placement";
    this.error = null;
    this.taskDialog?.render();
    this.taskDialog?.focus("input[type='radio']");
  }

  onDialogClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const choice = target.closest("[data-content-choice]");
    if (choice) {
      const candidate = (this.data?.results || []).find((entry) => this.candidateKey(entry) === choice.dataset.contentChoice);
      if (candidate) this.toggleCandidate(candidate);
      return;
    }
    const accessButton = target.closest("[data-content-access]");
    if (accessButton) {
      this.access = accessButton.dataset.contentAccess || "all";
      this.page = 1;
      void this.load();
      return;
    }
    const pageButton = target.closest("[data-content-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.contentPage) || 1);
      void this.load();
      return;
    }
    if (target.closest("[data-content-continue]")) { this.continueToPlacement(); return; }
    if (target.closest("[data-placement-back]")) {
      this.step = "select";
      this.error = null;
      this.taskDialog?.render();
      this.taskDialog?.focus("input[name='q']");
      return;
    }
    if (target.closest("[data-add-selected-content]")) void this.submitSelection();
  };

  onDialogSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-visit-content-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    void this.load({ focusSearch: true });
  };

  onDialogInput = (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target?.matches("input[name='q']")) return;
    this.query = target.value;
    this.page = 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load({ focusSearch: true }), 280);
  };

  onDialogChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-source-filter]")) {
      this.source = target.value || "all";
      this.page = 1;
      void this.load();
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-placement-mode]")) {
      const key = target.dataset.placementMode;
      const mode = target.value;
      const current = this.placements.get(key) || {};
      this.placements.set(key, mode === "contextual" ? { mode } : { mode, venueTargetId: current.venueTargetId || null });
      this.taskDialog?.render();
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-placement-target]")) {
      const key = target.dataset.placementTarget;
      this.placements.set(key, { mode: "physical", venueTargetId: target.value });
      this.taskDialog?.render();
    }
  };

  async submitSelection() {
    if (!this.selected.size || this.busy) return;
    const physicalCandidates = this.candidatesNeedingPlacement();
    if (physicalCandidates.length && !this.placementComplete()) return;
    const entries = this.selectedCandidates().map((candidate) => {
      const key = this.candidateKey(candidate);
      const occurrences = candidate.placementOptions?.occurrences || [];
      const placement = occurrences.length ? this.placements.get(key) : { mode: "contextual" };
      return {
        contentSource: candidate.contentSource,
        itemEditionId: candidate.itemEditionId,
        itemRevisionId: candidate.itemRevisionId,
        role: "recommended",
        placement,
      };
    });
    this.busy = true;
    this.error = null;
    this.taskDialog?.render();
    try {
      const response = await authoringRepository.addVisitContent(this.visitId, { entries });
      const count = response?.command?.added?.length || entries.length;
      this.selected.clear();
      this.placements.clear();
      this.dispatchEvent(new CustomEvent("visit-content-added", { bubbles: true, detail: { count, response } }));
      this.taskDialog?.close({ notify: false });
      this.taskDialog = null;
      this.remove();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere i contenuti alla visita";
      this.busy = false;
      this.taskDialog?.render();
    }
  }

  renderCandidate(candidate) {
    const key = this.candidateKey(candidate);
    const alreadyIncluded = this.includedRevisionIds?.has(key) || false;
    const selected = !alreadyIncluded && this.selected.has(key);
    const provenance = (candidate.availability || []).slice(0, 2).map((entry) => `<span class="chip">${escapeHtml(entry.label)}</span>`).join("");
    return `<button type="button" class="task-resource-choice" data-content-choice="${escapeHtml(key)}" aria-pressed="${selected}" aria-current="${selected}" ${alreadyIncluded ? "disabled" : ""}>
      <span class="task-resource-choice__mark">${selected || alreadyIncluded ? icon("check", { size: 18 }) : icon("book", { size: 18 })}</span>
      <span class="task-resource-choice__copy"><strong>${escapeHtml(candidate.label || "Contenuto")}</strong><small>${escapeHtml((candidate.authorCredits || []).join(", ") || "Autore non indicato")}</small><span class="task-resource-choice__meta">${escapeHtml(profileSummary(candidate.presentationProfiles || []))}</span><span class="button-row">${provenance}</span></span>
      <span class="task-resource-choice__state">${alreadyIncluded ? "Già nella visita" : selected ? "Selezionato" : "Seleziona"}</span>
    </button>`;
  }

  renderSelectStep() {
    const results = this.data?.results || [];
    const total = Number(this.data?.total || 0);
    const page = Number(this.data?.page || this.page);
    const limit = Number(this.data?.limit || this.pageSize);
    const sourceOptions = (this.data?.filters?.sources || []).map((source) => `<option value="${escapeHtml(source.key)}" ${source.key === this.source ? "selected" : ""}>${escapeHtml(source.label)}</option>`).join("");
    return `<div class="task-selection-layout">
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      <form data-visit-content-search class="task-selection-toolbar" role="search"><label>Cerca contenuti<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo o autore" autocomplete="off"></label><span class="task-selection-summary">${total} disponibili</span></form>
      <div class="button-row" role="group" aria-label="Disponibilità dei contenuti"><button type="button" class="${this.access === "all" ? "" : "button-secondary"}" data-content-access="all">Tutti</button><button type="button" class="${this.access === "owned" ? "" : "button-secondary"}" data-content-access="owned">Creati</button><button type="button" class="${this.access === "acquired" ? "" : "button-secondary"}" data-content-access="acquired">Acquisiti</button></div>
      <details class="advanced-panel"><summary>Filtri avanzati</summary><label>Provenienza<select data-source-filter><option value="all">Tutte le fonti</option>${sourceOptions}</select></label></details>
      ${this.busy && !this.data ? `<div class="empty-state compact"><p>Caricamento…</p></div>` : results.length ? `<div class="task-resource-choice-list">${results.map((candidate) => this.renderCandidate(candidate)).join("")}</div>` : `<div class="empty-state compact"><h3>Nessun contenuto disponibile</h3><p>Prova a modificare ricerca o filtri.</p></div>`}
      ${total > limit ? `<nav class="pagination" aria-label="Pagine dei contenuti disponibili"><button type="button" class="button-secondary" data-content-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${Math.ceil(total / limit)}</span><button type="button" class="button-secondary" data-content-page="${page + 1}" ${page * limit >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
    </div>`;
  }

  renderPlacementCard(candidate) {
    const key = this.candidateKey(candidate);
    const occurrences = candidate.placementOptions?.occurrences || [];
    const choice = this.placements.get(key) || {};
    if (!occurrences.length) {
      return `<article class="panel"><span class="eyebrow">Contenuto contestuale</span><h3>${escapeHtml(candidate.label)}</h3><p class="note">Non risultano collocazioni fisiche pubblicate. Verrà aggiunto come contenuto generale della visita.</p></article>`;
    }
    return `<article class="panel"><span class="eyebrow">Collocazione</span><h3>${escapeHtml(candidate.label)}</h3><p class="note">Il soggetto di questo contenuto è presente fisicamente. Scegli intenzionalmente come usarlo nella visita.</p>
      <div class="editor-form">
        <label><span><input type="radio" name="placement-${escapeHtml(key)}" value="contextual" data-placement-mode="${escapeHtml(key)}" ${choice.mode === "contextual" ? "checked" : ""}> Solo contenuto</span><small>Resta un approfondimento contestuale e non crea una tappa.</small></label>
        <label><span><input type="radio" name="placement-${escapeHtml(key)}" value="physical" data-placement-mode="${escapeHtml(key)}" ${choice.mode === "physical" ? "checked" : ""}> Tappa fisica</span><small>Il visitatore dovrà fermarsi davanti a una delle collocazioni pubblicate.</small></label>
        ${choice.mode === "physical" ? `<fieldset><legend>Dove?</legend>${occurrences.map((occurrence) => `<label><span><input type="radio" name="target-${escapeHtml(key)}" value="${escapeHtml(id(occurrence.venueTargetId))}" data-placement-target="${escapeHtml(key)}" ${id(choice.venueTargetId) === id(occurrence.venueTargetId) ? "checked" : ""}> ${escapeHtml(occurrence.label)}</span><small>${escapeHtml(occurrenceLabel(occurrence) || occurrence.venue?.name || "Sede")}</small></label>`).join("")}</fieldset>` : ""}
      </div>
    </article>`;
  }

  renderPlacementStep() {
    return `<div class="task-selection-layout">${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<header class="section-heading"><div><span class="eyebrow">Passaggio 2 di 2</span><h3>Decidi le tappe fisiche</h3><p>La disponibilità di una collocazione è un suggerimento del sistema: la scelta editoriale resta esplicita.</p></div></header>${this.selectedCandidates().map((candidate) => this.renderPlacementCard(candidate)).join("")}</div>`;
  }

  renderBody() {
    return this.step === "placement" ? this.renderPlacementStep() : this.renderSelectStep();
  }

  renderFooter() {
    const count = this.selected.size;
    if (this.step === "placement") {
      return `<button type="button" class="button-secondary" data-placement-back ${this.busy ? "disabled" : ""}>← Indietro</button><span class="task-modal-footer-spacer"></span><span class="task-selection-summary">${count} ${count === 1 ? "contenuto" : "contenuti"}</span><button type="button" data-add-selected-content ${!count || !this.placementComplete() || this.busy ? "disabled" : ""}>${this.busy ? "Aggiunta…" : `Aggiungi ${count} alla visita`}</button>`;
    }
    return `<span class="task-selection-summary">${count ? `${count} ${count === 1 ? "contenuto selezionato" : "contenuti selezionati"}` : "Nessun contenuto selezionato"}</span><span class="task-modal-footer-spacer"></span><button type="button" class="button-secondary" data-modal-dismiss ${this.busy ? "disabled" : ""}>Annulla</button><button type="button" data-content-continue ${!count || this.busy ? "disabled" : ""}>${this.candidatesNeedingPlacement().length ? "Continua" : `Aggiungi ${count}`}</button>`;
  }
}

customElements.define("artaround-visit-content-add-dialog", ArtAroundVisitContentAddDialog);
