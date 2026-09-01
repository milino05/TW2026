import { icon } from "./icons.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function statusLabel(value) {
  return {
    pending: "In attesa",
    accepted: "Accettata",
    rejected: "Rifiutata",
    withdrawn: "Ritirata",
  }[value] || value || "Proposta";
}
function inventoryStateLabel(value) {
  return { exposed: "Esposta", unplaced: "Da collocare", unavailable: "Non disponibile" }[value] || "Inventario";
}
function toneForStatus(value) {
  return value === "accepted" ? "success" : value === "rejected" ? "warning" : value === "pending" ? "neutral" : "neutral";
}
function dateLabel(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch { return String(value); }
}

export const venueInventoryProposalsMixin = {
  async refreshInventoryProposals() {
    if (!this.data?.authoringPermissions?.canEditInventory) {
      this.inventoryProposals = null;
      return;
    }
    this.inventoryProposals = await managementRepository.venueInventoryProposals(this.id, {
      status: this.inventoryProposalStatus || "pending",
    });
  },

  handleInventoryProposalInput(event) {
    const target = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.matches("[data-inventory-proposal-message]")) return false;
    this.proposalDecisionMessage = target.value;
    const form = target.closest("form[data-inventory-proposal-decision]");
    const submit = form?.querySelector("button[type='submit']");
    if (submit && form.dataset.inventoryProposalDecision === "reject") submit.disabled = !this.proposalDecisionMessage.trim();
    return true;
  },

  async handleInventoryProposalClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    const filter = target.closest("button[data-inventory-proposal-status]");
    if (filter) {
      this.inventoryProposalStatus = filter.dataset.inventoryProposalStatus || "pending";
      this.pendingProposalDecision = null;
      this.proposalDecisionMessage = "";
      this.busy = true;
      this.error = null;
      this.render();
      try { await this.refreshInventoryProposals(); }
      catch (error) { this.error = error instanceof Error ? error.message : "Proposte non disponibili"; }
      finally { this.busy = false; this.render(); }
      return true;
    }
    const decide = target.closest("button[data-inventory-proposal-action]");
    if (decide) {
      this.pendingProposalDecision = {
        proposalId: decide.dataset.proposalId,
        action: decide.dataset.inventoryProposalAction,
      };
      this.proposalDecisionMessage = "";
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-inventory-proposal-message]")?.focus({ preventScroll: true }));
      return true;
    }
    if (target.closest("button[data-cancel-inventory-proposal-decision]")) {
      this.pendingProposalDecision = null;
      this.proposalDecisionMessage = "";
      this.error = null;
      this.render();
      return true;
    }
    return false;
  },

  async handleInventoryProposalSubmit(form, data) {
    if (!form.matches("form[data-inventory-proposal-decision]")) return false;
    const proposalId = String(form.dataset.proposalId || "");
    const action = String(form.dataset.inventoryProposalDecision || "");
    const message = String(data.get("message") || "").trim();
    if (!proposalId || !["accept", "reject"].includes(action)) return true;
    if (action === "reject" && !message) {
      this.error = "Scrivi una motivazione prima di rifiutare la proposta.";
      this.render();
      return true;
    }
    const success = await this.execute(
      () => action === "accept"
        ? managementRepository.acceptVenueInventoryProposal(this.id, proposalId, { message })
        : managementRepository.rejectVenueInventoryProposal(this.id, proposalId, { message }),
      action === "accept"
        ? "Proposta accettata: il Subject è ora nell’inventario della sede, senza collocazione automatica."
        : "Proposta rifiutata.",
    );
    if (success) {
      this.pendingProposalDecision = null;
      this.proposalDecisionMessage = "";
      this.activeSection = "inventory";
    }
    return true;
  },

  renderInventoryProposalDecision(proposal) {
    const pending = this.pendingProposalDecision;
    if (!pending || id(pending.proposalId) !== id(proposal._id)) return "";
    const reject = pending.action === "reject";
    return `<form class="venue-proposal-decision" data-inventory-proposal-decision="${reject ? "reject" : "accept"}" data-proposal-id="${escapeHtml(id(proposal._id))}"><div><strong>${reject ? "Rifiutare questa proposta?" : "Accettare questa proposta?"}</strong><p>${reject ? "La motivazione è obbligatoria e resta nello storico della proposta." : "Il Subject entrerà nell’inventario come entità da collocare. Nessuno slot verrà assegnato automaticamente."}</p></div><label>${reject ? "Motivazione" : "Nota facoltativa"}<textarea name="message" data-inventory-proposal-message rows="3" maxlength="1000" placeholder="${reject ? "Spiega perché la proposta non è adatta alla sede" : "Aggiungi una nota alla decisione"}">${escapeHtml(this.proposalDecisionMessage || "")}</textarea></label><div class="button-row"><button type="submit" ${reject && !String(this.proposalDecisionMessage || "").trim() ? "disabled" : ""}>${reject ? "Conferma rifiuto" : "Accetta nell’inventario"}</button><button class="button-secondary" type="button" data-cancel-inventory-proposal-decision>Annulla</button></div></form>`;
  },

  renderInventoryProposalCard(proposal) {
    const subject = proposal.subject || {};
    const status = proposal.status || "pending";
    const pending = status === "pending";
    const source = proposal.sourceItemId ? `<span>${icon("book", { size: 14 })} Proposta da un contenuto dell’organizzazione</span>` : `<span>${icon("user", { size: 14 })} Proposta editoriale</span>`;
    const decision = proposal.decision?.message
      ? `<blockquote class="venue-proposal-decision-note"><strong>Decisione</strong><p>${escapeHtml(proposal.decision.message)}</p></blockquote>`
      : "";
    return `<article class="venue-proposal-card" data-status="${escapeHtml(status)}"><header><div><span class="eyebrow">${escapeHtml(subject.preferredLabel || "Subject")}</span><h3>${escapeHtml(subject.preferredLabel || "Identità non disponibile")}</h3></div><span class="chip" data-tone="${toneForStatus(status)}">${escapeHtml(statusLabel(status))}</span></header><p>${escapeHtml(subject.description || "Nessuna descrizione disponibile.")}</p>${proposal.message ? `<blockquote><strong>Motivazione della proposta</strong><p>${escapeHtml(proposal.message)}</p></blockquote>` : ""}<div class="venue-proposal-meta">${source}${proposal.createdAt ? `<span>${icon("history", { size: 14 })} ${escapeHtml(dateLabel(proposal.createdAt))}</span>` : ""}</div>${pending ? `<div class="button-row"><button type="button" data-inventory-proposal-action="accept" data-proposal-id="${escapeHtml(id(proposal._id))}">${icon("check", { size: 15 })} Accetta</button><button class="button-secondary" type="button" data-inventory-proposal-action="reject" data-proposal-id="${escapeHtml(id(proposal._id))}">Rifiuta</button></div>` : decision}${this.renderInventoryProposalDecision(proposal)}</article>`;
  },

  renderInventorySummary() {
    const targets = this.data?.targets || [];
    const counts = { exposed: 0, unplaced: 0, unavailable: 0 };
    for (const target of targets) {
      const state = target.configuration?.state || "unplaced";
      if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
    }
    const sample = targets.slice(0, 8).map((target) => `<article class="venue-inventory-summary-card"><div><strong>${escapeHtml(target.label || target.subject?.label || "Entità")}</strong><small>${escapeHtml(target.subject?.label || "Subject")}</small></div><span class="chip" data-tone="${target.configuration?.state === "exposed" ? "success" : target.configuration?.state === "unavailable" ? "warning" : "neutral"}">${escapeHtml(inventoryStateLabel(target.configuration?.state))}</span></article>`).join("");
    return `<section class="venue-inventory-summary"><div class="section-heading"><div><span class="eyebrow">Inventario corrente</span><h3>${targets.length} entità nella sede</h3><p>L’inventario stabilisce quali Subject appartengono alla sede. La collocazione fisica resta nella sezione Spazi e mappa.</p></div><button class="button-secondary" type="button" data-venue-section="map">Apri Spazi e mappa ${icon("chevron", { size: 14 })}</button></div><dl class="venue-summary"><div><dt>Esposte</dt><dd>${counts.exposed}</dd></div><div><dt>Da collocare</dt><dd>${counts.unplaced}</dd></div><div><dt>Non disponibili</dt><dd>${counts.unavailable}</dd></div></dl>${sample ? `<div class="venue-inventory-summary-list">${sample}</div>` : `<div class="empty-state compact"><p>L’inventario è ancora vuoto.</p></div>`}${targets.length > sample.length ? `<p class="note">Sono mostrate le prime ${sample.length} entità. La gestione puntuale della collocazione resta nella mappa.</p>` : ""}</section>`;
  },

  renderInventoryProposals() {
    if (!this.data?.authoringPermissions?.canEditInventory) {
      return `<section class="venue-proposal-inbox"><div class="section-heading"><div><span class="eyebrow">Proposte</span><h3>Inbox non disponibile per il tuo ruolo</h3><p>Puoi consultare la sede, ma la decisione sulle proposte richiede il permesso di gestione dell’inventario.</p></div></div></section>`;
    }
    const results = this.inventoryProposals?.results || [];
    const filters = [
      ["pending", "In attesa"],
      ["accepted", "Accettate"],
      ["rejected", "Rifiutate"],
      ["withdrawn", "Ritirate"],
      ["all", "Tutte"],
    ].map(([value, label]) => `<button class="button-secondary small" type="button" data-inventory-proposal-status="${value}" aria-pressed="${(this.inventoryProposalStatus || "pending") === value}">${label}</button>`).join("");
    const cards = results.map((proposal) => this.renderInventoryProposalCard(proposal)).join("");
    return `<section class="venue-proposal-inbox"><div class="section-heading"><div><span class="eyebrow">Proposte di inventario</span><h3>Inbox della sede</h3><p>Qui arrivano i Subject proposti durante il lavoro editoriale. Accettare significa aggiungerli all’inventario, non collocarli sulla mappa.</p></div><span class="count">${results.length}</span></div><div class="venue-proposal-filters" role="group" aria-label="Filtra proposte">${filters}</div>${cards ? `<div class="venue-proposal-list">${cards}</div>` : `<div class="empty-state compact"><span>${icon("check", { size: 24 })}</span><h3>Nessuna proposta in questa vista</h3><p>${(this.inventoryProposalStatus || "pending") === "pending" ? "Non ci sono decisioni in attesa." : "Cambia filtro per consultare lo storico."}</p></div>`}</section>`;
  },

  renderInventorySection() {
    return `<section class="venue-section" id="venue-inventory"><div class="section-heading"><div><span class="eyebrow">Inventario</span><h2>Entità della sede e proposte</h2><p>Decidi quali Subject appartengono alla sede senza confondere questa scelta con slot, planimetrie o percorsi.</p></div></div>${this.renderInventoryProposals()}${this.renderInventorySummary()}</section>`;
  },
};
