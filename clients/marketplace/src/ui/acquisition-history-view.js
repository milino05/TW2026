import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatDate, formatPrice, principalOptions, principalValue } from "./commercial-utils.js";

export class ArtAroundAcquisitionHistoryView extends HTMLElement {
  workspace = null;
  history = null;
  principal = "";
  page = 1;
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.loadInitial();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
  }

  async loadInitial() {
    this.busy = true;
    this.render();
    try {
      this.workspace = await marketplaceRepository.workspace();
      const params = new URLSearchParams(window.location.search);
      const requested = `${params.get("beneficiaryType") || ""}:${params.get("beneficiaryId") || ""}`;
      const available = new Set((this.workspace.availablePrincipals || []).map(principalValue));
      this.principal = available.has(requested) ? requested : principalValue(this.workspace.principal);
      await this.loadHistory();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Storico acquisizioni non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async loadHistory() {
    const [beneficiaryType, beneficiaryId] = this.principal.split(":");
    this.history = await marketplaceRepository.acquisitionHistory({ page: this.page, beneficiaryType, beneficiaryId });
    const url = new URL(window.location.href);
    url.searchParams.set("beneficiaryType", beneficiaryType);
    url.searchParams.set("beneficiaryId", beneficiaryId);
    window.history.replaceState({}, "", url);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-history-principal]")) return;
    event.preventDefault();
    this.principal = String(new FormData(form).get("principal") || this.principal);
    this.page = 1;
    await this.refresh();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const pageButton = target?.closest("button[data-history-page]");
    if (!pageButton) return;
    this.page = Math.max(1, Number(pageButton.dataset.historyPage) || 1);
    await this.refresh();
  };

  async refresh() {
    this.busy = true;
    this.error = null;
    this.render();
    try { await this.loadHistory(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aggiornare lo storico"; }
    finally { this.busy = false; this.render(); }
  }

  renderEntry(entry) {
    const grants = (entry.grants || []).map((grant) => `<li><span>${icon("check", { size: 15 })}</span><div><strong>${escapeHtml(grant.label || grant.capability)}</strong><small>${escapeHtml(grant.versionBehaviour?.label || grant.versionPolicy)}</small></div></li>`).join("");
    return `<article class="acquisition-card"><header><div><span class="eyebrow">${escapeHtml(entry.asset?.type || "Asset")}</span><h2>${escapeHtml(entry.asset?.title || "Asset non disponibile")}</h2><p>Di ${escapeHtml(entry.seller?.name || "Publisher")} · ${escapeHtml(formatDate(entry.acquiredAt))}</p></div><strong class="acquisition-price">${escapeHtml(formatPrice(entry.pricing))}</strong></header><div class="chip-row"><span class="chip">${icon("tag", { size: 13 })}${escapeHtml(entry.offer?.label || "Offerta")}</span><span class="chip">${icon("shield", { size: 13 })}${escapeHtml(entry.asset?.editorialLicense || "Licenza non indicata")}</span></div><ul class="rights-list">${grants}</ul><footer><span>Acquisition ID</span><code>${escapeHtml(entry.id)}</code></footer></article>`;
  }

  render() {
    if (this.busy && !this.workspace) {
      this.innerHTML = `<main class="page commercial-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:15rem"></div><p>Caricamento licenze…</p></div></main>`;
      return;
    }
    const entries = (this.history?.results || []).map((entry) => this.renderEntry(entry)).join("");
    const page = Number(this.history?.page) || this.page;
    const pageSize = Number(this.history?.pageSize) || 20;
    const total = Number(this.history?.total) || 0;
    this.innerHTML = `<main class="page commercial-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Diritti acquisiti</span><h1>Acquisizioni e licenze</h1><p>Consulta termini economici, licenza editoriale e capability assegnate a ogni principal.</p></div><a class="button-link secondary" data-route href="/catalog">${icon("catalog")} Esplora il catalogo</a></header>${this.workspace ? `<form class="principal surface" data-history-principal><label><span>Mostra lo storico di</span><select name="principal">${principalOptions(this.workspace.availablePrincipals || [], this.principal)}</select></label><button type="submit" ${this.busy ? "disabled" : ""}>Aggiorna</button></form>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="history-section"><div class="results-toolbar"><div><span class="eyebrow">Storico immutabile</span><strong>${total} acquisizioni</strong></div><span class="muted">Pagina ${page}</span></div><div class="acquisition-list">${entries || `<div class="empty-state"><span>${icon("history", { size: 28 })}</span><h3>Nessuna acquisizione</h3><p>Le offerte aggiunte o acquistate compariranno qui.</p></div>`}</div><nav class="pagination" aria-label="Pagine storico"><button type="button" data-history-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}</span><button type="button" data-history-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav></section></main>`;
  }
}

customElements.define("artaround-acquisition-history-view", ArtAroundAcquisitionHistoryView);
