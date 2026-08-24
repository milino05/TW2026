import { currentRoute, navigate } from "../application/router.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import "./workspace-browser-view.js";
import "./workspace-view.js";
import "./item-authoring-view.js";
import "./visit-authoring-view.js";
import "./visit-logistics-editor.js";
import "./venue-target-chooser.js";
import "./context-release-composer.js";
import "./profile-view.js";
import "./organization-view.js";
import "./namespace-editor-view.js";
import "./venue-editor-view.js";
import "./listing-detail-view.js";
import "./acquisition-history-view.js";
import "./commerce-management-view.js";

const TITLES = {
  "/": "Catalogo", "/catalog": "Catalogo", "/catalog/detail": "Dettaglio risorsa", "/acquisitions": "Licenze", "/workspace": "Le mie risorse", "/workspace/resource": "Dettaglio risorsa", "/workspace/commerce": "Licenze e vendite",
  "/workspace/item-authoring": "Modifica contenuto", "/workspace/visit-authoring": "Modifica visita", "/workspace/venue-targets": "Oggetti della sede",
  "/workspace/context-compose": "Pubblica una nuova versione", "/profile": "Account e organizzazioni", "/organizations/detail": "Organizzazione",
  "/namespaces/editor": "Regole editoriali", "/venues/editor": "Sede e spazi fisici", "/404": "Pagina non trovata",
};
const RESOURCE_TYPES = [["", "Tutte le risorse"], ["visit", "Visite"], ["visit_revision", "Versioni delle visite"], ["item_edition", "Contenuti"], ["item_revision", "Versioni dei contenuti"], ["editorial_context", "Raccolte editoriali"], ["editorial_release", "Versioni pubblicate delle raccolte"], ["namespace", "Regole editoriali"], ["namespace_revision", "Versioni delle regole editoriali"]];
const RESOURCE_LABELS = Object.fromEntries(RESOURCE_TYPES.filter(([key]) => key));

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function initialVenueIds() { const selected = new URLSearchParams(window.location.search).get("selectedVenueIds"); return [...new Set(String(selected || "").split(",").map((value) => value.trim()).filter(Boolean))]; }
function formatPrice(pricing) { if (!pricing || pricing.type === "free") return "Gratis"; const amount = Number(pricing.amountMinor) / 100; try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: pricing.currency || "EUR" }).format(amount); } catch { return `${amount.toFixed(2)} ${pricing.currency || ""}`.trim(); } }
function current(route, paths) { return paths.includes(route) ? "page" : "false"; }

export class MarketplaceAppShell extends HTMLElement {
  user = null; authChecked = false; catalog = null; venueSelector = null; busy = false; error = null; menuOpen = false;
  selectedVenueIds = initialVenueIds(); catalogQuery = ""; catalogResourceType = ""; catalogPage = 1;

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); window.addEventListener("popstate", this.onRouteChanged); this.bootstrap(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); window.removeEventListener("popstate", this.onRouteChanged); }
  async bootstrap() { try { const response = await authRepository.me(); this.user = response.user; this.venueSelector = await marketplaceRepository.venueSelector(); await this.loadCatalogIfNeeded(); } catch { this.user = null; } finally { this.authChecked = true; this.render(); } }
  onRouteChanged = async () => { this.menuOpen = false; await this.loadCatalogIfNeeded(); this.render(); window.scrollTo({ top: 0, behavior: "auto" }); };
  async loadCatalogIfNeeded() { const route = currentRoute(); if (!this.user || !["/", "/catalog"].includes(route)) return; this.catalog = await marketplaceRepository.catalog({ selectedVenueIds: this.selectedVenueIds, page: this.catalogPage, q: this.catalogQuery, resourceTypes: this.catalogResourceType ? [this.catalogResourceType] : null }); }
  syncCatalogUrl() { if (!["/", "/catalog"].includes(currentRoute())) return; const url = new URL(window.location.href); if (this.selectedVenueIds.length) url.searchParams.set("selectedVenueIds", this.selectedVenueIds.join(",")); else url.searchParams.delete("selectedVenueIds"); window.history.replaceState({}, "", url); }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return;
    if (form.matches("form[data-login]")) { event.preventDefault(); const data = new FormData(form); this.busy = true; this.error = null; this.render(); try { const response = await authRepository.login(String(data.get("username") || ""), String(data.get("password") || "")); this.user = response.user; this.venueSelector = await marketplaceRepository.venueSelector(); await this.loadCatalogIfNeeded(); } catch (error) { this.error = error instanceof Error ? error.message : "Accesso non riuscito"; } finally { this.busy = false; this.render(); } return; }
    if (form.matches("form[data-catalog-filter]")) { event.preventDefault(); const data = new FormData(form); this.catalogQuery = String(data.get("q") || "").trim(); this.catalogResourceType = String(data.get("resourceType") || "").trim(); this.selectedVenueIds = [...new Set(data.getAll("selectedVenueIds").map(String).filter(Boolean))]; this.catalogPage = 1; this.syncCatalogUrl(); this.busy = true; this.error = null; this.render(); try { await this.loadCatalogIfNeeded(); } catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aggiornare il catalogo"; } finally { this.busy = false; this.render(); } }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-menu-toggle]")) { this.menuOpen = !this.menuOpen; this.render(); return; }
    const routeLink = target?.closest("a[data-route]"); if (routeLink) { event.preventDefault(); this.menuOpen = false; navigate(routeLink.getAttribute("href")); return; }
    const pageButton = target?.closest("button[data-page]"); if (pageButton && ["/", "/catalog"].includes(currentRoute())) { this.catalogPage = Math.max(1, Number(pageButton.dataset.page) || 1); this.busy = true; this.error = null; this.render(); try { await this.loadCatalogIfNeeded(); } catch (error) { this.error = error instanceof Error ? error.message : "Impossibile cambiare pagina"; } finally { this.busy = false; this.render(); } return; }
    const logoutButton = target?.closest("button[data-logout]"); if (logoutButton) { await authRepository.logout().catch(() => {}); this.user = null; this.catalog = null; this.menuOpen = false; this.render(); }
  };

  renderLogin() {
    return `<main class="login-page"><section class="login-visual"><span class="eyebrow">ArtAround creator tools</span><h1>Condividi cultura.<br>Costruisci esperienze.</h1><p>Un unico spazio per curare contenuti, progettare visite e gestire le sedi della tua organizzazione.</p><div class="login-features"><span>${icon("book")} Contenuti versionati</span><span>${icon("route")} Visite multi-sede</span><span>${icon("building")} Gestione organizzativa</span></div></section><section class="login-card"><span class="brand-mark" aria-hidden="true"></span><div><span class="eyebrow">Bentornato</span><h2>Accedi al Marketplace</h2><p>Usa le credenziali del tuo account ArtAround.</p></div><form data-login><label>Username <input name="username" autocomplete="username" placeholder="Il tuo username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required></label><button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Accesso in corso…" : "Accedi"}</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</section></main>`;
  }

  renderVenueSelector() {
    const selected = new Set(this.selectedVenueIds);
    const groups = (this.venueSelector?.organizations || []).map((organization) => `<fieldset><legend>${escapeHtml(organization.name)}</legend>${(organization.venues || []).map((venue) => `<div class="venue-row"><label class="venue-choice"><input type="checkbox" name="selectedVenueIds" value="${escapeHtml(venue.id)}" ${selected.has(String(venue.id)) ? "checked" : ""}><span><strong>${escapeHtml(venue.name)}</strong>${venue.description ? `<small>${escapeHtml(venue.description)}</small>` : ""}</span></label><a data-route href="/workspace/venue-targets?venueId=${encodeURIComponent(venue.id)}">Crea per un oggetto ${icon("chevron", { size: 14 })}</a></div>`).join("")}</fieldset>`).join("");
    return `<div class="venue-selector"><div class="filter-heading">${icon("museum")}<div><strong>Musei e sedi</strong><small>Puoi selezionarne più di una</small></div></div>${groups || `<div class="empty-state"><span>${icon("museum", { size: 26 })}</span><p>Nessuna sede disponibile.</p></div>`}</div>`;
  }

  renderCatalogFilters() {
    const options = RESOURCE_TYPES.map(([value, label]) => `<option value="${escapeHtml(value)}" ${this.catalogResourceType === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    return `<aside class="catalog-sidebar surface"><form data-catalog-filter class="catalog-filter" role="search"><div class="catalog-query"><label>Cerca nel catalogo <span class="input-icon">${icon("search")}<input name="q" value="${escapeHtml(this.catalogQuery)}" placeholder="Titolo o descrizione"></span></label><label>Tipo di risorsa <select name="resourceType">${options}</select></label></div>${this.renderVenueSelector()}<button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Aggiornamento…" : "Mostra i risultati"}</button></form></aside>`;
  }

  renderOffer(offer, availableCapabilities) {
    const capabilities = (offer.uses || []).map((use) => use.capability); const alreadyAvailable = capabilities.length > 0 && capabilities.every((capability) => availableCapabilities.has(capability)); const uses = (offer.uses || []).map((use) => escapeHtml(use.label)).join(" · "); const price = formatPrice(offer.pricing);
    if (alreadyAvailable) return `<div class="offer"><div><small>${uses || "Uso disponibile"}</small><strong>${escapeHtml(price)}</strong></div><span class="chip" data-tone="success">${icon("check", { size: 14 })} Disponibile</span></div>`;
    return `<div class="offer"><div><small>${uses || "Uso"}</small><strong>${escapeHtml(price)}</strong></div><span class="chip">Disponibile</span></div>`;
  }

  renderCatalog() {
    const results = this.catalog?.results || []; const selectedNames = (this.venueSelector?.organizations || []).flatMap((organization) => organization.venues || []).filter((venue) => this.selectedVenueIds.includes(String(venue.id))).map((venue) => venue.name);
    const cards = results.map((entry) => { const physicalScope = entry.asset.physicalScope || []; const venues = physicalScope.map((venue) => venue.name).join(" · "); const availableCapabilities = new Set(entry.viewerState?.availableCapabilities || []); const offers = (entry.offers || []).map((offer) => this.renderOffer(offer, availableCapabilities)).join(""); const venueNeutral = entry.asset.venueRelevance?.venueNeutral; const detailParams = new URLSearchParams({ listingId: entry.listingId }); if (this.selectedVenueIds.length) detailParams.set("selectedVenueIds", this.selectedVenueIds.join(",")); return `<article class="catalog-card"><div class="catalog-card__body"><div class="catalog-card__meta"><span class="chip">${escapeHtml(RESOURCE_LABELS[entry.asset.type] || entry.asset.type)}</span>${venueNeutral ? `<span class="chip">Senza sede specifica</span>` : ""}${entry.asset.editorialLicense ? `<span class="chip">${icon("shield", { size: 13 })}${escapeHtml(entry.asset.editorialLicense)}</span>` : ""}</div><h2>${escapeHtml(entry.asset.title)}</h2><p>${escapeHtml(entry.asset.summary)}</p>${physicalScope.length ? `<p class="scope">${icon("museum", { size: 16 })}<span><strong>Sedi della visita</strong><br>${escapeHtml(venues)}</span></p>` : ""}<p class="publisher">Di <strong>${escapeHtml(entry.asset.publisher?.name || "")}</strong>${entry.asset.version ? ` · versione ${escapeHtml(entry.asset.version)}` : ""}</p></div><footer class="catalog-card__footer">${offers || `<p class="muted">Nessuna offerta disponibile.</p>`}<a class="button-link secondary catalog-detail-link" data-route href="/catalog/detail?${detailParams.toString()}">Dettagli e licenze ${icon("chevron", { size: 14 })}</a></footer></article>`; }).join("");
    const page = Number(this.catalog?.page) || 1; const pageSize = Number(this.catalog?.pageSize) || 20; const total = Number(this.catalog?.total) || 0;
    return `<main class="catalog-page"><section class="catalog-hero"><span class="eyebrow">Marketplace culturale</span><h1>Storie, percorsi e contenuti da esplorare.</h1><p>Cerca risorse editoriali riutilizzabili, filtra per sede e aggiungi nuove possibilità alle tue attività.</p></section>${selectedNames.length ? `<div class="selected-venues"><span class="muted">Sedi attive:</span>${selectedNames.map((name) => `<span class="chip">${icon("museum", { size: 13 })}${escapeHtml(name)}</span>`).join("")}</div>` : ""}<div class="catalog-layout">${this.renderCatalogFilters()}<section class="catalog-results"><div class="results-toolbar"><div><span class="eyebrow">Risultati</span><strong>${total} risorse</strong></div><span class="muted">Pagina ${page}</span></div>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && !this.catalog ? `<div class="catalog-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : `<div class="catalog-grid">${cards || `<div class="empty-state"><span>${icon("search", { size: 28 })}</span><h3>Nessun risultato</h3><p>Prova a cambiare ricerca, tipo di risorsa o sedi selezionate.</p></div>`}</div>`}<nav class="pagination" aria-label="Pagine catalogo"><button type="button" data-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}</span><button type="button" data-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav></section></div></main>`;
  }

  renderNavigation(route) {
    return `<button class="menu-toggle" type="button" data-menu-toggle aria-expanded="${this.menuOpen}" aria-label="Apri navigazione">${icon("menu")}</button><nav class="market-nav" data-open="${this.menuOpen}" aria-label="Navigazione principale"><a data-route href="/catalog" aria-current="${current(route, ["/", "/catalog", "/catalog/detail"])}">${icon("catalog")}<span>Catalogo</span></a><a data-route href="/acquisitions" aria-current="${current(route, ["/acquisitions"])}">${icon("history")}<span>Licenze</span></a><a data-route href="/workspace" aria-current="${current(route, ["/workspace", "/workspace/resource", "/workspace/context-compose", "/workspace/commerce"])}">${icon("workspace")}<span>Le mie risorse</span></a><a class="nav-create" data-route href="/workspace/item-authoring" aria-current="${current(route, ["/workspace/item-authoring"])}">${icon("plus")}<span>Crea contenuto</span></a><a data-route href="/workspace/visit-authoring" aria-current="${current(route, ["/workspace/visit-authoring"])}">${icon("route")}<span>Crea visita</span></a><a class="nav-profile" data-route href="/profile" aria-current="${current(route, ["/profile", "/organizations/detail", "/namespaces/editor", "/venues/editor"])}" title="${escapeHtml(this.user.username)}">${icon("user")}<span>Account</span></a><button type="button" data-logout title="Esci">${icon("logout")}<span>Esci</span></button></nav>`;
  }

  render() {
    const route = currentRoute();
    const content = !this.authChecked ? `<main><div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Preparazione del Marketplace…</p></div></main>` : !this.user ? this.renderLogin() : route === "/catalog/detail" ? "<artaround-listing-detail-view></artaround-listing-detail-view>" : route === "/acquisitions" ? "<artaround-acquisition-history-view></artaround-acquisition-history-view>" : route === "/workspace/commerce" ? "<artaround-commerce-management-view></artaround-commerce-management-view>" : route === "/workspace/item-authoring" ? "<artaround-item-authoring-view></artaround-item-authoring-view>" : route === "/workspace/visit-authoring" ? "<artaround-visit-authoring-view></artaround-visit-authoring-view><artaround-visit-logistics-editor></artaround-visit-logistics-editor>" : route === "/workspace/venue-targets" ? "<artaround-venue-target-chooser></artaround-venue-target-chooser>" : route === "/workspace/context-compose" ? "<artaround-context-release-composer></artaround-context-release-composer>" : route === "/profile" ? "<artaround-profile-view></artaround-profile-view>" : route === "/organizations/detail" ? "<artaround-organization-view></artaround-organization-view>" : route === "/namespaces/editor" ? "<artaround-namespace-editor-view></artaround-namespace-editor-view>" : route === "/venues/editor" ? "<artaround-venue-editor-view></artaround-venue-editor-view>" : route === "/workspace" ? "<artaround-workspace-browser-view></artaround-workspace-browser-view>" : route === "/workspace/resource" ? "<artaround-workspace-view></artaround-workspace-view>" : route === "/404" ? `<main><div class="empty-state"><h1>Pagina non trovata</h1><a data-route href="/catalog">Torna al catalogo</a></div></main>` : this.renderCatalog();
    this.innerHTML = `<div class="market-shell">${this.busy ? `<div class="route-progress" role="progressbar" aria-label="Operazione in corso"></div>` : ""}<header class="market-header"><a class="market-brand" data-route href="/catalog"><span class="brand-mark" aria-hidden="true"></span><span class="brand-copy">ArtAround<small>Marketplace</small></span></a>${this.user ? this.renderNavigation(route) : ""}</header>${content}${this.user ? `<footer class="market-footer"><span>ArtAround Marketplace · strumenti per autori e organizzazioni</span><span>Dominio editoriale e fisico rimangono indipendenti.</span></footer>` : ""}</div>`;
    document.title = this.user ? `${TITLES[route] || "ArtAround"} · ArtAround` : "Accedi · ArtAround";
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);