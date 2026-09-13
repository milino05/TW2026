import { navigate } from "../application/router.js";
import { subjectPresenceRepository } from "../infrastructure/http/subject-presence-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function hasOperation(row, code) { return (row?.availableOperations || []).some((entry) => entry.code === code); }
function mediaKey(value) { return String(value?.url || ""); }
function stateLabel(row) {
  if (row?.proposal) return "Proposta in attesa";
  return ({
    exposed: "Esposto",
    unplaced: "Nell'inventario · da collocare",
    unavailable: "Temporaneamente non disponibile",
    absent: "Non nell'inventario",
  })[row?.relationshipState || row?.inventory?.status] || "Non nell'inventario";
}
function stateTone(row) {
  if (row?.relationshipState === "exposed") return "success";
  if (row?.relationshipState === "unavailable") return "warning";
  return "neutral";
}
function venuePriority(row) {
  if (["venue.inventory.add", "venue.inventory.propose", "venue.inventory.accept_proposal"].some((code) => hasOperation(row, code))) return 0;
  if (row?.proposal) return 1;
  const state = row?.relationshipState || row?.inventory?.status;
  if (state === "unplaced") return 2;
  if (state === "unavailable") return 3;
  if (state === "exposed") return 4;
  return 5;
}
function countLabel(value, singular, plural) { const count = Math.max(0, Number(value) || 0); return `${count} ${count === 1 ? singular : plural}`; }
function dateLabel(value) {
  if (!value) return "";
  try { return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)); }
  catch { return String(value); }
}

export class ArtAroundSubjectPresence extends HTMLElement {
  subjectId = null;
  sourceItemId = null;
  sourcePreviewMedia = null;
  principal = null;
  data = null;
  busy = false;
  error = null;
  pendingProposalVenueId = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    if (this.subjectId && this.principal) void this.load();
    else this.render();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({ subjectId, sourceItemId = null, sourcePreviewMedia = null, principal = null } = {}) {
    const changed = id(this.subjectId) !== id(subjectId)
      || id(this.sourceItemId) !== id(sourceItemId)
      || mediaKey(this.sourcePreviewMedia) !== mediaKey(sourcePreviewMedia)
      || id(this.principal?.id) !== id(principal?.id)
      || String(this.principal?.type || "") !== String(principal?.type || "");
    this.subjectId = subjectId || null;
    this.sourceItemId = sourceItemId || null;
    this.sourcePreviewMedia = sourcePreviewMedia || null;
    this.principal = principal;
    if (changed) {
      this.data = null;
      this.pendingProposalVenueId = null;
    }
    if (this.isConnected) void this.load();
  }

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
      this.dispatchEvent(new CustomEvent("subject-presence-changed", { bubbles: true, composed: true }));
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
    if (!target) return;
    const openInventory = target.closest("button[data-open-venue-inventory]");
    if (openInventory) {
      navigate(`/venues/editor?venueId=${encodeURIComponent(openInventory.dataset.openVenueInventory)}#venue-inventory`);
      return;
    }
    const map = target.closest("button[data-map-venue]");
    if (map) {
      const query = new URLSearchParams({ venueId: map.dataset.mapVenue });
      if (map.dataset.focusTarget) query.set("focusTargetId", map.dataset.focusTarget);
      navigate(`/venues/public?${query.toString()}`);
      return;
    }
    if (target.closest("button[data-cancel-presence-proposal]")) {
      this.pendingProposalVenueId = null; this.error = null; this.render(); return;
    }
    const action = target.closest("button[data-presence-action]");
    if (!action || this.busy) return;
    const venueId = action.dataset.venueId;
    const code = action.dataset.presenceAction;
    if (code === "propose") {
      this.pendingProposalVenueId = venueId; this.error = null; this.render();
      requestAnimationFrame(() => this.querySelector(`[data-presence-proposal-form="${CSS.escape(venueId)}"] textarea`)?.focus({ preventScroll: true }));
      return;
    }
    if (code === "add") {
      await this.executePresenceAction(() => subjectPresenceRepository.addToInventory(venueId, {
        subjectId: this.subjectId,
        sourceItemId: this.sourceItemId,
      }));
      return;
    }
    if (code === "accept") {
      const proposalId = action.dataset.proposalId;
      const confirmed = await openActionDialog({
        tone: "warning",
        title: "Accettare la proposta nell'inventario?",
        message: "Il Subject entrerà nell'inventario come entità da collocare. Nessuno slot verrà assegnato automaticamente.",
        confirmLabel: "Accetta nell'inventario",
        cancelLabel: "Annulla",
      });
      if (!confirmed) return;
      await this.executePresenceAction(() => subjectPresenceRepository.acceptProposal(venueId, proposalId));
      return;
    }
    if (code === "withdraw") {
      const proposalId = action.dataset.proposalId;
      const confirmed = await openActionDialog({
        title: "Ritirare la proposta?",
        message: "La proposta non sarà più in attesa di decisione. Potrai inviarne una nuova in seguito.",
        confirmLabel: "Ritira proposta",
        cancelLabel: "Annulla",
      });
      if (!confirmed) return;
      await this.executePresenceAction(() => subjectPresenceRepository.withdrawProposal(venueId, proposalId));
    }
  };

  renderProposalForm(row) {
    if (id(this.pendingProposalVenueId) !== id(row.venue.id)) return "";
    return `<form class="subject-venue-proposal-form" data-presence-proposal-form="${escapeHtml(row.venue.id)}"><label>Messaggio ai responsabili dell'inventario <textarea name="message" rows="3" maxlength="1000" placeholder="Facoltativo: spiega perché questo Subject dovrebbe entrare nell'inventario della sede."></textarea></label><p>La proposta non modifica l'inventario e non colloca automaticamente l'entità sulla mappa.</p><div class="button-row"><button type="submit" ${this.busy ? "disabled" : ""}>Invia proposta</button><button class="button-secondary" type="button" data-cancel-presence-proposal ${this.busy ? "disabled" : ""}>Annulla</button></div></form>`;
  }

  renderOrganizationVenue(row) {
    const inventory = row.inventory;
    const proposal = row.proposal;
    const place = inventory?.place;
    const actions = [];
    if (hasOperation(row, "venue.inventory.accept_proposal")) actions.push(`<button type="button" data-presence-action="accept" data-venue-id="${escapeHtml(row.venue.id)}" data-proposal-id="${escapeHtml(id(proposal?.id))}">Accetta nell'inventario</button>`);
    if (hasOperation(row, "venue.inventory.withdraw_proposal")) actions.push(`<button class="button-secondary" type="button" data-presence-action="withdraw" data-venue-id="${escapeHtml(row.venue.id)}" data-proposal-id="${escapeHtml(id(proposal?.id))}">Ritira</button>`);
    if (hasOperation(row, "venue.inventory.propose")) actions.push(`<button type="button" data-presence-action="propose" data-venue-id="${escapeHtml(row.venue.id)}">Proponi</button>`);
    if (hasOperation(row, "venue.inventory.add")) actions.push(`<button type="button" data-presence-action="add" data-venue-id="${escapeHtml(row.venue.id)}">Aggiungi all'inventario</button>`);
    if (hasOperation(row, "venue.inventory.open")) actions.push(`<button class="button-secondary" type="button" data-open-venue-inventory="${escapeHtml(row.venue.id)}">Apri inventario</button>`);
    if (hasOperation(row, "venue.map.show")) actions.push(`<button class="button-secondary" type="button" data-map-venue="${escapeHtml(row.venue.id)}" data-focus-target="${escapeHtml(inventory?.venueTargetId || "")}">${icon("map", { size: 15 })} Mostra sulla mappa</button>`);
    const detail = inventory?.status === "exposed" && place
      ? `${place.floorLabel || "Piano"} · ${place.label || "Posizione"}`
      : proposal?.createdAt
        ? `Proposta inviata ${dateLabel(proposal.createdAt)}`
        : row.venue.description || "";
    return `<article class="subject-venue-card" data-state="${escapeHtml(row.relationshipState || "absent")}"><div class="subject-venue-card-main"><div><h4>${escapeHtml(row.venue.name)}</h4><p>${escapeHtml(detail)}</p></div><span class="chip" data-tone="${stateTone(row)}">${escapeHtml(stateLabel(row))}</span></div>${actions.length ? `<div class="button-row">${actions.join("")}</div>` : ""}${this.renderProposalForm(row)}</article>`;
  }

  render() {
    if (!this.subjectId || !this.principal) { this.innerHTML = ""; return; }
    const organizationRows = [...(this.data?.organization?.venues || [])].sort((left, right) => venuePriority(left) - venuePriority(right)
      || String(left.venue?.name || "").localeCompare(String(right.venue?.name || ""), "it"));
    const usage = this.data?.organization?.usage || {};
    const usageFacts = [
      countLabel(usage.availableCount, "contenuto disponibile", "contenuti disponibili"),
      countLabel(usage.draftCount, "bozza", "bozze"),
      countLabel(usage.collectionCount, "raccolta", "raccolte"),
      countLabel(usage.venueCount, "sede", "sedi"),
    ].join(" · ");
    const media = this.sourcePreviewMedia?.url ? this.sourcePreviewMedia : usage.previewMedia;
    const header = this.data ? `<header class="subject-venue-heading">${media?.url ? `<figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || this.data.subject?.preferredLabel || "")}"></figure>` : ""}<div><span class="eyebrow">Presenza nelle sedi</span><h3>${escapeHtml(this.data.subject?.preferredLabel || "Subject")}</h3><p>${escapeHtml(this.data.subject?.description || "")}</p>${this.data.organization ? `<small>${escapeHtml(usageFacts)}</small>` : ""}</div></header>` : "";
    this.innerHTML = `<style>
      artaround-subject-presence{display:block}.subject-venue-surface{display:grid;gap:1rem}.subject-venue-heading{display:grid;grid-template-columns:auto 1fr;gap:.9rem;align-items:start}.subject-venue-heading figure{width:5.5rem;height:5.5rem;margin:0;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--sage-50)}.subject-venue-heading img{width:100%;height:100%;object-fit:cover}.subject-venue-heading h3,.subject-venue-heading p{margin:.15rem 0}.subject-venue-heading small{color:var(--sage-600)}.subject-venue-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:.7rem}.subject-venue-card{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface)}.subject-venue-card-main{display:flex;align-items:flex-start;justify-content:space-between;gap:.8rem}.subject-venue-card h4,.subject-venue-card p{margin:.1rem 0}.subject-venue-card p{color:var(--sage-700)}.subject-venue-proposal-form{display:grid;gap:.6rem;padding-top:.7rem;border-top:1px solid var(--line)}.subject-venue-proposal-form label{display:grid;gap:.35rem}.subject-venue-proposal-form p{margin:0;font-size:.85rem}.subject-venue-section{display:grid;gap:.55rem}.subject-venue-section>h4{margin:0}.subject-venue-loading{padding:1rem;border:1px solid var(--line);border-radius:var(--radius-md)}@media(max-width:38rem){.subject-venue-heading{grid-template-columns:1fr}.subject-venue-card-main{flex-direction:column}.subject-venue-card .button-row>*{width:100%}}
    </style>${this.busy && !this.data ? `<div class="subject-venue-loading"><p>Verifica della presenza nelle sedi…</p></div>` : this.error && !this.data ? `<p role="alert">${escapeHtml(this.error)}</p>` : this.data ? `<section class="subject-venue-surface" aria-busy="${this.busy}">${header}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.data.organization ? `<section class="subject-venue-section"><h4>Sedi della tua organizzazione</h4>${organizationRows.length ? `<div class="subject-venue-list">${organizationRows.map((row) => this.renderOrganizationVenue(row)).join("")}</div>` : `<div class="empty-state compact"><p>L'organizzazione non ha sedi attive.</p></div>`}</section>` : ""}</section>` : ""}`;
  }
}

customElements.define("artaround-subject-presence", ArtAroundSubjectPresence);
