import { navigate } from "../application/router.js";
import { venueCreationRepository } from "../infrastructure/http/venue-creation-repository.js";
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

export class ArtAroundVenueCreateDialog extends HTMLElement {
  taskDialog = null;
  step = "details";
  preflight = null;
  selectedRevisionId = "";
  busy = false;
  creating = false;
  error = null;
  dirty = false;
  draft = { name: "", description: "" };

  connectedCallback() {
    this.addEventListener("click", this.onHostClick);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onHostClick);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }

  get organizationId() { return this.getAttribute("organization-id") || ""; }

  reset() {
    this.step = "details";
    this.preflight = null;
    this.selectedRevisionId = "";
    this.error = null;
    this.busy = false;
    this.creating = false;
    this.dirty = false;
    this.draft = { name: "", description: "" };
  }

  onHostClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-open-venue-create]")) void this.openDialog();
  };

  async openDialog() {
    if (this.taskDialog) return;
    this.reset();
    this.busy = true;
    this.taskDialog = createTaskDialog({
      eyebrow: "Nuova sede",
      title: "Aggiungi una sede",
      description: "Crea il profilo e scegli il vocabolario con cui iniziare a configurarne gli spazi fisici.",
      size: "large",
      initialFocus: "input[name='name']",
      renderBody: () => this.renderBody(),
      renderFooter: () => this.renderFooter(),
      isBusy: () => this.creating,
      isDirty: () => this.dirty,
      onDiscard: () => { this.dirty = false; },
      onDismiss: () => { this.taskDialog = null; this.reset(); },
      onClick: this.onDialogClick,
      onSubmit: this.onDialogSubmit,
      onInput: this.onDialogInput,
      onChange: this.onDialogChange,
    });
    try {
      this.preflight = await venueCreationRepository.preflight(this.organizationId);
      const choices = this.preflight?.choices || [];
      this.selectedRevisionId = id(choices[0]?.physicalVocabularyRevisionId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova sede";
    } finally {
      this.busy = false;
      this.taskDialog?.render();
      this.focusPrimary();
    }
  }

  focusPrimary() {
    const selector = this.step === "details" ? "input[name='name']" : "select[name='physicalVocabularyRevisionId']";
    this.taskDialog?.focus(selector);
  }

  onDialogClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-venue-create-back]")) {
      this.step = "details";
      this.error = null;
      this.taskDialog?.render();
      this.focusPrimary();
      return;
    }
    if (target.closest("[data-manage-physical-vocabularies]")) {
      this.dirty = false;
      this.taskDialog?.close({ notify: false });
      this.taskDialog = null;
      navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.organizationId)}&section=physical`);
    }
  };

  onDialogInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-venue-create-details]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
    this.dirty = true;
  };

  onDialogChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target?.matches("select[name='physicalVocabularyRevisionId']")) return;
    if (target.value === this.selectedRevisionId) return;
    this.selectedRevisionId = target.value;
    this.dirty = true;
  };

  onDialogSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-venue-create-details]")) {
      event.preventDefault();
      const data = new FormData(form);
      this.draft.name = String(data.get("name") || "");
      this.draft.description = String(data.get("description") || "");
      if (!form.reportValidity()) return;
      this.error = null;
      this.step = "physical";
      this.taskDialog?.render();
      this.focusPrimary();
      return;
    }
    if (form.matches("[data-venue-create-physical]")) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      this.selectedRevisionId = String(data.get("physicalVocabularyRevisionId") || "");
      void this.createVenue();
    }
  };

  async createVenue() {
    if (!this.preflight?.allowed || !this.selectedRevisionId || this.creating) return;
    this.creating = true;
    this.busy = true;
    this.error = null;
    this.taskDialog?.render();
    try {
      const created = await venueCreationRepository.create({
        ownerOrganizationId: this.organizationId,
        name: this.draft.name.trim(),
        description: this.draft.description.trim(),
        physicalVocabularyRevisionId: this.selectedRevisionId,
      });
      const venueId = id(created?.venue);
      if (!venueId) throw new Error("La sede è stata creata ma non è stato restituito il suo identificatore");
      this.dirty = false;
      this.taskDialog?.close({ restoreFocus: false, notify: false });
      this.taskDialog = null;
      navigate(`/venues/editor?venueId=${encodeURIComponent(venueId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della sede non completata";
      this.creating = false;
      this.busy = false;
      this.taskDialog?.render();
      this.focusPrimary();
    }
  }

  renderStepper() {
    const steps = [["details", "1", "Dettagli"], ["physical", "2", "Vocabolario fisico"]];
    const currentIndex = steps.findIndex(([key]) => key === this.step);
    return `<ol class="venue-create-stepper" aria-label="Creazione sede">${steps.map(([key, number, label], index) => `<li class="${key === this.step ? "is-current" : index < currentIndex ? "is-complete" : ""}" ${key === this.step ? 'aria-current="step"' : ""}><span>${index < currentIndex ? "✓" : number}</span><strong>${label}</strong></li>`).join("")}</ol>`;
  }

  renderDetailsStep() {
    return `<form id="venue-create-details-form" class="venue-create-form" data-venue-create-details>
      <section class="venue-create-section">
        <header class="section-heading"><div><span class="eyebrow">Passaggio 1 di 2</span><h3>Dettagli della sede</h3><p>Definisci l'identità della sede. Potrai modificare nome e descrizione anche in seguito.</p></div></header>
        <div class="venue-create-fields">
          <label>Nome della sede<input name="name" required placeholder="Pinacoteca Nazionale di Bologna" value="${escapeHtml(this.draft.name)}"></label>
          <label>Descrizione<textarea name="description" rows="3" placeholder="Descrivi brevemente il museo, edificio o spazio espositivo">${escapeHtml(this.draft.description)}</textarea></label>
        </div>
      </section>
    </form>`;
  }

  renderPhysicalStep() {
    const choices = this.preflight?.choices || [];
    const options = choices.map((choice) => {
      const revisionId = id(choice.physicalVocabularyRevisionId);
      const suffix = choice.basis === "license" ? " · acquisito" : "";
      const version = choice.version ? ` · v${choice.version}` : "";
      return `<option value="${escapeHtml(revisionId)}" ${revisionId === id(this.selectedRevisionId) ? "selected" : ""}>${escapeHtml(choice.name)}${escapeHtml(version)}${escapeHtml(suffix)}</option>`;
    }).join("");
    return `<form id="venue-create-physical-form" class="venue-create-form" data-venue-create-physical>
      <section class="venue-create-section">
        <header class="section-heading"><div><span class="eyebrow">Passaggio 2 di 2</span><h3>Vocabolario fisico</h3><p>Determina i tipi di luoghi, collegamenti e attributi disponibili quando configurerai gli spazi della sede.</p></div></header>
        <div class="venue-create-fields venue-create-fields--compact">
          <label>Vocabolario fisico<select name="physicalVocabularyRevisionId" required>${options}</select></label>
          <p class="note">La configurazione iniziale verrà creata rispetto alla revisione selezionata. Il vocabolario resta una risorsa autonoma e riutilizzabile.</p>
        </div>
      </section>
    </form>`;
  }

  renderBlocker() {
    const blocker = this.preflight?.blockers?.[0];
    const canManageMissingVocabulary = blocker?.code === "PHYSICAL_VOCABULARY_REQUIRED"
      && this.preflight?.canManagePhysicalVocabularies;
    const manageAction = canManageMissingVocabulary
      ? `<button type="button" data-manage-physical-vocabularies>Gestisci vocabolari fisici</button>`
      : "";
    return `<div class="empty-state venue-create-blocker"><span>${icon("warning", { size: 28 })}</span><h3>La sede non può ancora essere creata</h3><p>${escapeHtml(blocker?.message || "Manca un vocabolario fisico utilizzabile.")}</p>${manageAction ? `<div class="button-row">${manageAction}</div>` : ""}</div>`;
  }

  renderBody() {
    if (this.busy && !this.preflight) return `<artaround-progress-state>Preparazione della nuova sede…</artaround-progress-state>`;
    if (this.error && !this.preflight) return `<div class="empty-state venue-create-blocker"><artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout></div>`;
    if (!this.preflight?.allowed) return this.renderBlocker();
    const step = this.step === "physical" ? this.renderPhysicalStep() : this.renderDetailsStep();
    return `${this.renderStepper()}${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<div class="venue-create-modal-body">${step}</div>`;
  }

  renderFooter() {
    if (this.busy && !this.preflight) return `<button type="button" class="button-secondary" data-modal-dismiss>Chiudi</button>`;
    if (!this.preflight?.allowed) return `<button type="button" class="button-secondary" data-modal-dismiss>Chiudi</button>`;
    if (this.step === "physical") return `<button type="button" class="button-secondary" data-venue-create-back>← Indietro</button><button type="submit" form="venue-create-physical-form" ${this.creating ? "disabled" : ""}>${this.creating ? "Creazione…" : "Crea sede"}</button>`;
    return `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button><button type="submit" form="venue-create-details-form">Continua ${icon("chevron", { size: 15 })}</button>`;
  }

  render() {
    this.innerHTML = `<button type="button" data-open-venue-create>${icon("plus", { size: 15 })} Aggiungi sede</button>`;
  }
}

customElements.define("artaround-venue-create-dialog", ArtAroundVenueCreateDialog);
