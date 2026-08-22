import { currentRoute, navigate } from "../application/router.js";
import { authRepository } from "../infrastructure/http/auth-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import "./workspace-view.js";
import "./item-authoring-view.js";

const TITLES = {
  "/": "Catalogo",
  "/catalog": "Catalogo",
  "/workspace": "Workspace",
  "/workspace/resource": "Risorsa Workspace",
  "/workspace/item-authoring": "Editor contenuto",
  "/404": "Pagina non trovata",
};

const RESOURCE_TYPES = [
  ["", "Tutti gli asset"],
  ["visit", "Visite"],
  ["visit_revision", "Revisioni visita"],
  ["item_edition", "Contenuti"],
  ["item_revision", "Revisioni contenuto"],
  ["editorial_context", "Contesti editoriali"],
  ["editorial_release", "Release editoriali"],
  ["namespace", "Namespace"],
  ["namespace_revision", "Revisioni Namespace"],
];
const RESOURCE_LABELS = Object.fromEntries(RESOURCE_TYPES.filter(([key]) => key));

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialVenueIds() {
  const selected = new URLSearchParams(window.location.search).get("selectedVenueIds");
  return [...new Set(String(selected || "").split(",").map((value) => value.trim()).filter(Boolean))];
}

function formatPrice(pricing) {
  if (!pricing || pricing.type === "free") return "Gratis";
  const amount = Number(pricing.amountMinor) / 100;
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: pricing.currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${pricing.currency || ""}`.trim();
  }
}

export class MarketplaceAppShell extends HTMLElement {
  user = null;
  authChecked = false;
  catalog = null;
  venueSelector = null;
  busy = false;
  error = null;
  selectedVenueIds = initialVenueIds();
  catalogQuery = "";
  catalogResourceType = "";
  catalogPage = 1;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("popstate", this.onRouteChanged);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    window.removeEventListener("popstate", this.onRouteChanged);
  }

  async bootstrap() {
    try {
      const response = await authRepository.me();
      this.user = response.user;
      this.venueSelector = await marketplaceRepository.venueSelector();
      await this.loadCatalogIfNeeded();
    } catch {
      this.user = null;
    } finally {
      this.authChecked = true;
      this.render();
    }
  }

  onRouteChanged = async () => {
    await this.loadCatalogIfNeeded();
    this.render();
  };

  async loadCatalogIfNeeded() {
    const route = currentRoute();
    if (!this.user || !["/", "/catalog"].includes(route)) return;
    this.catalog = await marketplaceRepository.catalog({
      selectedVenueIds: this.selectedVenueIds,
      page: this.catalogPage,
      q: this.catalogQuery,
      resourceTypes: this.catalogResourceType ? [this.catalogResourceType] : null,
    });
  }

  syncCatalogUrl() {
    if (!["/", "/catalog"].includes(currentRoute())) return;
    const url = new URL(window.location.href);
    if (this.selectedVenueIds.length) url.searchParams.set("selectedVenueIds", this.selectedVenueIds.join(","));
    else url.searchParams.delete("selectedVenueIds");
    window.history.replaceState({}, "", url);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("form[data-login]")) {
      event.preventDefault();
      const data = new FormData(form);
      this.busy = true;
      this.error = null;
      this.render();
      try {
        const response = await authRepository.login(String(data.get("username") || ""), String(data.get("password") || ""));
        this.user = response.user;
        this.venueSelector = await marketplaceRepository.venueSelector();
        await this.loadCatalogIfNeeded();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Accesso non riuscito";
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }
    if (form.matches("form[data-catalog-filter]")) {
      event.preventDefault();
      const data = new FormData(form);
      this.catalogQuery = String(data.get("q") || "").trim();
      this.catalogResourceType = String(data.get("resourceType") || "").trim();
      this.selectedVenueIds = [...new Set(data.getAll("selectedVenueIds").map(String).filter(Boolean))];
      this.catalogPage = 1;
      this.syncCatalogUrl();
      this.busy = true;
      this.error = null;
      this.render();
      try {
        await this.loadCatalogIfNeeded();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Impossibile aggiornare il catalogo";
      } finally {
        this.busy = false;
        this.render();
      }
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const routeLink = target?.closest("a[data-route]");
    if (routeLink) {
      event.preventDefault();
      navigate(routeLink.getAttribute("href"));
      return;
    }
    const pageButton = target?.closest("button[data-page]");
    if (pageButton) {
      this.catalogPage = Math.max(1, Number(pageButton.dataset.page) || 1);
      this.busy = true;
      this.error = null;
      this.render();
      try { await this.loadCatalogIfNeeded(); }
      catch (error) { this.error = error instanceof Error ? error.message : "Impossibile cambiare pagina"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const acquireButton = target?.closest("button[data-acquire]");
    if (acquireButton) {
      this.busy = true;
      this.error = null;
      this.render();
      try {
        await marketplaceRepository.acquire(acquireButton.dataset.acquire);
        await this.loadCatalogIfNeeded();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Acquisizione non riuscita";
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }
    const logoutButton = target?.closest("button[data-logout]");
    if (logoutButton) {
      await authRepository.logout().catch(() => {});
      this.user = null;
      this.catalog = null;
      this.render();
    }
  };

  renderLogin() {
    return `<main><h1>Accedi al Marketplace</h1><form data-login>
      <label>Username <input name="username" autocomplete="username" required></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" ${this.busy ? "disabled" : ""}>${this.busy ? "Accesso…" : "Accedi"}</button>
    </form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</main>`;
  }

  renderVenueSelector() {
    const selected = new Set(this.selectedVenueIds);
    const groups = (this.venueSelector?.organizations || []).map((organization) => `
      <fieldset><legend>${escapeHtml(organization.name)}</legend>
        ${(organization.venues || []).map((venue) => `<label class="venue-choice"><input type="checkbox" name="selectedVenueIds" value="${escapeHtml(venue.id)}" ${selected.has(String(venue.id)) ? "checked" : ""}> <span><strong>${escapeHtml(venue.name)}</strong>${venue.description ? `<small>${escapeHtml(venue.description)}</small>` : ""}</span></label>`).join("")}
      </fieldset>`).join("");
    return `<div class="venue-selector"><p><strong>Musei / sedi</strong></p><p class="hint">Selezione multipla OR: filtra la pertinenza del catalogo, non modifica ownership o EditorialScope.</p>${groups || "<p>Nessuna Venue disponibile.</p>"}</div>`;
  }

  renderCatalogFilters() {
    const options = RESOURCE_TYPES.map(([value, label]) => `<option value="${escapeHtml(value)}" ${this.catalogResourceType === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    return `<form data-catalog-filter class="catalog-filter" role="search">
      ${this.renderVenueSelector()}
      <div class="catalog-query"><label>Cerca nel catalogo <input name="q" value="${escapeHtml(this.catalogQuery)}" placeholder="Titolo o descrizione"></label>
      <label>Tipo di asset <select name="resourceType">${options}</select></label>
      <button type="submit" ${this.busy ? "disabled" : ""}>Applica filtri</button></div>
    </form>`;
  }

  renderOffer(offer, availableCapabilities) {
    const capabilities = (offer.uses || []).map((use) => use.capability);
    const alreadyAvailable = capabilities.length > 0 && capabilities.every((capability) => availableCapabilities.has(capability));
    const uses = (offer.uses || []).map((use) => escapeHtml(use.label)).join(" · ");
    const price = formatPrice(offer.pricing);
    if (alreadyAvailable) return `<div class="offer"><p>${uses || "Uso disponibile"} · ${escapeHtml(price)}</p><p><strong>Già disponibile</strong></p></div>`;
    const action = offer.pricing?.type === "paid" ? "Acquisisci (vendita simulata)" : "Acquisisci";
    return `<div class="offer"><p>${uses || "Uso"} · ${escapeHtml(price)}</p><button type="button" data-acquire="${escapeHtml(offer.id)}" ${this.busy ? "disabled" : ""}>${escapeHtml(action)}</button></div>`;
  }

  renderCatalog() {
    const results = this.catalog?.results || [];
    const cards = results.map((entry) => {
      const physicalScope = entry.asset.physicalScope || [];
      const venues = physicalScope.map((venue) => venue.name).join(" · ");
      const availableCapabilities = new Set(entry.viewerState?.availableCapabilities || []);
      const offers = (entry.offers || []).map((offer) => this.renderOffer(offer, availableCapabilities)).join("");
      const relevance = entry.asset.venueRelevance;
      const relevanceText = relevance?.venueNeutral
        ? "Asset indipendente dalla Venue"
        : this.selectedVenueIds.length ? "Pertinente ad almeno una sede selezionata" : "";
      const visitInfo = physicalScope.length ? `<p><strong>PhysicalScope completo:</strong> ${escapeHtml(venues)}</p>` : "";
      return `<article class="card">
        <p class="asset-type">${escapeHtml(RESOURCE_LABELS[entry.asset.type] || entry.asset.type)}</p>
        <h2>${escapeHtml(entry.asset.title)}</h2><p>${escapeHtml(entry.asset.summary)}</p>
        ${visitInfo}${relevanceText ? `<p class="hint">${escapeHtml(relevanceText)}</p>` : ""}
        <p>Pubblicato da ${escapeHtml(entry.asset.publisher?.name || "")}${entry.asset.version ? ` · versione ${escapeHtml(entry.asset.version)}` : ""}</p>
        ${offers || "<p>Nessuna offerta disponibile.</p>"}
      </article>`;
    }).join("");
    const page = Number(this.catalog?.page) || 1;
    const pageSize = Number(this.catalog?.pageSize) || 20;
    const total = Number(this.catalog?.total) || 0;
    return `<main><h1>Catalogo</h1>
      ${this.selectedVenueIds.length ? `<p>${this.selectedVenueIds.length} sede/i selezionata/e. Le Visit mostrano sempre l'intero PhysicalScope.</p>` : "<p>Nessun filtro Venue: catalogo globale.</p>"}
      ${this.renderCatalogFilters()}
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      <p>${total} asset trovati</p>${cards || "<p>Nessun asset disponibile nel catalogo corrente.</p>"}
      <nav class="pagination" aria-label="Pagine catalogo">
        <button type="button" data-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>Precedente</button>
        <span>Pagina ${page}</span>
        <button type="button" data-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva</button>
      </nav></main>`;
  }

  render() {
    const route = currentRoute();
    const content = !this.authChecked ? "<main><p>Caricamento…</p></main>"
      : !this.user ? this.renderLogin()
      : route === "/workspace/item-authoring" ? "<artaround-item-authoring-view></artaround-item-authoring-view>"
      : ["/workspace", "/workspace/resource"].includes(route) ? "<artaround-workspace-view></artaround-workspace-view>"
      : route === "/404" ? "<main><h1>Pagina non trovata</h1></main>" : this.renderCatalog();

    this.innerHTML = `<style>
      :host{display:block;font-family:system-ui,sans-serif} header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem;border-bottom:1px solid currentColor} nav{display:flex;gap:1rem;align-items:center} main{max-width:70rem;margin:0 auto;padding:2rem 1rem} form{display:grid;gap:1rem} label{display:grid;gap:.35rem}.catalog-filter{max-width:none;margin-block:1rem 2rem}.catalog-query{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(12rem,.7fr) auto;gap:1rem;align-items:end}.venue-selector{display:grid;gap:.8rem}.venue-selector fieldset{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.5rem 1rem}.venue-choice{grid-template-columns:auto 1fr;align-items:start}.venue-choice small{display:block;opacity:.75}.hint{opacity:.72}.card{padding:1.25rem 0;border-bottom:1px solid currentColor}.asset-type{font-size:.85rem;text-transform:uppercase;letter-spacing:.04em}.offer{padding:.75rem 0}.pagination{justify-content:space-between;margin-top:2rem}button,input,select{font:inherit;padding:.6rem .75rem}@media(max-width:44rem){.catalog-query{grid-template-columns:1fr}header{align-items:flex-start}nav{flex-wrap:wrap}}
    </style><header><strong>ArtAround Marketplace</strong>${this.user ? `<nav aria-label="Navigazione principale"><a data-route href="/catalog">Catalogo</a><a data-route href="/workspace">Workspace</a><a data-route href="/workspace/item-authoring">Crea contenuto</a><span>${escapeHtml(this.user.username)}</span><button type="button" data-logout>Esci</button></nav>` : ""}</header>${content}`;
    document.title = `${TITLES[route] || "ArtAround"} · ArtAround`;
  }
}

customElements.define("artaround-marketplace-app", MarketplaceAppShell);
