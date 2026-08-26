import { navigate } from "../application/router.js";
import { readOperatingContext } from "../application/operating-context.js";
import { discoveryRepository } from "../infrastructure/http/discovery-repository.js";
import { icon } from "./icons.js";
import { marketplaceResourceLabel } from "./commercial-utils.js";
import { renderExploreNavigation } from "./explore-navigation.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundPublicOrganizationView extends HTMLElement {
  context = readOperatingContext();
  data = null;
  busy = false;
  error = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  organizationId() { return new URLSearchParams(window.location.search).get("organizationId"); }

  async load() {
    const organizationId = this.organizationId();
    if (!organizationId) { this.error = "Organizzazione non specificata"; this.render(); return; }
    this.busy = true;
    this.render();
    try { this.data = await discoveryRepository.organization(organizationId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Organizzazione non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back]")) { navigate("/organizations"); return; }
    const venue = target?.closest("[data-public-venue]");
    if (venue) { navigate(`/venues/public?venueId=${encodeURIComponent(venue.dataset.publicVenue)}`); return; }
    const listing = target?.closest("[data-listing]");
    if (listing) navigate(`/catalog/detail?listingId=${encodeURIComponent(listing.dataset.listing)}&returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  };

  render() {
    if (!this.data) {
      this.innerHTML = `<main class="page public-entity-page">${renderExploreNavigation("organizations")}<p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento organizzazione…")}</p></main>`;
      return;
    }
    const { organization, venues, publications } = this.data;
    const managesCurrent = this.context?.type === "organization" && String(this.context.id) === String(organization.id);
    const managementHref = `/organizations/detail?organizationId=${encodeURIComponent(organization.id)}`;
    this.innerHTML = `<main class="page public-entity-page" aria-busy="${this.busy}">${renderExploreNavigation("organizations")}<nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Organizzazioni</button><span>/</span><span>${escapeHtml(organization.name)}</span></nav><header class="public-entity-hero"><div><span class="eyebrow">Organizzazione</span><h1>${escapeHtml(organization.name)}</h1><p>${escapeHtml(organization.description || "Organizzazione culturale presente in ArtAround.")}</p></div>${managesCurrent ? `<div class="button-row"><a class="button-link" data-route href="/home">Apri home operativa</a><a class="button-link secondary" data-route href="${managementHref}">Gestisci organizzazione</a></div>` : ""}</header><section class="public-entity-section"><div class="section-heading"><div><span class="eyebrow">Luoghi</span><h2>Sedi</h2></div><span class="count">${venues.length}</span></div>${venues.length ? `<div class="discovery-grid">${venues.map((venue) => `<button class="discovery-card" type="button" data-public-venue="${escapeHtml(venue.id)}"><span class="resource-mark">${icon("museum", { size: 20 })}</span><span><strong>${escapeHtml(venue.name)}</strong><small>${escapeHtml(venue.description || "Sede culturale")}</small></span>${icon("chevron", { size: 15 })}</button>`).join("")}</div>` : `<div class="empty-state compact"><p>Nessuna sede pubblica disponibile.</p></div>`}</section><section class="public-entity-section"><div class="section-heading"><div><span class="eyebrow">Marketplace</span><h2>Pubblicazioni dell'organizzazione</h2><p>Risorse pubblicate da questa organizzazione, indipendentemente dalle sedi a cui possono essere pertinenti.</p></div><span class="count">${publications.length}</span></div>${publications.length ? `<div class="discovery-grid">${publications.map((entry) => `<button class="discovery-card" type="button" data-listing="${escapeHtml(entry.listingId)}"><span class="resource-mark">${icon(entry.resourceType.startsWith("visit") ? "route" : "book", { size: 20 })}</span><span><small>${escapeHtml(marketplaceResourceLabel(entry.resourceType))}</small><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.summary || "")}</small></span>${icon("chevron", { size: 15 })}</button>`).join("")}</div>` : `<div class="empty-state compact"><p>Nessuna pubblicazione Marketplace disponibile.</p></div>`}</section></main>`;
  }
}

customElements.define("artaround-public-organization-view", ArtAroundPublicOrganizationView);
