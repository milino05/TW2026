import { navigate } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatPrice, principalOptions, principalValue } from "./commercial-utils.js";

function queryValues() {
  const params = new URLSearchParams(window.location.search);
  return {
    listingId: params.get("listingId") || "",
    selectedVenueIds: String(params.get("selectedVenueIds") || "").split(",").filter(Boolean),
  };
}

export class ArtAroundListingDetailView extends HTMLElement {
  detail = null;
  workspace = null;
  busy = false;
  error = null;
  message = null;
  pendingOfferId = null;
  beneficiary = "";
  query = queryValues();

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
  }

  async load() {
    if (!this.query.listingId) {
      this.error = "Listing non specificata.";
      this.render();
      return;
    }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const [detail, workspace] = await Promise.all([
        marketplaceRepository.detail(this.query.listingId, { selectedVenueIds: this.query.selectedVenueIds }),
        marketplaceRepository.workspace(),
      ]);
      this.detail = detail;
      this.workspace = workspace;
      if (!this.beneficiary) this.beneficiary = principalValue(workspace.principal);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Dettaglio Marketplace non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-catalog]")) {
      const params = new URLSearchParams();
      if (this.query.selectedVenueIds.length) params.set("selectedVenueIds", this.query.selectedVenueIds.join(","));
      navigate(`/catalog${params.toString() ? `?${params.toString()}` : ""}`);
      return;
    }
    const start = target?.closest("button[data-start-acquisition]");
    if (start) {
      this.beneficiary = this.querySelector("select[data-beneficiary]")?.value || this.beneficiary;
      this.pendingOfferId = start.dataset.startAcquisition;
      this.message = null;
      this.render();
      return;
    }
    if (target?.closest("button[data-cancel-acquisition]")) {
      this.pendingOfferId = null;
      this.render();
      return;
    }
    if (target?.closest("button[data-confirm-acquisition]")) await this.acquirePendingOffer();
  };

  async acquirePendingOffer() {
    if (!this.pendingOfferId) return;
    const [beneficiaryType, beneficiaryId] = this.beneficiary.split(":");
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const result = await marketplaceRepository.acquire(this.pendingOfferId, { beneficiaryType, beneficiaryId });
      this.message = result.acquisition?.alreadyAcquired
        ? "Questa offerta era già stata acquisita dal principal selezionato."
        : "Acquisizione completata: i diritti sono ora disponibili nel Workspace.";
      this.pendingOfferId = null;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Acquisizione non riuscita";
      this.busy = false;
      this.render();
    }
  }

  renderOffer(offer) {
    const grants = (offer.uses || []).map((use) => `<li>${icon("check", { size: 15 })}<span>${escapeHtml(use.label)}<small>${escapeHtml(use.capability)}</small></span></li>`).join("");
    const pending = this.pendingOfferId === String(offer.id);
    return `<article class="commercial-offer-card">
      <header><div><span class="eyebrow">${escapeHtml(offer.label || "Offerta")}</span><h2>${escapeHtml(formatPrice(offer.pricing))}</h2></div><span class="chip">${icon("tag", { size: 14 })}${escapeHtml(offer.versionBehaviour?.label || "Versione definita")}</span></header>
      <ul class="rights-list">${grants}</ul>
      ${pending ? `<div class="confirmation-panel" role="alert"><div><strong>Conferma acquisizione</strong><p>I diritti saranno assegnati al principal selezionato. Il pagamento è simulato e non viene effettuata alcuna transazione bancaria.</p></div><div class="button-row"><button type="button" data-confirm-acquisition ${this.busy ? "disabled" : ""}>Conferma ${escapeHtml(formatPrice(offer.pricing))}</button><button class="button-secondary" type="button" data-cancel-acquisition>Annulla</button></div></div>` : `<button type="button" data-start-acquisition="${escapeHtml(offer.id)}" ${this.busy ? "disabled" : ""}>${offer.pricing?.type === "paid" ? "Acquisisci licenza" : "Aggiungi al Workspace"}</button>`}
    </article>`;
  }

  render() {
    if (this.busy && !this.detail) {
      this.innerHTML = `<main class="page commercial-page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento dettaglio…</p></div></main>`;
      return;
    }
    if (this.error && !this.detail) {
      this.innerHTML = `<main class="page"><button class="back-button" data-back-catalog>${icon("arrowLeft")} Catalogo</button><p role="alert">${escapeHtml(this.error)}</p></main>`;
      return;
    }
    const asset = this.detail?.asset || {};
    const offers = (this.detail?.offers || []).map((offer) => this.renderOffer(offer)).join("");
    const physicalScope = (asset.physicalScope || []).map((venue) => `<span class="chip">${icon("museum", { size: 14 })}${escapeHtml(venue.name)}</span>`).join("");
    const selectedPrincipal = this.beneficiary || principalValue(this.workspace?.principal);
    this.innerHTML = `<main class="page commercial-page" aria-busy="${this.busy}">
      <nav class="breadcrumb"><button type="button" data-back-catalog>${icon("arrowLeft", { size: 15 })} Catalogo</button><span>/</span><span>Dettaglio</span></nav>
      <section class="commercial-hero"><div><span class="eyebrow">${escapeHtml(asset.type || "Asset Marketplace")}</span><h1>${escapeHtml(asset.title || "Dettaglio Marketplace")}</h1><p>${escapeHtml(asset.summary || "Nessuna descrizione disponibile.")}</p><div class="chip-row"><span class="chip">Di ${escapeHtml(asset.publisher?.name || "Publisher")}</span>${asset.version ? `<span class="chip">Versione ${escapeHtml(asset.version)}</span>` : ""}${physicalScope}</div></div><div class="commercial-hero__mark">${icon("store", { size: 34 })}</div></section>
      ${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      <div class="commercial-detail-grid"><aside class="commercial-side-panel panel"><span class="eyebrow">Licenza e assegnazione</span><h2>Termini del contenuto</h2><dl class="definition-list"><div><dt>Licenza editoriale</dt><dd>${escapeHtml(asset.editorialLicense || "Non indicata")}</dd></div><div><dt>Grant Marketplace</dt><dd>Definiti separatamente per ogni offerta</dd></div></dl><p class="note">La licenza descrive copyright e riuso editoriale; i grant stabiliscono le operazioni abilitate nell’applicazione.</p><label>Acquisisci per<select data-beneficiary ${this.busy ? "disabled" : ""}>${principalOptions(this.workspace?.availablePrincipals || [], selectedPrincipal)}</select></label><a class="button-link secondary" data-route href="/acquisitions">Consulta acquisizioni e licenze</a></aside>
      <section class="commercial-offers"><div class="section-heading"><div><span class="eyebrow">Offerte disponibili</span><h2>Scegli i diritti necessari</h2></div><span class="count">${this.detail?.offers?.length || 0}</span></div>${offers || `<div class="empty-state"><h3>Nessuna offerta attiva</h3><p>La scheda resta consultabile, ma al momento non è possibile acquisirla.</p></div>`}</section></div>
    </main>`;
  }
}

customElements.define("artaround-listing-detail-view", ArtAroundListingDetailView);
