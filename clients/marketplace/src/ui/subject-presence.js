import { navigate } from "../application/router.js";
import { subjectPresenceRepository } from "../infrastructure/http/subject-presence-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function stateLabel(value) { return ({ exposed: "Esposta", unplaced: "Nell'inventario · da collocare", unavailable: "Temporaneamente non disponibile" })[value] || "Non nell'inventario"; }

export class ArtAroundSubjectPresence extends HTMLElement {
  subjectId = null;
  sourceItemId = null;
  principal = null;
  data = null;
  busy = false;
  error = null;
  pendingProposalVenueId = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({ subjectId, sourceItemId = null, principal = null } = {}) {
    const changed = String(this.subjectId || "") !== String(subjectId || "") || String(this.sourceItemId || "") !== String(sourceItemId || "") || String(this.principal?.id || "") !== String(principal?.id || "");
    this.subjectId = subjectId || null;
    this.sourceItemId = sourceItemId || null;
    this.principal = principal;
    if (changed) this.pendingProposalVenueId = null;
    if (changed && this.isConnected) this.load();
  }

  hasOperation(row, code) { return (row?.availableOperations || []).some((entry) => entry.code === code); }

  async load() {
    if (!this.subjectId || !this.principal) { this.data = null; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.data = await subjectPresenceRepository.get(this.subjectId, this.principal); }
    catch (error) { this.error = error instanceof Error ? error.message : "Presenza nelle sedi non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  async executePresenceAction(callback) {
    this.busy = true; this.error = null; this.render();
    try {
      await callback();
      this.pendingProposalVenueId = null;
      await this.load();
      this.dispatchEvent(new CustomEvent("subject-presence-changed", { bubbles: true }));
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione sulla sede non completata";
      return false;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-presence-proposal-form]") || this.busy) return;
    event.preventDefault();
    const data = new FormData(form);
    const venueId = form.dataset.presenceProposalForm;
    await this.executePresenceAction(() => subjectPresenceRepository.propose(venueId, {
      subjectId: this.subjectId,
      sourceItemId: this.sourceItemId,
      message: String(data.get("message") || "").trim() || null,
    }));
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const map = target?.closest("button[data-map-venue]");
    if (map) {
      const query = new URLSearchParams({ venueId: map.dataset.mapVenue });
      if (map.dataset.focusTarget) query.set("focusTargetId", map.dataset.focusTarget);
      navigate(`/venues/public?${query.toString()}`);
      return;
    }
    if (target?.closest("button[data-cancel-presence-proposal]")) {
      this.pendingProposalVenueId = null;
      this.error = null;
      this.render();
      return;
    }
    const action = target?.closest("button[data-presence-action]");
    if (!action || this.busy) return;
    const venueId = action.dataset.venueId;
    if (action.dataset.presenceAction === "propose") {
      this.pendingProposalVenueId = venueId;
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector(`[data-presence-proposal-form="${CSS.escape(venueId)}"] textarea`)?.focus({ preventScroll: true }));
      return;
    }
    if (action.dataset.presenceAction === "add") {
      const confirmed = await openActionDialog({
        tone: "warning",
        title: "Aggiungere all'inventario della sede?",
        message: "Verrà creata l'entità di inventario per questo Subject. Nessuno slot verrà assegnato automaticamente.",
        confirmLabel: "Aggiungi all'inventario",
        cancelLabel: "Annulla",
      });
      if (!confirmed) return;
      await this.executePresenceAction(() => subjectPresenceRepository.addToInventory(venueId, { subjectId: this.subjectId }));
    }
  };

  renderProposalForm(row) {
    if (id(this.pendingProposalVenueId) !== id(row.venue.id)) return "";
    return `<form class="presence-proposal-form" data-presence-proposal-form="${escapeHtml(row.venue.id)}"><label>Messaggio per i curatori <textarea name="message" rows="3" maxlength="1000" placeholder="Facoltativo: spiega perché questo Subject dovrebbe entrare nell'inventario della sede."></textarea></label><p class="presence-note">La proposta non modifica l'inventario e non colloca automaticamente l'entità sulla mappa.</p><div class="button-row"><button type="submit" ${this.busy ? "disabled" : ""}>Invia proposta</button><button class="button-secondary" type="button" data-cancel-presence-proposal ${this.busy ? "disabled" : ""}>Annulla</button></div></form>`;
  }

  renderOrganizationVenue(row) {
    const inventory = row.inventory;
    const proposal = row.proposal;
    const place = inventory?.place;
    return `<article class="presence-row"><div class="presence-main"><strong>${escapeHtml(row.venue.name)}</strong>${inventory?.venueTargetId ? `<span class="status-pill ${inventory.status === "exposed" ? "success" : ""}">${escapeHtml(stateLabel(inventory.status))}</span>` : proposal ? `<span class="status-pill">Proposta in attesa</span>` : `<span class="status-pill">Non nell'inventario</span>`}<small>${inventory?.status === "exposed" && place ? `${escapeHtml(place.floorLabel || "Piano")} · ${escapeHtml(place.label || "Posizione")}` : row.museumContent?.availableCount ? `${row.museumContent.availableCount} contenuti pubblicati dell'organizzazione` : ""}</small></div><div class="button-row">${this.hasOperation(row, "venue.map.show") ? `<button type="button" class="button-secondary small" data-map-venue="${escapeHtml(row.venue.id)}" data-focus-target="${escapeHtml(inventory?.venueTargetId || "")}">${icon("map", { size: 15 })} Mostra sulla mappa</button>` : ""}${this.hasOperation(row, "venue.inventory.propose") ? `<button type="button" class="button-secondary small" data-presence-action="propose" data-venue-id="${escapeHtml(row.venue.id)}">Proponi alla sede</button>` : ""}${this.hasOperation(row, "venue.inventory.add") ? `<button type="button" class="button-secondary small" data-presence-action="add" data-venue-id="${escapeHtml(row.venue.id)}">Aggiungi all'inventario</button>` : ""}</div>${this.renderProposalForm(row)}</article>`;
  }

  renderPublicPlacement(row) {
    return `<article class="presence-row compact"><div class="presence-main"><strong>${escapeHtml(row.venue.name)}</strong><span class="status-pill success">Esposta</span><small>${row.inventory?.place ? `${escapeHtml(row.inventory.place.floorLabel || "Piano")} · ${escapeHtml(row.inventory.place.label || "Posizione")}` : "Configurazione pubblicata"}</small></div><button type="button" class="button-secondary small" data-map-venue="${escapeHtml(row.venue.id)}" data-focus-target="${escapeHtml(row.mapTargetId || "")}">${icon("map", { size: 15 })} Mostra sulla mappa</button></article>`;
  }

  render() {
    if (!this.subjectId || !this.principal) { this.innerHTML = ""; return; }
    const organizationRows = this.data?.organization?.venues || [];
    const publicRows = this.data?.publicPlacements || [];
    const organizationVenueIds = new Set(organizationRows.map((row) => id(row.venue?.id)));
    const externalPublicRows = publicRows.filter((row) => !organizationVenueIds.has(id(row.venue?.id)));
    this.innerHTML = `<style>
      artaround-subject-presence{display:block}artaround-subject-presence .presence-card{display:grid;gap:.75rem;margin-top:1rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle)}
      artaround-subject-presence .presence-card>header h3,artaround-subject-presence .presence-card>header p{margin:.15rem 0}artaround-subject-presence .presence-list{display:grid;gap:.45rem}
      artaround-subject-presence .presence-row{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap;padding:.7rem .8rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}artaround-subject-presence .presence-main{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;min-width:0}artaround-subject-presence .presence-main small{flex-basis:100%;color:var(--muted)}
      artaround-subject-presence .presence-note{margin:0;color:var(--muted);font-size:.85rem}artaround-subject-presence .presence-proposal-form{flex-basis:100%;display:grid;gap:.65rem;padding-top:.7rem;border-top:1px solid var(--border)}artaround-subject-presence .presence-proposal-form label{display:grid;gap:.35rem}
      @media(max-width:48rem){artaround-subject-presence .presence-row{align-items:flex-start;flex-direction:column}artaround-subject-presence .presence-proposal-form{width:100%}}
    </style>${this.busy && !this.data ? `<div class="presence-card"><p>Verifica della presenza nelle sedi…</p></div>` : this.error && !this.data ? `<div class="presence-card"><p role="alert">${escapeHtml(this.error)}</p></div>` : this.data ? `<section class="presence-card" aria-busy="${this.busy}"><header><span class="eyebrow">Presenza nelle sedi</span><h3>Dove è già presente ${escapeHtml(this.data.subject?.preferredLabel || "questo Subject")}</h3><p>La presenza fisica è informativa e resta separata dal contenuto editoriale.</p></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${organizationRows.length ? `<div><h4>Sedi della tua organizzazione</h4><div class="presence-list">${organizationRows.map((row) => this.renderOrganizationVenue(row)).join("")}</div></div>` : ""}${externalPublicRows.length ? `<div><h4>Esposto in altre sedi ArtAround</h4><div class="presence-list">${externalPublicRows.map((row) => this.renderPublicPlacement(row)).join("")}</div></div>` : ""}${!organizationRows.length && !externalPublicRows.length ? `<p class="presence-note">Nessuna presenza fisica pubblicata o gestibile trovata per questo Subject.</p>` : ""}</section>` : ""}`;
  }
}
customElements.define("artaround-subject-presence", ArtAroundSubjectPresence);
