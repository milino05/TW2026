import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { beneficiaryOptions, escapeHtml, formatDate, formatPrice, marketplaceResourceLabel, principalValue } from "./commercial-utils.js";

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    beneficiaryType: params.get("beneficiaryType") || "user",
    beneficiaryId: params.get("beneficiaryId"),
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

export class ArtAroundAcquisitionHistoryView extends HTMLElement {
  history = null;
  beneficiaryType = "user";
  beneficiaryId = null;
  page = 1;
  busy = false;
  error = null;

  connectedCallback() {
    const initial = readParams();
    this.beneficiaryType = initial.beneficiaryType;
    this.beneficiaryId = initial.beneficiaryId;
    this.page = initial.page;
    this.addEventListener("change", this.onChange);
    this.addEventListener("click", this.onClick);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("click", this.onClick);
  }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.history = await marketplaceRepository.acquisitionHistory({
        beneficiaryType: this.beneficiaryType,
        beneficiaryId: this.beneficiaryId,
        page: this.page,
      });
      this.beneficiaryType = this.history.beneficiary?.type || "user";
      this.beneficiaryId = this.history.beneficiary?.id || null;
      this.syncUrl();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Licenze non disponibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  syncUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (this.beneficiaryType) url.searchParams.set("beneficiaryType", this.beneficiaryType);
    if (this.beneficiaryId) url.searchParams.set("beneficiaryId", this.beneficiaryId);
    if (this.page > 1) url.searchParams.set("page", String(this.page));
    window.history.replaceState({}, "", url);
  }

  onChange = async (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select?.matches("select[data-beneficiary]")) return;
    const [type, id] = select.value.split(":");
    this.beneficiaryType = type;
    this.beneficiaryId = id;
    this.page = 1;
    await this.load();
  };

  onClick = async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-history-page]") : null;
    if (!button) return;
    this.page = Math.max(1, Number(button.dataset.historyPage) || 1);
    await this.load();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    const beneficiaries = this.history?.availableBeneficiaries || [];
    const selectedValue = principalValue(this.history?.beneficiary || { type: this.beneficiaryType, id: this.beneficiaryId });
    const total = Number(this.history?.total) || 0;
    const pageSize = Number(this.history?.pageSize) || 20;
    const cards = results.map((entry) => this.renderCard(entry)).join("");

    this.innerHTML = `<main class="page licenses-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Licenze e vendite</span><h1>Le mie licenze</h1><p>Controlla ciò che hai aggiunto o acquistato e i diritti che sono disponibili adesso.</p></div></header><nav class="consumer-tabs" aria-label="Licenze e vendite"><a data-route href="/acquisitions" aria-current="page">Le mie licenze</a><a data-route href="/workspace/commerce">Vendite</a></nav>${beneficiaries.length ? `<label class="consumer-beneficiary license-beneficiary">Mostra le licenze di<select data-beneficiary>${beneficiaryOptions(beneficiaries, selectedValue)}</select></label>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && !this.history ? `<div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Caricamento licenze…</p></div>` : results.length ? `<section class="license-list">${cards}</section>` : `<div class="empty-state"><span>${icon("shield", { size: 28 })}</span><h3>Nessuna licenza ancora</h3><p>Le risorse gratuite o acquistate compariranno qui.</p><a class="button-link" data-route href="/catalog">Esplora il catalogo</a></div>`}${total ? `<nav class="pagination" aria-label="Pagine delle licenze"><button type="button" data-history-page="${this.page - 1}" ${this.page <= 1 || this.busy ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${this.page}</span><button type="button" data-history-page="${this.page + 1}" ${this.page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>` : ""}</main>`;
  }
}

customElements.define("artaround-acquisition-history-view", ArtAroundAcquisitionHistoryView);
