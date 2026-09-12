import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { openOfferCreateDialog } from "./offer-create-dialog.js";
import { icon } from "./icons.js";
import { escapeHtml, formatDate, formatPrice, formatRevenue, hasOperation, marketplaceResourceLabel } from "./commercial-utils.js";

function selectedListingId() { return new URLSearchParams(window.location.search).get("listingId") || null; }
function listingStatusLabel(status, hasActiveOffer = false) { return status === "published" && hasActiveOffer ? "Nel catalogo" : "Privato"; }
function offerStatusLabel(status) { return status === "active" ? "Attiva" : "Ritirata"; }
function statusTone(status, activeValue) { return status === activeValue ? "success" : "warning"; }
function uniqueVersionLabels(grants = []) { return [...new Set(grants.map((grant) => grant.versionBehaviour?.label).filter(Boolean))]; }

export class ArtAroundCommerceManagementView extends HTMLElement {
  context = readOperatingContext();
  data = null;
  listingId = selectedListingId();
  page = Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1);
  busy = false;
  error = null;
  message = null;
  taskDialog = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }
  principal() { return operatingPrincipal(this.context); }
  financeVisible() { return this.data?.capabilities?.financeView !== false; }

  async load() {
    const principal = this.principal();
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try { this.data = await marketplaceRepository.commerce(principal, { page: this.page }); }
    catch (error) { this.error = error instanceof Error ? error.message : "Vendite non disponibili"; }
    finally {
      this.busy = false;
      this.render();
      if (this.listingId) requestAnimationFrame(() => this.querySelector(`#listing-${CSS.escape(String(this.listingId))}`)?.scrollIntoView({ block: "start" }));
    }
  }

  openOfferDialog(listingId) {
    if (this.taskDialog) return;
    const listing = this.data?.listings?.find((entry) => String(entry.id) === String(listingId));
    if (!listing) return;
    this.taskDialog = openOfferCreateDialog({
      listing,
      onDismiss: () => { this.taskDialog = null; },
      onCreated: () => {
        this.taskDialog = null;
        this.message = "Offerta pubblicata. La scheda è ora acquisibile con le condizioni che hai scelto.";
        void this.load();
      },
    });
  }

  async requestWithdrawal(type, id, label) {
    const subject = type === "offer" ? "l’offerta" : "la scheda nel catalogo";
    const confirmed = await openActionDialog({
      title: `Ritirare ${subject} “${label}”?`,
      message: "Non sarà più disponibile per nuove acquisizioni. Le acquisizioni già completate e i diritti già concessi resteranno validi.",
      confirmLabel: "Conferma ritiro",
      cancelLabel: "Annulla",
      tone: "danger",
    });
    if (!confirmed) return;
    await this.execute(
      () => type === "offer" ? marketplaceRepository.withdrawOffer(id) : marketplaceRepository.withdrawListing(id),
      type === "offer"
        ? "Offerta ritirata. Le acquisizioni già completate e i diritti già concessi restano validi."
        : "Scheda ritirata dal catalogo. Le acquisizioni già completate e i diritti già concessi restano validi.",
    );
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const create = target?.closest("button[data-create-offer-dialog]");
    if (create) { this.openOfferDialog(create.dataset.createOfferDialog); return; }
    const request = target?.closest("button[data-withdraw]");
    if (request) {
      await this.requestWithdrawal(request.dataset.withdraw, request.dataset.id, request.dataset.label || "");
      return;
    }
    const pageButton = target?.closest("button[data-commerce-page]");
    if (pageButton) {
      const page = Math.max(1, Number(pageButton.dataset.commercePage) || 1);
      navigate(`/workspace/commerce?page=${page}`);
    }
  };

  async execute(callback, successMessage) {
    this.busy = true;
    this.error = null;
    this.render();
    try { await callback(); this.message = successMessage; await this.load(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Operazione commerciale non riuscita"; this.busy = false; this.render(); }
  }

  renderOffer(offer) {
    const rights = (offer.grants || []).map((grant) => `<li>${icon("check", { size: 14 })}<span><strong>${escapeHtml(grant.label)}</strong>${grant.versionBehaviour?.label ? `<small>${escapeHtml(grant.versionBehaviour.label)}</small>` : ""}</span></li>`).join("");
    const versionLabels = uniqueVersionLabels(offer.grants || []);
    const technicalRights = (offer.grants || []).map((grant) => `<li><code>${escapeHtml(grant.capability)}</code> · <code>${escapeHtml(grant.versionPolicy)}</code> · ${escapeHtml(grant.resourceType)}</li>`).join("");
    const revenueMetric = this.financeVisible() ? `<div><dt>Ricavi simulati</dt><dd>${escapeHtml(formatRevenue(offer.revenueByCurrency))}</dd></div>` : "";
    return `<article class="seller-offer" data-status="${escapeHtml(offer.status)}"><header class="seller-offer__header"><div><span class="chip" data-tone="${statusTone(offer.status, "active")}">${escapeHtml(offerStatusLabel(offer.status))}</span><h3>${escapeHtml(offer.label)}</h3></div><strong class="seller-offer__price">${escapeHtml(formatPrice(offer.pricing))}</strong></header><div><span class="eyebrow">Cosa ottiene chi acquisisce</span><ul class="rights-list">${rights}</ul></div>${versionLabels.length ? `<p class="seller-version-summary">${icon("history", { size: 15 })}<span><strong>Aggiornamenti inclusi</strong><small>${escapeHtml(versionLabels.join(" · "))}</small></span></p>` : ""}<dl class="seller-offer-metrics"><div><dt>Acquisizioni</dt><dd>${offer.acquisitionCount}</dd></div>${revenueMetric}</dl><details class="technical-details seller-technical"><summary>Dettagli tecnici dell’offerta</summary><dl class="definition-list"><div><dt>Offer ID</dt><dd><code>${escapeHtml(offer.id)}</code></dd></div><div><dt>Diritti</dt><dd><ul class="technical-grants">${technicalRights || "<li>Nessun grant</li>"}</ul></dd></div></dl></details><footer class="seller-offer__footer"><small>Creata ${escapeHtml(formatDate(offer.createdAt))}</small>${hasOperation(offer.availableOperations, "withdraw_offer") ? `<button class="danger small" type="button" data-withdraw="offer" data-id="${escapeHtml(offer.id)}" data-label="${escapeHtml(offer.label)}">Ritira offerta</button>` : ""}</footer></article>`;
  }

  renderOfferAction(listing) {
    return `<button type="button" data-create-offer-dialog="${escapeHtml(listing.id)}">${icon("plus", { size: 16 })} Nuova offerta</button>`;
  }

  renderListing(listing) {
    const offers = listing.offers || [];
    const activeOffers = offers.filter((offer) => offer.status === "active");
    const hasActiveOffer = activeOffers.length > 0;
    const isPublic = listing.status === "published" && hasActiveOffer;
    const renderedOffers = activeOffers.map((offer) => this.renderOffer(offer)).join("");
    const canCreateOffer = hasOperation(listing.availableOperations, "create_offer");
    const publishedDate = isPublic && listing.publishedAt ? `Pubblicata ${formatDate(listing.publishedAt)}` : "Contenuto privato";
    const visibilityNotice = !isPublic ? `<div class="seller-visibility-notice"><strong>Contenuto privato</strong><p>Formula e pubblica almeno un’offerta: la scheda verrà pubblicata automaticamente insieme all’offerta.</p></div>` : "";
    const revenueMetric = this.financeVisible() ? `<div><dt>Ricavi simulati</dt><dd>${escapeHtml(formatRevenue(listing.metrics.revenueByCurrency))}</dd></div>` : "";
    return `<article class="seller-listing" id="listing-${escapeHtml(listing.id)}"><header class="seller-listing__header"><div><div class="chip-row"><span class="chip">${escapeHtml(marketplaceResourceLabel(listing.asset.type))}</span><span class="chip" data-tone="${isPublic ? "success" : "warning"}">${escapeHtml(listingStatusLabel(listing.status, hasActiveOffer))}</span>${listing.asset.editorialLicense ? `<span class="chip">${icon("shield", { size: 13 })}${escapeHtml(listing.asset.editorialLicense)}</span>` : ""}</div><h2>${escapeHtml(listing.asset.title)}</h2><p>${escapeHtml(listing.asset.summary || "Nessuna descrizione disponibile.")}</p></div><dl class="seller-listing-metrics"><div><dt>Acquisizioni</dt><dd>${listing.metrics.acquisitionCount}</dd></div>${revenueMetric}</dl></header>${visibilityNotice}<div class="seller-listing__section-heading"><div><span class="eyebrow">Offerte</span><h3>${activeOffers.length ? `${activeOffers.length} ${activeOffers.length === 1 ? "offerta" : "offerte"}` : "Nessuna offerta"}</h3></div>${canCreateOffer ? this.renderOfferAction(listing) : ""}</div>${renderedOffers ? `<div class="seller-offer-grid">${renderedOffers}</div>` : `<div class="empty-state seller-offer-empty"><h3>Completa la pubblicazione</h3><p>Definisci prezzo, diritti e gestione degli aggiornamenti nell’offerta.</p>${canCreateOffer ? this.renderOfferAction(listing) : ""}</div>`}<details class="technical-details seller-listing-technical"><summary>Dettagli tecnici della scheda</summary><dl class="definition-list"><div><dt>Listing ID</dt><dd><code>${escapeHtml(listing.id)}</code></dd></div><div><dt>Resource type</dt><dd><code>${escapeHtml(listing.asset.type)}</code></dd></div></dl></details><footer class="seller-listing__footer"><small>${escapeHtml(publishedDate)}</small>${hasOperation(listing.availableOperations, "withdraw_listing") ? `<button class="danger" type="button" data-withdraw="listing" data-id="${escapeHtml(listing.id)}" data-label="${escapeHtml(listing.asset.title)}">${listing.status === "draft" ? "Annulla preparazione" : "Ritira scheda dal catalogo"}</button>` : ""}</footer></article>`;
  }

  renderDistribution() {
    const distribution = this.data?.distribution;
    const summary = distribution?.summary;
    if (!summary) return "";
    const recentSales = (distribution.recentSales || []).map((sale) => `<li><div><strong>${escapeHtml(sale.asset?.title || "Risorsa del Marketplace")}</strong><small>Acquisita da ${escapeHtml(sale.buyer?.name || "Persona")} · ${escapeHtml(formatDate(sale.acquiredAt))}</small></div>${this.financeVisible() ? `<span>${escapeHtml(formatPrice(sale.pricing))}</span>` : ""}</li>`).join("");
    const recentAdoptions = (distribution.recentAdoptions || []).map((adoption) => `<li><div><strong>${escapeHtml(adoption.actionLabel || "Risorsa riutilizzata")}</strong><small>${escapeHtml(adoption.beneficiary?.name || "Destinatario")} · ${escapeHtml(formatDate(adoption.adoptedAt))}</small></div><span class="chip">Adozione</span></li>`).join("");
    const revenueStat = this.financeVisible() ? `<div><dt>Ricavi simulati</dt><dd>${escapeHtml(formatRevenue(summary.revenueByCurrency))}</dd></div>` : "";
    const financeDetails = this.financeVisible() ? `<div><dt>Acquisizioni a pagamento</dt><dd>${summary.paidSalesCount}</dd></div><div><dt>Acquisizioni gratuite</dt><dd>${summary.freeAcquisitionCount}</dd></div>` : "";
    return `<section class="seller-overview" aria-labelledby="seller-overview-title"><div class="section-heading"><div><span class="eyebrow">Panoramica</span><h2 id="seller-overview-title">Come stanno andando le risorse</h2></div></div><dl class="seller-stats"><div><dt>Schede nel catalogo</dt><dd>${summary.publishedListingCount}</dd></div><div><dt>Offerte attive</dt><dd>${summary.activeOfferCount}</dd></div><div><dt>Acquisizioni</dt><dd>${summary.salesCount}</dd></div><div><dt>Adozioni</dt><dd>${summary.adoptionCount}</dd></div>${revenueStat}</dl><details class="seller-activity" ${(distribution.recentSales || []).length || (distribution.recentAdoptions || []).length ? "open" : ""}><summary>Attività recente</summary><div class="seller-activity-grid"><article><h3>Acquisizioni recenti</h3><ul class="commercial-activity">${recentSales || "<li><span>Nessuna acquisizione recente.</span></li>"}</ul></article><article><h3>Adozioni recenti</h3><ul class="commercial-activity">${recentAdoptions || "<li><span>Nessuna adozione recente.</span></li>"}</ul></article></div><details class="technical-details"><summary>Metriche dettagliate</summary><dl class="definition-list">${financeDetails}<div><dt>Acquirenti distinti</dt><dd>${summary.uniqueBuyers}</dd></div><div><dt>Utilizzatori distinti</dt><dd>${summary.uniqueAdopters}</dd></div></dl></details></details></section>`;
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page seller-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:15rem"></div><p>Preparazione delle vendite…</p></div></main>`; return; }
    const listings = (this.data?.listings || []).map((listing) => this.renderListing(listing)).join("");
    const page = Number(this.data?.page) || this.page;
    const pageSize = Number(this.data?.pageSize) || 10;
    const total = Number(this.data?.total) || 0;
    const areaName = this.context?.type === "organization" ? this.context.name : "Area personale";
    this.innerHTML = `<main class="page seller-page" aria-busy="${this.busy}"><nav class="consumer-tabs" aria-label="Marketplace"><a data-route href="/acquisitions">Acquisizioni</a><a data-route href="/workspace/commerce" aria-current="page">Vendite</a></nav><header class="seller-header"><div><span class="eyebrow">Marketplace · ${escapeHtml(areaName)}</span><h1>Vendite</h1><p>Configura le offerte, pubblica le risorse nel Catalogo e controlla acquisizioni e adozioni di questa area.</p></div><a class="button-link secondary" data-route href="/workspace">${icon("workspace", { size: 16 })} Libreria</a></header>${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderDistribution()}<section class="seller-listings" aria-labelledby="seller-listings-title"><div class="section-heading"><div><span class="eyebrow">Marketplace</span><h2 id="seller-listings-title">Pubblicazioni e offerte</h2><p>Una risorsa appare nel Catalogo solo dopo la pubblicazione di almeno un’offerta.</p></div><span class="count">${total}</span></div>${listings || `<div class="empty-state"><span>${icon("store", { size: 28 })}</span><h3>Nessuna pubblicazione preparata</h3><p>Apri una risorsa editoriale pubblicata e scegli “Configura offerta e pubblica” per iniziare.</p><a class="button-link" data-route href="/workspace">Vai alla libreria</a></div>`}${total > pageSize ? `<nav class="pagination" aria-label="Pagine delle pubblicazioni Marketplace"><button type="button" data-commerce-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${page}</span><button type="button" data-commerce-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>` : ""}</section></main>`;
  }
}
customElements.define("artaround-commerce-management-view", ArtAroundCommerceManagementView);
