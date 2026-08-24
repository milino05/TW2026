import { navigate } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatDate, formatPrice, formatRevenue, hasOperation, principalOptions, principalValue } from "./commercial-utils.js";

function selectedPrincipal() {
  const params = new URLSearchParams(window.location.search);
  return {
    principalType: params.get("principalType") || "user",
    principalId: params.get("principalId") || null,
    listingId: params.get("listingId") || null,
  };
}

function priceInMinorUnits(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null;
}

export class ArtAroundCommerceManagementView extends HTMLElement {
  data = null;
  distribution = null;
  principal = selectedPrincipal();
  page = Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1);
  busy = false;
  error = null;
  message = null;
  confirmation = null;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
  }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const [data, distribution] = await Promise.all([
        marketplaceRepository.commerce(this.principal, { page: this.page }),
        marketplaceRepository.distribution(this.principal),
      ]);
      this.data = data;
      this.distribution = distribution;
      this.principal = { principalType: data.principal.type, principalId: String(data.principal.id), listingId: this.principal.listingId };
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Gestione commerciale non disponibile";
    } finally {
      this.busy = false;
      this.render();
      if (this.principal.listingId) requestAnimationFrame(() => {
        const expectedId = `listing-${this.principal.listingId}`;
        [...this.querySelectorAll(".managed-listing")].find((entry) => entry.id === expectedId)?.scrollIntoView({ block: "start" });
      });
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    if (form.matches("form[data-commerce-principal]")) {
      const [principalType, principalId] = String(formData.get("principal") || "").split(":");
      navigate(`/workspace/commerce?principalType=${encodeURIComponent(principalType)}&principalId=${encodeURIComponent(principalId)}`);
      return;
    }
    if (form.matches("form[data-create-offer]")) await this.createOffer(form, formData);
  };

  async createOffer(form, formData) {
    const listing = this.data?.listings?.find((entry) => String(entry.id) === String(form.dataset.createOffer));
    if (!listing) return;
    const capabilities = formData.getAll("capability").map(String).filter(Boolean);
    if (!capabilities.length) {
      this.error = "Seleziona almeno un diritto da concedere.";
      this.render();
      return;
    }
    const pricingType = String(formData.get("pricingType") || "free");
    let pricing = { type: "free" };
    if (pricingType === "paid") {
      const amountMinor = priceInMinorUnits(formData.get("amount"));
      const currency = String(formData.get("currency") || "EUR").trim().toUpperCase();
      if (amountMinor === null || amountMinor <= 0) {
        this.error = "Inserisci un prezzo maggiore di zero, con al massimo due decimali.";
        this.render();
        return;
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        this.error = "La valuta deve essere un codice ISO di tre lettere, ad esempio EUR.";
        this.render();
        return;
      }
      pricing = { type: "paid", amountMinor, currency };
    }
    const resource = listing.offerConfiguration.resourceRef;
    const versionPolicy = String(formData.get("versionPolicy") || "");
    const payload = {
      label: String(formData.get("label") || "").trim(),
      pricing,
      grants: capabilities.map((capability) => ({
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        capability,
        versionPolicy,
      })),
    };
    await this.execute(
      () => marketplaceRepository.createOffer(listing.id, payload),
      "Offerta pubblicata. È ora disponibile nel catalogo.",
    );
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-workspace-back]")) {
      navigate(`/workspace?principalType=${encodeURIComponent(this.principal.principalType)}&principalId=${encodeURIComponent(this.principal.principalId || "")}`);
      return;
    }
    const request = target?.closest("button[data-withdraw]");
    if (request) {
      this.confirmation = {
        type: request.dataset.withdraw,
        id: request.dataset.id,
        label: request.dataset.label,
      };
      this.message = null;
      this.render();
      return;
    }
    const pageButton = target?.closest("button[data-commerce-page]");
    if (pageButton) {
      const page = Math.max(1, Number(pageButton.dataset.commercePage) || 1);
      navigate(`/workspace/commerce?principalType=${encodeURIComponent(this.principal.principalType)}&principalId=${encodeURIComponent(this.principal.principalId || "")}&page=${page}`);
      return;
    }
    if (target?.closest("button[data-cancel-withdraw]")) {
      this.confirmation = null;
      this.render();
      return;
    }
    if (target?.closest("button[data-confirm-withdraw]")) await this.confirmWithdrawal();
  };

  async confirmWithdrawal() {
    if (!this.confirmation) return;
    const current = this.confirmation;
    this.confirmation = null;
    await this.execute(
      () => current.type === "offer" ? marketplaceRepository.withdrawOffer(current.id) : marketplaceRepository.withdrawListing(current.id),
      current.type === "offer" ? "Offerta ritirata. Le acquisizioni esistenti restano valide." : "Listing ritirata dal catalogo.",
    );
  }

  async execute(callback, successMessage) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await callback();
      this.message = successMessage;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione commerciale non riuscita";
      this.busy = false;
      this.render();
    }
  }

  renderConfirmation() {
    if (!this.confirmation) return "";
    const subject = this.confirmation.type === "offer" ? "l’offerta" : "la listing";
    return `<section class="confirmation-panel sticky-confirmation" role="alert"><div><strong>Ritirare ${subject} “${escapeHtml(this.confirmation.label)}”?</strong><p>Non sarà più acquisibile. Le Acquisition e gli Entitlement già creati non verranno modificati.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-withdraw ${this.busy ? "disabled" : ""}>Conferma ritiro</button><button class="button-secondary" type="button" data-cancel-withdraw>Annulla</button></div></section>`;
  }

  renderOffer(offer) {
    const rights = (offer.grants || []).map((grant) => `<li>${icon("check", { size: 14 })}<span>${escapeHtml(grant.label)}<small>${escapeHtml(grant.versionPolicy)}</small></span></li>`).join("");
    return `<article class="managed-offer" data-status="${escapeHtml(offer.status)}"><header><div><span class="chip" data-tone="${offer.status === "active" ? "success" : "warning"}">${escapeHtml(offer.status)}</span><h4>${escapeHtml(offer.label)}</h4></div><strong>${escapeHtml(formatPrice(offer.pricing))}</strong></header><ul class="rights-list">${rights}</ul><dl class="offer-metrics"><div><dt>Acquisizioni</dt><dd>${offer.acquisitionCount}</dd></div><div><dt>Ricavi simulati</dt><dd>${escapeHtml(formatRevenue(offer.revenueByCurrency))}</dd></div></dl><footer><small>Creata ${escapeHtml(formatDate(offer.createdAt))}</small>${hasOperation(offer.availableOperations, "withdraw_offer") ? `<button class="danger small" type="button" data-withdraw="offer" data-id="${escapeHtml(offer.id)}" data-label="${escapeHtml(offer.label)}">Ritira</button>` : ""}</footer></article>`;
  }

  renderOfferForm(listing) {
    const config = listing.offerConfiguration || {};
    const capabilities = (config.capabilityOptions || []).map((entry, index) => `<label class="capability-choice"><input type="checkbox" name="capability" value="${escapeHtml(entry.code)}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.code)}</small></span></label>`).join("");
    const policies = (config.versionPolicyOptions || []).map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`).join("");
    return `<details class="offer-creator"><summary>${icon("plus", { size: 16 })} Crea una nuova offerta</summary><form data-create-offer="${escapeHtml(listing.id)}"><div class="form-grid"><label class="wide">Nome dell’offerta<input name="label" required maxlength="120" placeholder="Es. Licenza visita completa"></label><label>Prezzo<select name="pricingType"><option value="free">Gratuita</option><option value="paid">A pagamento</option></select></label><label>Importo<input name="amount" inputmode="decimal" placeholder="4,99" aria-describedby="price-help-${escapeHtml(listing.id)}"><small id="price-help-${escapeHtml(listing.id)}">Ignorato per le offerte gratuite.</small></label><label>Valuta<input name="currency" value="${escapeHtml(config.defaultCurrency || "EUR")}" maxlength="3"></label><label>Comportamento versione<select name="versionPolicy" required>${policies}</select></label></div><fieldset class="capability-fieldset"><legend>Diritti concessi</legend>${capabilities}</fieldset><p class="note">Per cambiare prezzo in futuro, crea una nuova offerta e ritira quella precedente: lo storico resterà immutato.</p><button type="submit" ${this.busy ? "disabled" : ""}>${icon("store", { size: 16 })} Pubblica offerta</button></form></details>`;
  }

  renderListing(listing) {
    const offers = (listing.offers || []).map((offer) => this.renderOffer(offer)).join("");
    return `<section class="managed-listing" id="listing-${escapeHtml(listing.id)}"><header><div><div class="chip-row"><span class="chip">${escapeHtml(listing.asset.type)}</span><span class="chip" data-tone="${listing.status === "published" ? "success" : "warning"}">${escapeHtml(listing.status)}</span>${listing.asset.editorialLicense ? `<span class="chip">${icon("shield", { size: 13 })}${escapeHtml(listing.asset.editorialLicense)}</span>` : ""}</div><h2>${escapeHtml(listing.asset.title)}</h2><p>${escapeHtml(listing.asset.summary || "Nessuna descrizione")}</p></div><dl class="listing-metrics"><div><dt>Acquisizioni</dt><dd>${listing.metrics.acquisitionCount}</dd></div><div><dt>Ricavi</dt><dd>${escapeHtml(formatRevenue(listing.metrics.revenueByCurrency))}</dd></div></dl></header><div class="managed-offer-grid">${offers || `<div class="empty-state"><h3>Nessuna offerta</h3><p>Definisci prezzo e diritti per rendere acquisibile la listing.</p></div>`}</div>${hasOperation(listing.availableOperations, "create_offer") ? this.renderOfferForm(listing) : ""}<footer class="listing-footer"><small>Pubblicata ${escapeHtml(formatDate(listing.publishedAt))}</small>${hasOperation(listing.availableOperations, "withdraw_listing") ? `<button class="danger" type="button" data-withdraw="listing" data-id="${escapeHtml(listing.id)}" data-label="${escapeHtml(listing.asset.title)}">Ritira listing</button>` : ""}</footer></section>`;
  }

  renderDistribution() {
    const summary = this.distribution?.summary;
    if (!summary) return "";
    const listingById = new Map((this.data?.listings || []).map((listing) => [String(listing.id), listing]));
    const recentSales = (this.distribution.recentSales || []).map((sale) => {
      const listing = listingById.get(String(sale.listingId));
      return `<li><div><strong>${escapeHtml(listing?.asset?.title || "Asset Marketplace")}</strong><small>${escapeHtml(sale.buyer?.type || "buyer")} · ${escapeHtml(formatDate(sale.acquiredAt))}</small></div><span>${escapeHtml(formatPrice(sale.pricing))}</span></li>`;
    }).join("");
    const recentAdoptions = (this.distribution.recentAdoptions || []).map((adoption) => `<li><div><strong>${escapeHtml(adoption.action)}</strong><small>${escapeHtml(adoption.sourceResourceType)} · ${escapeHtml(formatDate(adoption.adoptedAt))}</small></div><span class="chip">Adozione</span></li>`).join("");
    return `<section class="distribution-overview"><div class="section-heading"><div><span class="eyebrow">Performance</span><h2>Vendite e adozioni</h2></div></div><dl class="stats"><div><dt>Listing pubblicate</dt><dd>${summary.publishedListingCount}</dd></div><div><dt>Offer attive</dt><dd>${summary.activeOfferCount}</dd></div><div><dt>Acquisizioni</dt><dd>${summary.salesCount}</dd></div><div><dt>Adozioni</dt><dd>${summary.adoptionCount}</dd></div><div><dt>Ricavi simulati</dt><dd>${escapeHtml(formatRevenue(summary.revenueByCurrency))}</dd></div></dl><div class="activity-grid"><article class="activity-panel"><h3>Acquisizioni recenti</h3><ul class="commercial-activity">${recentSales || "<li>Nessuna acquisizione.</li>"}</ul></article><article class="activity-panel"><h3>Adozioni recenti</h3><ul class="commercial-activity">${recentAdoptions || "<li>Nessuna adozione.</li>"}</ul></article></div></section>`;
  }

  render() {
    if (this.busy && !this.data) {
      this.innerHTML = `<main class="page commercial-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:15rem"></div><p>Caricamento distribuzione…</p></div></main>`;
      return;
    }
    const selected = principalValue({ type: this.principal.principalType, id: this.principal.principalId });
    const listings = (this.data?.listings || []).map((listing) => this.renderListing(listing)).join("");
    const page = Number(this.data?.page) || this.page;
    const pageSize = Number(this.data?.pageSize) || 10;
    const total = Number(this.data?.total) || 0;
    this.innerHTML = `<main class="page commercial-page commerce-page" aria-busy="${this.busy}"><nav class="breadcrumb"><button type="button" data-workspace-back>${icon("arrowLeft", { size: 15 })} Workspace</button><span>/</span><span>Gestione offerte</span></nav><header class="page-header"><div><span class="eyebrow">Distribuzione commerciale</span><h1>Listing e offerte</h1><p>Configura prezzi e diritti, monitora acquisizioni e adozioni senza alterare lo storico.</p></div><a class="button-link secondary" data-route href="/acquisitions">${icon("history")} Storico licenze</a></header>${this.data ? `<form class="principal surface" data-commerce-principal><label><span>Gestisci la distribuzione di</span><select name="principal">${principalOptions(this.data.availablePrincipals || [], selected)}</select></label><button type="submit">Cambia</button></form>` : ""}${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderConfirmation()}${this.renderDistribution()}<section class="listing-management"><div class="section-heading"><div><span class="eyebrow">Catalogo del seller</span><h2>Listing gestite</h2></div><span class="count">${total}</span></div>${listings || `<div class="empty-state"><span>${icon("store", { size: 28 })}</span><h3>Nessuna listing</h3><p>Pubblica un asset dal Workspace per iniziare a configurare le offerte.</p></div>`}<nav class="pagination" aria-label="Pagine listing"><button type="button" data-commerce-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}</span><button type="button" data-commerce-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav></section></main>`;
  }
}

customElements.define("artaround-commerce-management-view", ArtAroundCommerceManagementView);
