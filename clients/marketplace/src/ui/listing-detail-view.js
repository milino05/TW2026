import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatPrice, marketplaceResourceLabel } from "./commercial-utils.js";

const RIGHT_LABELS = Object.freeze({
  "content.consume": "Leggi e usa il contenuto",
  "content.use_in_editorial_release": "Inserisci il contenuto in una raccolta editoriale",
  "content.fork": "Crea una derivazione del contenuto",
  "context.generate": "Genera visite usando questa raccolta",
  "context.compose_visit": "Usa questa raccolta per comporre visite",
  "context.use_as_venue_primary": "Usa la raccolta come riferimento principale di una sede",
  "context.import_snapshot": "Importa una copia editoriale della raccolta",
  "namespace.author": "Crea contenuti con queste regole editoriali",
  "namespace.fork": "Crea regole editoriali derivate",
  "visit.execute": "Esegui questa visita nel Navigator",
  "visit.copy_detached": "Crea una copia indipendente della visita",
});
function params() { const values = new URLSearchParams(window.location.search); return { listingId: values.get("listingId"), selectedVenueIds: String(values.get("selectedVenueIds") || "").split(",").map((value) => value.trim()).filter(Boolean), returnTo: values.get("returnTo") || "/catalog" }; }
function rightLabel(use) { return RIGHT_LABELS[use?.capability] || use?.label || "Diritto di utilizzo"; }

export class ArtAroundListingDetailView extends HTMLElement {
  context = readOperatingContext(); detail = null; busy = false; error = null; message = null; pendingOfferId = null; acquisitionResult = null;
  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  beneficiary() { const principal = operatingPrincipal(this.context); return principal ? { type: principal.principalType, id: principal.principalId, name: this.context?.type === "organization" ? this.context.name : "Area personale" } : null; }

  async load() {
    const current = params(); const beneficiary = this.beneficiary();
    if (!current.listingId) { this.error = "Scheda del catalogo non specificata"; this.render(); return; }
    if (!beneficiary) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { this.detail = await marketplaceRepository.detail(current.listingId, { selectedVenueIds: current.selectedVenueIds, beneficiaryType: beneficiary.type, beneficiaryId: beneficiary.id }); }
    catch (error) { this.error = error instanceof Error ? error.message : "Dettaglio non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-back-catalog]")) { navigate(params().returnTo); return; }
    const start = target?.closest("button[data-start-acquisition]");
    if (start) { this.pendingOfferId = start.dataset.startAcquisition; this.message = null; this.acquisitionResult = null; this.render(); return; }
    if (target?.closest("button[data-cancel-acquisition]")) { this.pendingOfferId = null; this.render(); return; }
    if (target?.closest("button[data-confirm-acquisition]")) await this.acquirePendingOffer();
  };

  async acquirePendingOffer() {
    const offer = (this.detail?.offers || []).find((entry) => String(entry.id) === String(this.pendingOfferId));
    const beneficiary = this.beneficiary(); if (!offer || !beneficiary) return;
    this.busy = true; this.error = null; this.render();
    try {
      const result = await marketplaceRepository.acquire(offer.id, { beneficiaryType: beneficiary.type, beneficiaryId: beneficiary.id });
      this.acquisitionResult = result; this.pendingOfferId = null;
      this.message = result?.acquisition?.alreadyAcquired ? "Questa licenza era già disponibile in questa area." : "Licenza aggiunta alla libreria di questa area.";
      await this.load();
    } catch (error) { this.error = error instanceof Error ? error.message : "Acquisizione non riuscita"; }
    finally { this.busy = false; this.render(); }
  }

  renderScope() { const venues = this.detail?.asset?.physicalScope || []; if (!venues.length) return ""; return `<section class="consumer-detail-section"><div class="section-heading"><div><span class="eyebrow">Dove si svolge</span><h2>Sedi della visita</h2></div></div><div class="consumer-scope-list">${venues.map((venue) => `<span class="chip">${icon("museum", { size: 14 })}${escapeHtml(venue.name)}</span>`).join("")}</div></section>`; }
  renderRights(offer) { return `<ul class="rights-list">${(offer.uses || []).map((use) => `<li>${use.available ? icon("check", { size: 16 }) : icon("plus", { size: 16 })}<span><strong>${escapeHtml(rightLabel(use))}</strong>${use.available ? `<small>Già disponibile in questa area</small>` : ""}</span></li>`).join("")}</ul>`; }
  renderTechnicalOfferDetails(offer) { return `<details class="technical-details"><summary>Dettagli tecnici della licenza</summary><dl class="definition-list">${(offer.uses || []).map((use) => `<div><dt>${escapeHtml(rightLabel(use))}</dt><dd><code>${escapeHtml(use.capability)}</code> · <code>${escapeHtml(use.resourceType)}</code></dd></div>`).join("")}<div><dt>Aggiornamenti</dt><dd>${escapeHtml(offer.versionBehaviour?.label || "Non specificato")}</dd></div></dl></details>`; }

  renderConfirmation(offer) {
    if (String(this.pendingOfferId) !== String(offer.id)) return "";
    const paid = offer.pricing?.type === "paid";
    return `<div class="acquisition-confirmation" role="region" aria-label="Conferma licenza"><span class="eyebrow">Conferma</span><h3>${paid ? "Acquista questa licenza" : "Aggiungi questa licenza"}</h3><dl class="definition-list"><div><dt>Area</dt><dd>${escapeHtml(this.beneficiary()?.name || "Area corrente")}</dd></div><div><dt>Prezzo</dt><dd>${escapeHtml(formatPrice(offer.pricing))}</dd></div><div><dt>Aggiornamenti</dt><dd>${escapeHtml(offer.versionBehaviour?.label || "Non specificato")}</dd></div></dl><div><strong>Cosa otterrai</strong>${this.renderRights(offer)}</div>${paid ? `<p class="note">Pagamento simulato per la demo del corso: non viene effettuata una transazione reale.</p>` : `<p class="note">Questa offerta è gratuita.</p>`}<div class="button-row"><button type="button" data-confirm-acquisition ${this.busy ? "disabled" : ""}>${paid ? "Conferma acquisto" : "Conferma aggiunta"}</button><button class="button-secondary" type="button" data-cancel-acquisition ${this.busy ? "disabled" : ""}>Annulla</button></div></div>`;
  }

  renderOffer(offer) {
    const paid = offer.pricing?.type === "paid";
    const actionLabel = paid ? "Acquista licenza" : "Aggiungi alla libreria";
    return `<article class="consumer-offer-card"><header><div><span class="eyebrow">${escapeHtml(offer.label || "Offerta")}</span><h3>${escapeHtml(formatPrice(offer.pricing))}</h3></div>${offer.fullyAvailable ? `<span class="chip" data-tone="success">${icon("check", { size: 14 })} Già disponibile</span>` : ""}</header><div><strong>Cosa puoi fare</strong>${this.renderRights(offer)}</div><p class="consumer-version-note">${escapeHtml(offer.versionBehaviour?.label || "Condizioni di aggiornamento non specificate")}</p>${this.renderTechnicalOfferDetails(offer)}${offer.fullyAvailable ? `<p class="note">Questa offerta è già disponibile nella libreria dell'area corrente.</p>` : `<button type="button" data-start-acquisition="${escapeHtml(offer.id)}" ${this.busy ? "disabled" : ""}>${actionLabel}</button>`}${this.renderConfirmation(offer)}</article>`;
  }

  renderSuccess() {
    if (!this.message) return "";
    return `<section class="consumer-success" role="status"><div>${icon("check", { size: 20 })}<div><strong>${escapeHtml(this.message)}</strong><p>I diritti sono disponibili senza copiare o trasferire la proprietà della risorsa.</p></div></div><div class="button-row"><a class="button-link" data-route href="/workspace?ownership=licensed">Apri in Libreria</a><a class="button-link secondary" data-route href="/acquisitions">Vedi acquisizioni</a></div></section>`;
  }

  render() {
    if (this.busy && !this.detail) { this.innerHTML = `<main class="page consumer-detail"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento dettagli…</p></div></main>`; return; }
    if (!this.detail) { this.innerHTML = `<main class="page consumer-detail"><button class="back-button" type="button" data-back-catalog>${icon("arrowLeft", { size: 15 })} Catalogo</button><p role="alert">${escapeHtml(this.error || "Dettaglio non disponibile")}</p></main>`; return; }
    const asset = this.detail.asset || {};
    const offers = (this.detail.offers || []).map((offer) => this.renderOffer(offer)).join("");
    this.innerHTML = `<main class="page consumer-detail"><nav class="breadcrumb"><button type="button" data-back-catalog>${icon("arrowLeft", { size: 15 })} Catalogo</button><span>/</span><span>${escapeHtml(marketplaceResourceLabel(asset.type))}</span></nav><header class="consumer-detail__hero"><div><span class="chip">${escapeHtml(marketplaceResourceLabel(asset.type))}</span><h1>${escapeHtml(asset.title || "Risorsa")}</h1><p>${escapeHtml(asset.summary || "Nessuna descrizione disponibile.")}</p><p class="publisher">Pubblicato da <strong>${escapeHtml(asset.publisher?.name || "Autore")}</strong></p></div>${asset.editorialLicense ? `<div class="consumer-license-badge">${icon("shield", { size: 18 })}<span><small>Licenza editoriale</small><strong>${escapeHtml(asset.editorialLicense)}</strong></span></div>` : ""}</header>${this.renderSuccess()}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderScope()}<section class="consumer-detail-section"><div class="section-heading"><div><span class="eyebrow">Licenza</span><h2>Scegli cosa aggiungere</h2><p>Confronta i diritti inclusi e il prezzo. La licenza verrà assegnata all'area di lavoro corrente.</p></div></div><div class="consumer-offers">${offers || `<div class="empty-state"><h3>Nessuna offerta attiva</h3><p>Questa scheda è nel catalogo ma al momento non ha una licenza disponibile.</p></div>`}</div></section><details class="technical-details consumer-asset-details"><summary>Dettagli tecnici della risorsa</summary><dl class="definition-list"><div><dt>Tipo</dt><dd><code>${escapeHtml(asset.type || "")}</code></dd></div>${asset.version ? `<div><dt>Versione</dt><dd>${escapeHtml(asset.version)}</dd></div>` : ""}</dl></details></main>`;
  }
}
customElements.define("artaround-listing-detail-view", ArtAroundListingDetailView);
