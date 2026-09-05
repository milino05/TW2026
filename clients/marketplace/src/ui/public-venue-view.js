import { navigate } from "../application/router.js";
import { readOperatingContext } from "../application/operating-context.js";
import { discoveryRepository } from "../infrastructure/http/discovery-repository.js";
import { icon } from "./icons.js";
import { renderExploreNavigation } from "./explore-navigation.js";
import "./venue-map.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundPublicVenueView extends HTMLElement {
  context = readOperatingContext();
  data = null;
  busy = false;
  error = null;
  focusedTargetId = new URLSearchParams(window.location.search).get("focusTargetId") || "";

  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  venueId() { return new URLSearchParams(window.location.search).get("venueId"); }

  async load() {
    const venueId = this.venueId();
    if (!venueId) { this.error = "Sede non specificata"; this.render(); return; }
    this.busy = true;
    this.render();
    try { this.data = await discoveryRepository.venue(venueId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Sede non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  syncMap() {
    const map = this.querySelector("artaround-venue-map");
    if (!map || !this.data?.map) return;
    map.data = { map: this.data.map, targets: this.data.targets || [] };
    map.focusTargetId = this.focusedTargetId;
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back]")) { navigate("/venues"); return; }
    if (target?.closest("[data-organization]")) { navigate(`/organizations/public?organizationId=${encodeURIComponent(this.data.organization.id)}`); return; }
    const focus = target?.closest("button[data-focus-target]");
    if (focus) {
      this.focusedTargetId = focus.dataset.focusTarget || "";
      this.syncMap();
      this.querySelector("#venue-public-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  render() {
    if (!this.data) {
      this.innerHTML = `<main class="page public-entity-page">${renderExploreNavigation("venues")}<p role="${this.error ? "alert" : "status"}">${escapeHtml(this.error || "Caricamento sede…")}</p></main>`;
      return;
    }
    const { venue, organization, targets, map } = this.data;
    const manages = this.context?.type === "organization" && String(this.context.id) === String(organization.id);
    const catalogHref = `/catalog?selectedVenueIds=${encodeURIComponent(venue.id)}`;
    const preVisit = venue.preVisitInformation.length ? `<section class="public-entity-section"><div class="section-heading"><h2>Prima della visita</h2></div><ul class="public-info-list">${venue.preVisitInformation.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></section>` : "";
    const targetCards = targets.map((target) => `<article class="public-target-card" data-focused="${id(target.id) === id(this.focusedTargetId)}"><span class="resource-mark">${icon("museum", { size: 18 })}</span><div><strong>${escapeHtml(target.label)}</strong><p>${escapeHtml(target.description || "Entità della sede")}</p><button class="link-button" type="button" data-focus-target="${escapeHtml(id(target.id))}">${icon("pin", { size: 14 })} Mostra sulla mappa</button></div></article>`).join("");
    const inventory = targetCards ? `<div class="public-target-grid">${targetCards}</div>` : `<div class="empty-state compact"><p>Nessuna entità pubblica disponibile.</p></div>`;
    const publicMap = map?.floors?.length
      ? `<section class="public-entity-section" id="venue-public-map"><div class="section-heading"><div><span class="eyebrow">Mappa pubblicata</span><h2>Orientati nella sede</h2><p>La mappa usa esclusivamente la VenueRelease pubblicata. Se selezioni un’entità, ArtAround evidenzia il luogo in cui è esposta.</p></div></div><artaround-venue-map></artaround-venue-map></section>`
      : "";
    this.innerHTML = `<main class="page public-entity-page" aria-busy="${this.busy}">${renderExploreNavigation("venues")}<nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Musei e sedi</button><span>/</span><span>${escapeHtml(venue.name)}</span></nav><header class="public-entity-hero"><div><span class="eyebrow">Sede di <button class="link-button" type="button" data-organization>${escapeHtml(organization.name)}</button></span><h1>${escapeHtml(venue.name)}</h1><p>${escapeHtml(venue.description || "Sede culturale presente in ArtAround.")}</p></div><div class="button-row"><a class="button-link" data-route href="${catalogHref}">Esplora contenuti e visite</a>${manages ? `<a class="button-link secondary" data-route href="/venues/editor?venueId=${encodeURIComponent(venue.id)}">Gestisci sede</a>` : ""}</div></header>${preVisit}${publicMap}<section class="public-entity-section"><div class="section-heading"><div><span class="eyebrow">Entità della sede</span><h2>Cosa puoi trovare qui</h2><p>Entità fisiche pubblicate nella configurazione della sede. I contenuti editoriali restano separati e si trovano nel Catalogo.</p></div><span class="count">${targets.length}</span></div>${inventory}</section><section class="public-entity-section"><div class="context-box"><strong>Contenuti disponibili per questa sede</strong><p>Il Catalogo mostra tutte le risorse pertinenti alla sede, anche quando sono pubblicate da autori o organizzazioni differenti.</p><a class="button-link" data-route href="${catalogHref}">Apri il Catalogo filtrato</a></div></section></main>`;
    this.syncMap();
  }
}

customElements.define("artaround-public-venue-view", ArtAroundPublicVenueView);
