import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueSlotRepository } from "../infrastructure/http/venue-slot-repository.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function inventoryLabel(inventory) {
  if (!inventory) return "Non ancora nell’inventario";
  if (inventory.status === "exposed") return ["Esposta", inventory.slot?.label, inventory.place?.label].filter(Boolean).join(" · ");
  if (inventory.status === "unavailable") return "Nell’inventario · non disponibile";
  return "Nell’inventario · da collocare";
}
function contentLabel(content) {
  const available = Number(content?.availableCount || 0);
  const drafts = Number(content?.draftCount || 0);
  return [
    available ? `${available} ${available === 1 ? "contenuto disponibile" : "contenuti disponibili"}` : "",
    drafts ? `${drafts} ${drafts === 1 ? "bozza" : "bozze"}` : "",
  ].filter(Boolean).join(" · ");
}

export class VenueSlotSubjectAssignment extends HTMLElement {
  venueId = "";
  exhibitSlotId = "";
  query = "";
  result = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.venueId = this.getAttribute("venue-id") || "";
    this.exhibitSlotId = this.getAttribute("exhibit-slot-id") || "";
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-slot-subject-search]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.query = String(data.get("query") || "").trim();
    if (this.query.length < 2) {
      this.error = "Scrivi almeno due caratteri.";
      this.render();
      return;
    }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.result = await managementRepository.searchVenueSubjectCandidates(this.venueId, this.query);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Ricerca non riuscita";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-assign-slot-subject]") : null;
    if (!target || this.busy) return;
    const subjectId = target.dataset.assignSlotSubject;
    if (!subjectId) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const assignment = await venueSlotRepository.assignSubject(this.venueId, this.exhibitSlotId, { subjectId });
      this.dispatchEvent(new CustomEvent("slot-subject-assigned", {
        bubbles: true,
        composed: true,
        detail: assignment,
      }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Assegnazione non riuscita";
      this.busy = false;
      this.render();
    }
  };

  renderCandidates(entries, { suggested = false } = {}) {
    if (!entries?.length) return "";
    const title = suggested ? "Possibili corrispondenze — verifica l’identità" : "Corrispondenze esatte";
    return `<section class="slot-subject-results"><strong>${title}</strong>${entries.map((entry) => {
      const inventory = entry.inventory || null;
      const alreadyHere = id(inventory?.slot?.id) === id(this.exhibitSlotId);
      const action = alreadyHere ? "Già in questo slot" : inventory?.status === "exposed" ? "Ricolloca qui" : inventory ? "Assegna qui" : "Aggiungi e assegna";
      const content = contentLabel(entry.museumContent);
      return `<article class="slot-subject-result"><div><span class="eyebrow">${escapeHtml(inventoryLabel(inventory))}</span><strong>${escapeHtml(entry.preferredLabel || "Subject")}</strong>${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}${content ? `<small>${escapeHtml(content)} · solo contenuti di questa sede</small>` : ""}</div><button type="button" data-assign-slot-subject="${escapeHtml(id(entry))}" ${alreadyHere || this.busy ? "disabled" : ""}>${escapeHtml(action)}</button></article>`;
    }).join("")}</section>`;
  }

  render() {
    const exact = this.renderCandidates(this.result?.exact || []);
    const suggestions = this.renderCandidates(this.result?.suggestions || [], { suggested: true });
    const noExact = this.result && !(this.result.exact || []).length;
    this.innerHTML = `<details class="slot-subject-assignment"><summary>Cerca un Subject da esporre</summary><p class="note">La ricerca privilegia l’inventario e i contenuti di questa sede. Se il Subject non è ancora nell’inventario, ArtAround crea automaticamente l’Entità della sede e la assegna a questo slot.</p><form data-slot-subject-search role="search"><label>Opera, persona o entità<input name="query" value="${escapeHtml(this.query)}" minlength="2" required placeholder="Es. Gioconda"></label><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Ricerca…" : "Cerca"}</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${exact}${suggestions}${noExact ? `<p class="note">Nessuna corrispondenza esatta nella sede. Le proposte restano esplicite: ArtAround non sceglie automaticamente un Subject approssimativo.</p>` : ""}</details>`;
  }
}

customElements.define("artaround-venue-slot-subject-assignment", VenueSlotSubjectAssignment);
