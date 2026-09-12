import { navigate } from "../application/router.js";
import { venueCreationRepository } from "../infrastructure/http/venue-creation-repository.js";
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

export class ArtAroundVenueCreateDialog extends HTMLElement {
  open = false;
  step = "details";
  preflight = null;
  selectedRevisionId = "";
  busy = false;
  creating = false;
  error = null;
  draft = { name: "", description: "" };

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("keydown", this.onKeyDown);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("keydown", this.onKeyDown);
  }

  get organizationId() { return this.getAttribute("organization-id") || ""; }

  async openDialog() {
    if (this.open) return;
    this.open = true;
    this.step = "details";
    this.preflight = null;
    this.selectedRevisionId = "";
    this.error = null;
    this.busy = true;
    this.render();
    try {
      this.preflight = await venueCreationRepository.preflight(this.organizationId);
      const choices = this.preflight?.choices || [];
      this.selectedRevisionId = id(choices[0]?.physicalVocabularyRevisionId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova sede";
    } finally {
      this.busy = false;
      this.render();
      this.focusPrimary();
    }
  }

  closeDialog() {
    if (this.creating) return;
    this.open = false;
    this.busy = false;
    this.error = null;
    this.preflight = null;
    this.step = "details";
    this.selectedRevisionId = "";
    this.draft = { name: "", description: "" };
    this.render();
    requestAnimationFrame(() => this.querySelector("[data-open-venue-create]")?.focus({ preventScroll: true }));
  }

  focusPrimary() {
    requestAnimationFrame(() => {
      const selector = this.step === "details" ? "input[name='name']" : "select[name='physicalVocabularyRevisionId']";
      this.querySelector(selector)?.focus({ preventScroll: true });
    });
  }

  onKeyDown = (event) => {
    if (!this.open || event.defaultPrevented || event.key !== "Escape") return;
    event.preventDefault();
    this.closeDialog();
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-open-venue-create]")) {
      void this.openDialog();
      return;
    }
    if (target.matches("[data-venue-create-backdrop]") || target.closest("[data-close-venue-create], [data-cancel-venue-create]")) {
      this.closeDialog();
      return;
    }
    if (target.closest("[data-venue-create-back]")) {
      this.step = "details";
      this.error = null;
      this.render();
      this.focusPrimary();
      return;
    }
    if (target.closest("[data-manage-physical-vocabularies]")) {
      navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.organizationId)}&section=physical`);
    }
  };

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-venue-create-details]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
  };

  onChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target?.matches("select[name='physicalVocabularyRevisionId']")) return;
    this.selectedRevisionId = target.value;
  };

  onSubmit = (event) => {
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
      this.render();
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
    this.render();
    try {
      const created = await venueCreationRepository.create({
        ownerOrganizationId: this.organizationId,
        name: this.draft.name.trim(),
        description: this.draft.description.trim(),
        physicalVocabularyRevisionId: this.selectedRevisionId,
      });
      const venueId = id(created?.venue);
      if (!venueId) throw new Error("La sede è stata creata ma non è stato restituito il suo identificatore");
      navigate(`/venues/editor?venueId=${encodeURIComponent(venueId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della sede non completata";
      this.creating = false;
      this.busy = false;
      this.render();
      this.focusPrimary();
    }
  }

  renderStepper() {
    const steps = [["details", "1", "Dettagli"], ["physical", "2", "Vocabolario fisico"]];
    const currentIndex = steps.findIndex(([key]) => key === this.step);
    return `<ol class="venue-create-stepper" aria-label="Creazione sede">${steps.map(([key, number, label], index) => `<li class="${key === this.step ? "is-current" : index < currentIndex ? "is-complete" : ""}" ${key === this.step ? 'aria-current="step"' : ""}><span>${index < currentIndex ? "✓" : number}</span><strong>${label}</strong></li>`).join("")}</ol>`;
  }

  renderDetailsStep() {
    return `<form class="venue-create-form" data-venue-create-details>
      <section class="venue-create-section">
        <header class="section-heading"><div><span class="eyebrow">Passaggio 1 di 2</span><h2>Dettagli della sede</h2><p>Definisci l'identità della sede. Potrai modificare nome e descrizione anche in seguito.</p></div></header>
        <div class="venue-create-fields">
          <label>Nome della sede<input name="name" required maxlength="160" placeholder="Pinacoteca Nazionale di Bologna" value="${escapeHtml(this.draft.name)}"></label>
          <label>Descrizione<textarea name="description" rows="3" maxlength="1000" placeholder="Descrivi brevemente il museo, edificio o spazio espositivo">${escapeHtml(this.draft.description)}</textarea></label>
        </div>
      </section>
      <footer class="venue-create-actions"><button type="button" class="button-secondary" data-cancel-venue-create>Annulla</button><button type="submit">Continua ${icon("chevron", { size: 15 })}</button></footer>
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
    return `<form class="venue-create-form" data-venue-create-physical>
      <section class="venue-create-section">
        <header class="section-heading"><div><span class="eyebrow">Passaggio 2 di 2</span><h2>Vocabolario fisico</h2><p>Determina i tipi di luoghi, collegamenti e attributi disponibili quando configurerai gli spazi della sede.</p></div></header>
        <div class="venue-create-fields venue-create-fields--compact">
          <label>Vocabolario fisico<select name="physicalVocabularyRevisionId" required>${options}</select></label>
          <p class="note">La configurazione iniziale verrà creata rispetto alla revisione selezionata. Il vocabolario resta una risorsa autonoma e riutilizzabile.</p>
        </div>
      </section>
      <footer class="venue-create-actions"><button type="button" class="button-secondary" data-venue-create-back>← Indietro</button><button type="submit" ${this.creating ? "disabled" : ""}>${this.creating ? "Creazione…" : "Crea sede"}</button></footer>
    </form>`;
  }

  renderBlocker() {
    const blocker = this.preflight?.blockers?.[0];
    const manageAction = this.preflight?.canManagePhysicalVocabularies
      ? `<button type="button" data-manage-physical-vocabularies>Gestisci vocabolari fisici</button>`
      : "";
    return `<div class="empty-state venue-create-blocker"><span>${icon("warning", { size: 28 })}</span><h2>La sede non può ancora essere creata</h2><p>${escapeHtml(blocker?.message || "Manca un vocabolario fisico utilizzabile.")}</p><div class="button-row">${manageAction}<button type="button" class="button-secondary" data-cancel-venue-create>Chiudi</button></div></div>`;
  }

  renderBody() {
    if (this.busy && !this.preflight) return `<artaround-progress-state>Preparazione della nuova sede…</artaround-progress-state>`;
    if (this.error && !this.preflight) return `<div class="empty-state venue-create-blocker"><artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout><button type="button" class="button-secondary" data-cancel-venue-create>Chiudi</button></div>`;
    if (!this.preflight?.allowed) return this.renderBlocker();
    const step = this.step === "physical" ? this.renderPhysicalStep() : this.renderDetailsStep();
    return `${this.renderStepper()}${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}<div class="venue-create-modal-body">${step}</div>`;
  }

  renderModal() {
    if (!this.open) return "";
    return `<div class="context-task-modal-layer venue-create-modal-layer" data-venue-create-backdrop role="presentation"><section class="context-task-modal context-task-modal--large venue-create-modal" role="dialog" aria-modal="true" aria-labelledby="venue-create-title" aria-busy="${this.busy}"><header class="task-modal-header venue-create-modal-header"><div><span class="eyebrow">Nuova sede</span><h1 id="venue-create-title">Aggiungi una sede</h1><p>Crea il profilo e scegli il vocabolario con cui iniziare a configurarne gli spazi fisici.</p></div><button type="button" class="button-secondary small" data-close-venue-create aria-label="Chiudi">×</button></header>${this.renderBody()}</section></div>`;
  }

  render() {
    this.innerHTML = `<button type="button" data-open-venue-create>${icon("plus", { size: 15 })} Aggiungi sede</button>${this.renderModal()}`;
  }
}

customElements.define("artaround-venue-create-dialog", ArtAroundVenueCreateDialog);
