import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatDate, formatPrice, marketplaceResourceLabel } from "./commercial-utils.js";

function readPage() { return Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1); }

export class ArtAroundAcquisitionHistoryView extends HTMLElement {
  context = readOperatingContext();
  history = null;
  page = readPage();
  busy = false;
  error = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  beneficiary() { const principal = operatingPrincipal(this.context); return principal ? { beneficiaryType: principal.principalType, beneficiaryId: principal.principalId } : null; }

  async load() {
    const beneficiary = this.beneficiary();
    if (!beneficiary) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.history = await marketplaceRepository.acquisitionHistory({ ...beneficiary, page: this.page }); }
    catch (error) { this.error = error instanceof Error ? error.message : "Licenze non disponibili"; }
    finally { this.busy = false; this.render(); }
  }

  syncUrl() {
    const url = new URL(window.location.href); url.search = "";
    if (this.page > 1) url.searchParams.set("page", String(this.page));
    window.history.replaceState({}, "", url);
  }

  onClick = async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-history-page]") : null;
    if (!button) return;
    this.page = Math.max(1, Number(button.dataset.historyPage) || 1); this.syncUrl(); await this.load(); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  renderCurrentRights(entry) {
    const rights = entry.currentRights || [];
    if (!rights.length) return `<div class="license-rights-empty"><span class="chip" data-tone="warning">Nessun diritto corrente</span><p>Lo storico dell'acquisizione resta disponibile, ma non risultano diritti applicativi collegati.</p></div>`;
    return `<ul class="rights-list">${rights.map((right) => `<li>${right.active ? icon("check", { size: 16 }) : icon("warning", { size: 16 })}<span><strong>${escapeHtml(right.label)}</strong><small>${escapeHtml(right.versionBehaviour?.label || "Versione non specificata")} · ${right.active ? "attivo" : "non attivo"}</small></span></li>`).join("")}</ul>`;
  }

  renderTechnical(entry) {
    return `<details class="technical-details"><summary>Dettagli tecnici dell'acquisizione</summary><dl class="definition-list"><div><dt>Acquisition ID</dt><dd><code>${escapeHtml(entry.id)}</code></dd></div><div><dt>Listing</dt><dd><code>${escapeHtml(entry.listingId)}</code></dd></div><div><dt>Offerta</dt><dd><code>${escapeHtml(entry.offerId)}</code></dd></div></dl><h4>Grant acquisiti</h4><ul class="technical-grants">${(entry.grants || []).map((grant) => `<li><strong>${escapeHtml(grant.label)}</strong><br><code>${escapeHtml(grant.capability)}</code> · <code>${escapeHtml(grant.resourceType)}</code>${grant.resolvedSnapshotRef ? `<br><small>Snapshot: <code>${escapeHtml(grant.resolvedSnapshotRef.resourceType)}</code></small>` : ""}</li>`).join("")}</ul></details>`;
  }

  renderCard(entry) {
    const listingWithdrawn = entry.listingStatus !== "published";
    return `<article class="license-card"><header><div><span class="chip">${escapeHtml(marketplaceResourceLabel(entry.asset?.type))}</span><h2>${escapeHtml(entry.asset?.title || "Risorsa")}</h2><p>${escapeHtml(entry.asset?.summary || "")}</p></div><div class="license-card__price"><strong>${escapeHtml(formatPrice(entry.pricing))}</strong><small>${escapeHtml(formatDate(entry.acquiredAt))}</small></div></header><div class="license-card__meta"><span>Pubblicato da <strong>${escapeHtml(entry.seller?.name || "Autore")}</strong></span>${entry.asset?.editorialLicense ? `<span>${icon("shield", { size: 14 })} ${escapeHtml(entry.asset.editorialLicense)}</span>` : ""}</div>${listingWithdrawn ? `<p class="license-notice">${icon("info", { size: 16 })} La scheda non è più nel Catalogo. I diritti già acquisiti restano separati dalla disponibilità commerciale.</p>` : ""}<section><span class="eyebrow">Cosa puoi fare adesso</span>${this.renderCurrentRights(entry)}</section>${this.renderTechnical(entry)}</article>`;
  }

  render() {
    const results = this.history?.results || [];
    const total = Number(this.history?.total) || 0;
    const pageSize = Number(this.history?.pageSize) || 20;
    const cards = results.map((entry) => this.renderCard(entry)).join("");
    const areaName = this.context?.type === "organization" ? this.context.name : "Area personale";
    this.innerHTML = `<main class="page licenses-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Marketplace · ${escapeHtml(areaName)}</span><h1>Acquisizioni e licenze</h1><p>Controlla ciò che è stato aggiunto o acquistato in questa area e i diritti disponibili adesso.</p></div></header><nav class="consumer-tabs" aria-label="Marketplace"><a data-route href="/acquisitions" aria-current="page">Acquisizioni</a><a data-route href="/workspace/commerce">Vendite</a></nav>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && !this.history ? `<div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Caricamento licenze…</p></div>` : results.length ? `<section class="license-list">${cards}</section>` : `<div class="empty-state"><span>${icon("shield", { size: 28 })}</span><h3>Nessuna acquisizione ancora</h3><p>Le risorse gratuite o acquistate per questa area compariranno qui.</p><a class="button-link" data-route href="/catalog">Esplora il catalogo</a></div>`}${total ? `<nav class="pagination" aria-label="Pagine delle licenze"><button type="button" data-history-page="${this.page - 1}" ${this.page <= 1 || this.busy ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${this.page}</span><button type="button" data-history-page="${this.page + 1}" ${this.page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>` : ""}</main>`;
  }
}
customElements.define("artaround-acquisition-history-view", ArtAroundAcquisitionHistoryView);
