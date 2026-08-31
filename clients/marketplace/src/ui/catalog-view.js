import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { replaceCurrentHistoryUrl } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatPrice, marketplaceResourceLabel } from "./commercial-utils.js";
import { renderExploreNavigation } from "./explore-navigation.js";

const TYPE_FILTERS = Object.freeze({
  all: [],
  content: ["item_edition", "item_revision"],
  visits: ["visit", "visit_revision"],
  collections: ["editorial_context", "editorial_release"],
  rules: ["namespace", "namespace_revision"],
});

const TYPE_OPTIONS = [
  ["all", "Tutto"],
  ["content", "Contenuti"],
  ["visits", "Visite"],
  ["collections", "Raccolte editoriali"],
  ["rules", "Regole editoriali"],
];
const MIN_VENUE_QUERY_LENGTH = 2;

class CatalogQueryState extends QueryState {
  constructor({ q = "", type = "all", selectedVenueIds = [], page = 1 } = {}) {
    super({
      query: String(q || "").trim(),
      filters: {
        type: Object.hasOwn(TYPE_FILTERS, type) ? type : "all",
        selectedVenueIds: [...new Set((selectedVenueIds || []).map(String).filter(Boolean))],
      },
      page,
    });
  }

  get q() { return this.query; }
  get type() { return Object.hasOwn(TYPE_FILTERS, this.filters.type) ? this.filters.type : "all"; }
  get selectedVenueIds() { return Array.isArray(this.filters.selectedVenueIds) ? this.filters.selectedVenueIds : []; }
}

function readState() {
  const params = new URLSearchParams(window.location.search);
  const type = Object.hasOwn(TYPE_FILTERS, params.get("type")) ? params.get("type") : "all";
  return new CatalogQueryState({
    q: String(params.get("q") || "").trim(),
    type,
    selectedVenueIds: String(params.get("selectedVenueIds") || "").split(",").map((value) => value.trim()).filter(Boolean),
    page: Math.max(1, Number(params.get("page")) || 1),
  });
}

function firstOfferSummary(offers = []) {
  if (!offers.length) return { price: "Non disponibile", suffix: "Nessuna offerta attiva" };
  const free = offers.find((offer) => offer.pricing?.type === "free");
  const offer = free || offers[0];
  return { price: formatPrice(offer.pricing), suffix: offers.length === 1 ? "1 offerta" : `${offers.length} offerte` };
}

function normalizeVenueSearch(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").trim();
}

export class ArtAroundCatalogView extends HTMLElement {
  catalog = null;
  venueSelector = null;
  busy = false;
  error = null;
  state = readState();
  venueQuery = "";
  browser = new ResourceBrowserController({
    queryState: this.state,
    load: async ({ query, filters, page }) => {
      if (!this.venueSelector) this.venueSelector = await marketplaceRepository.venueSelector();
      const catalog = await marketplaceRepository.catalog({
        selectedVenueIds: Array.isArray(filters.selectedVenueIds) ? filters.selectedVenueIds : [],
        page,
        q: query,
        resourceTypes: TYPE_FILTERS[Object.hasOwn(TYPE_FILTERS, filters.type) ? filters.type : "all"],
      });
      return { ...catalog, items: Array.isArray(catalog?.results) ? catalog.results : [] };
    },
    onStateChange: (browserState) => {
      this.busy = browserState.loading;
      this.error = browserState.error;
      if (browserState.result) this.catalog = browserState.result;
      if (this.isConnected) this.render();
    },
  });

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("input", this.onInput);
    this.addEventListener("keydown", this.onKeyDown);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("keydown", this.onKeyDown);
    this.browser.dispose();
  }

  async load() {
    const browserState = await this.browser.refresh();
    if (!browserState.error && browserState.result) this.syncUrl();
  }

  syncUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (this.state.q) url.searchParams.set("q", this.state.q);
    if (this.state.type !== "all") url.searchParams.set("type", this.state.type);
    if (this.state.selectedVenueIds.length) url.searchParams.set("selectedVenueIds", this.state.selectedVenueIds.join(","));
    if (this.state.page > 1) url.searchParams.set("page", String(this.state.page));
    replaceCurrentHistoryUrl(url);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-catalog-search]")) return;
    event.preventDefault();
    const data = new FormData(form);
    const type = Object.hasOwn(TYPE_FILTERS, String(data.get("type") || "")) ? String(data.get("type")) : "all";
    const selectedVenueIds = [...new Set(data.getAll("selectedVenueIds").map(String).filter(Boolean))];
    this.state.setQuery(String(data.get("q") || "").trim());
    this.state.setFilter("type", type);
    this.state.setFilter("selectedVenueIds", selectedVenueIds);
    await this.load();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-clear-venue-search]")) {
      this.venueQuery = "";
      const input = this.querySelector("input[data-venue-search]");
      if (input) input.value = "";
      this.filterVenueOptions();
      input?.focus();
      return;
    }
    const removeVenue = target?.closest("button[data-remove-selected-venue]");
    if (removeVenue) {
      this.state.setFilter("selectedVenueIds", this.state.selectedVenueIds.filter((venueId) => String(venueId) !== String(removeVenue.dataset.removeSelectedVenue)));
      await this.load();
      return;
    }
    const pageButton = target?.closest("button[data-catalog-page]");
    if (pageButton) {
      this.state.setPage(Math.max(1, Number(pageButton.dataset.catalogPage) || 1));
      await this.load();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target?.closest("button[data-clear-catalog]")) {
      this.state.setQuery("");
      this.state.setFilter("type", "all");
      this.state.setFilter("selectedVenueIds", []);
      this.state.setPage(1);
      this.venueQuery = "";
      await this.load();
    }
  };

  onInput = (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.matches("input[data-venue-search]")) return;
    this.venueQuery = input.value;
    this.filterVenueOptions();
  };

  onKeyDown = (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (input?.matches("input[data-venue-search]") && event.key === "Enter") event.preventDefault();
  };

  filterCount() { return (this.state.type === "all" ? 0 : 1) + this.state.selectedVenueIds.length; }

  selectedVenues() {
    const selected = new Set(this.state.selectedVenueIds);
    return (this.venueSelector?.organizations || []).flatMap((organization) => (organization.venues || []).map((venue) => ({ ...venue, organizationName: organization.name }))).filter((venue) => selected.has(String(venue.id)));
  }

  matchingVenueCount() {
    const query = normalizeVenueSearch(this.venueQuery);
    if (query.length < MIN_VENUE_QUERY_LENGTH) return 0;
    return (this.venueSelector?.organizations || []).reduce((total, organization) => total + (organization.venues || []).filter((venue) => normalizeVenueSearch(`${venue.name} ${venue.description || ""} ${organization.name}`).includes(query)).length, 0);
  }

  filterVenueOptions() {
    const query = normalizeVenueSearch(this.venueQuery);
    const searchReady = query.length >= MIN_VENUE_QUERY_LENGTH;
    let visible = 0;
    this.querySelectorAll("[data-venue-option]").forEach((option) => {
      const matches = searchReady && String(option.dataset.venueSearchText || "").includes(query);
      option.hidden = !matches;
      if (matches) visible += 1;
    });
    this.querySelectorAll("[data-venue-group]").forEach((group) => {
      const groupVisible = [...group.querySelectorAll("[data-venue-option]")].filter((option) => !option.hidden).length;
      group.hidden = !searchReady || groupVisible === 0;
      const groupCount = group.querySelector("[data-venue-group-count]");
      if (groupCount) groupCount.textContent = String(groupVisible);
    });
    const count = this.querySelector("[data-venue-result-count]");
    if (count) count.textContent = !query ? "I risultati compariranno dopo la ricerca." : !searchReady ? `Scrivi almeno ${MIN_VENUE_QUERY_LENGTH} caratteri.` : `${visible} ${visible === 1 ? "sede trovata" : "sedi trovate"}`;
    const results = this.querySelector("[data-venue-results]");
    if (results) results.hidden = !searchReady || visible === 0;
    const prompt = this.querySelector("[data-venue-search-prompt]");
    if (prompt) prompt.hidden = searchReady;
    const promptText = this.querySelector("[data-venue-search-prompt-text]");
    if (promptText) promptText.textContent = query ? `Aggiungi ancora ${MIN_VENUE_QUERY_LENGTH - query.length} carattere per vedere i risultati.` : "Scrivi il nome di un museo, una sede o un'organizzazione.";
    const empty = this.querySelector("[data-no-venue-results]");
    if (empty) empty.hidden = !searchReady || visible > 0;
    const clear = this.querySelector("button[data-clear-venue-search]");
    if (clear) clear.hidden = !query;
  }

  renderVenueFilters() {
    const selected = new Set(this.state.selectedVenueIds);
    const query = normalizeVenueSearch(this.venueQuery);
    const searchReady = query.length >= MIN_VENUE_QUERY_LENGTH;
    let visibleCount = 0;
    const groups = (this.venueSelector?.organizations || []).map((organization) => {
      let groupVisibleCount = 0;
      const venues = (organization.venues || []).map((venue) => {
        const searchText = normalizeVenueSearch(`${venue.name} ${venue.description || ""} ${organization.name}`);
        const visible = searchReady && searchText.includes(query);
        if (visible) { visibleCount += 1; groupVisibleCount += 1; }
        return `<label class="consumer-venue-choice" data-venue-option data-venue-search-text="${escapeHtml(searchText)}" ${visible ? "" : "hidden"}><input type="checkbox" name="selectedVenueIds" value="${escapeHtml(venue.id)}" ${selected.has(String(venue.id)) ? "checked" : ""}><span><strong>${escapeHtml(venue.name)}</strong>${venue.description ? `<small>${escapeHtml(venue.description)}</small>` : ""}</span></label>`;
      }).join("");
      return `<fieldset class="consumer-venue-group" data-venue-group ${groupVisibleCount ? "" : "hidden"}><legend><span>${escapeHtml(organization.name)}</span><small data-venue-group-count>${groupVisibleCount}</small></legend>${venues}</fieldset>`;
    }).join("");
    if (!groups) return `<p class="muted">Nessuna sede disponibile per il filtro.</p>`;
    const prompt = !query ? "Scrivi il nome di un museo, una sede o un'organizzazione." : `Aggiungi ancora ${MIN_VENUE_QUERY_LENGTH - query.length} carattere per vedere i risultati.`;
    return `<div class="consumer-venue-prompt" data-venue-search-prompt ${searchReady ? "hidden" : ""}><span>${icon("search", { size: 20 })}</span><div><strong>Cerca prima di scegliere</strong><small data-venue-search-prompt-text>${escapeHtml(prompt)}</small></div></div><div class="consumer-venue-results" data-venue-results ${searchReady && visibleCount ? "" : "hidden"}>${groups}</div><p class="consumer-venue-empty" data-no-venue-results ${searchReady && !visibleCount ? "" : "hidden"}>Nessuna sede corrisponde alla ricerca. Prova con un altro nome.</p>`;
  }

  renderCard(entry) {
    const asset = entry.asset || {};
    const media = asset.illustrativeMedia?.[0] || null;
    const physicalScope = asset.physicalScope || [];
    const offerSummary = firstOfferSummary(entry.offers || []);
    const detailParams = new URLSearchParams({ listingId: entry.listingId });
    if (this.state.selectedVenueIds.length) detailParams.set("selectedVenueIds", this.state.selectedVenueIds.join(","));
    const returnParams = new URLSearchParams();
    if (this.state.q) returnParams.set("q", this.state.q);
    if (this.state.type !== "all") returnParams.set("type", this.state.type);
    if (this.state.selectedVenueIds.length) returnParams.set("selectedVenueIds", this.state.selectedVenueIds.join(","));
    if (this.state.page > 1) returnParams.set("page", String(this.state.page));
    detailParams.set("returnTo", `/catalog${returnParams.toString() ? `?${returnParams.toString()}` : ""}`);
    const alreadyAvailable = Boolean(entry.viewerState?.alreadyUsable);
    return `<article class="catalog-card consumer-catalog-card"><div class="catalog-card__body" ${media ? "data-has-preview" : ""}>${media ? `<img class="consumer-catalog-card__preview" src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || asset.title || "Immagine del contenuto")}" loading="lazy" decoding="async">` : ""}<div class="catalog-card__meta"><span class="chip">${escapeHtml(marketplaceResourceLabel(asset.type))}</span>${alreadyAvailable ? `<span class="chip" data-tone="success">${icon("check", { size: 13 })} Hai già accesso</span>` : ""}</div><div class="consumer-catalog-card__heading"><h2>${escapeHtml(asset.title || "Risorsa senza titolo")}</h2><p>${escapeHtml(asset.summary || "Nessuna descrizione disponibile.")}</p></div><p class="publisher">Pubblicato da <strong>${escapeHtml(asset.publisher?.name || "Autore")}</strong></p>${physicalScope.length ? `<div class="consumer-scope"><span>${icon("museum", { size: 16 })}</span><span><strong>Sedi coinvolte</strong><small>${escapeHtml(physicalScope.map((venue) => venue.name).join(" · "))}</small></span></div>` : ""}<details class="technical-details"><summary>Dettagli della versione</summary><dl class="definition-list"><div><dt>Tipo tecnico</dt><dd><code>${escapeHtml(asset.type || "")}</code></dd></div>${asset.version ? `<div><dt>Versione</dt><dd>${escapeHtml(asset.version)}</dd></div>` : ""}${asset.editorialLicense ? `<div><dt>Licenza editoriale</dt><dd>${escapeHtml(asset.editorialLicense)}</dd></div>` : ""}</dl></details></div><footer class="catalog-card__footer"><div class="consumer-price"><strong>${escapeHtml(offerSummary.price)}</strong><small>${escapeHtml(offerSummary.suffix)}</small></div><a class="button-link secondary catalog-detail-link" data-route href="/catalog/detail?${detailParams.toString()}">Vedi dettagli ${icon("chevron", { size: 14 })}</a></footer></article>`;
  }

  render() {
    const total = Number(this.catalog?.total) || 0;
    const page = Number(this.catalog?.page) || this.state.page;
    const pageSize = Number(this.catalog?.pageSize) || 20;
    const selectedVenues = this.selectedVenues();
    const matchingVenueCount = this.matchingVenueCount();
    const cards = (this.catalog?.results || []).map((entry) => this.renderCard(entry)).join("");
    const typeOptions = TYPE_OPTIONS.map(([value, label]) => `<option value="${value}" ${this.state.type === value ? "selected" : ""}>${label}</option>`).join("");
    const noResults = !this.busy && this.catalog && total === 0;
    const selectedVenueSummary = selectedVenues.length ? `<aside class="selected-venues" aria-label="Sedi applicate al catalogo"><div class="selected-venues__heading"><span>${icon("museum", { size: 16 })}</span><span><strong>${selectedVenues.length} ${selectedVenues.length === 1 ? "sede selezionata" : "sedi selezionate"}</strong><small>Selezione applicata ai risultati.</small></span></div><div class="selected-venue-chips">${selectedVenues.map((venue) => `<button class="selected-venue-chip" type="button" data-remove-selected-venue="${escapeHtml(venue.id)}" title="Rimuovi ${escapeHtml(venue.name)}"><span>${escapeHtml(venue.name)}</span><span aria-hidden="true">×</span></button>`).join("")}</div></aside>` : "";
    const normalizedVenueQuery = normalizeVenueSearch(this.venueQuery);
    const venueSearchReady = normalizedVenueQuery.length >= MIN_VENUE_QUERY_LENGTH;
    const venueResultLabel = !normalizedVenueQuery ? "I risultati compariranno dopo la ricerca." : !venueSearchReady ? `Scrivi almeno ${MIN_VENUE_QUERY_LENGTH} caratteri.` : `${matchingVenueCount} ${matchingVenueCount === 1 ? "sede trovata" : "sedi trovate"}`;
    const filterPanel = `<details class="consumer-filters" ${this.filterCount() || this.venueQuery ? "open" : ""}><summary><span>Filtri</span><span class="consumer-filter-count">${this.filterCount()}</span></summary><div class="consumer-filters__body"><section class="consumer-filter-kind" aria-labelledby="catalog-type-title"><div><span class="eyebrow">Formato</span><strong id="catalog-type-title">Che cosa cerchi?</strong><small>Restringi il catalogo a una categoria.</small></div><label for="catalog-type">Tipo di risorsa<select id="catalog-type" name="type">${typeOptions}</select></label></section><section class="consumer-venues" aria-labelledby="catalog-venues-title"><div class="consumer-venues__heading"><div><span class="eyebrow">Luogo</span><strong id="catalog-venues-title">Musei e sedi</strong><small id="venue-filter-help">Le organizzazioni e le sedi vengono mostrate soltanto dopo una ricerca.</small></div><span class="consumer-venue-selection-count">${selectedVenues.length} selezionate</span></div><div class="consumer-venue-search"><label for="catalog-venue-q">Cerca una sede o un'organizzazione</label><div class="consumer-venue-search__control"><span class="input-icon">${icon("search", { size: 16 })}<input id="catalog-venue-q" type="search" data-venue-search value="${escapeHtml(this.venueQuery)}" placeholder="Nome del museo, sede o organizzazione…" autocomplete="off" aria-describedby="venue-filter-help venue-result-count"></span><button class="button-secondary small" type="button" data-clear-venue-search ${normalizedVenueQuery ? "" : "hidden"}>Cancella</button></div><small id="venue-result-count" data-venue-result-count aria-live="polite">${venueResultLabel}</small></div>${this.renderVenueFilters()}</section><div class="consumer-filters__actions"><button type="submit" ${this.busy ? "disabled" : ""}>Applica filtri</button>${this.filterCount() || this.state.q ? `<button class="button-secondary" type="button" data-clear-catalog>Rimuovi tutti i filtri</button>` : ""}</div></div></details>`;
    this.innerHTML = `<main class="page consumer-catalog" aria-busy="${this.busy}">${renderExploreNavigation("catalog")}<header class="consumer-catalog__intro"><span class="eyebrow">Catalogo ArtAround</span><h1>Trova contenuti e visite da usare.</h1><p>Cerca per titolo o descrizione. Per luogo, puoi trovare rapidamente una sede anche in cataloghi con centinaia di musei.</p></header><form class="consumer-search" data-catalog-search role="search"><div class="consumer-search__bar"><label class="sr-only" for="catalog-q">Cerca nel catalogo</label><span class="input-icon">${icon("search")}<input id="catalog-q" name="q" value="${escapeHtml(this.state.q)}" placeholder="Cerca contenuti, visite o raccolte…"></span><button type="submit" ${this.busy ? "disabled" : ""}>Cerca</button></div>${filterPanel}</form>${selectedVenueSummary}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="catalog-results" aria-live="polite"><div class="results-toolbar"><div><span class="eyebrow">Risultati</span><strong>${total} ${total === 1 ? "risorsa" : "risorse"}</strong></div>${total ? `<span class="muted">Pagina ${page}</span>` : ""}</div>${this.busy && !this.catalog ? `<div class="catalog-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : noResults ? `<div class="empty-state"><span>${icon("search", { size: 28 })}</span><h3>Nessun risultato</h3><p>Prova una ricerca più ampia oppure rimuovi alcuni filtri.</p><button type="button" data-clear-catalog>Mostra tutto il catalogo</button></div>` : `<div class="catalog-grid">${cards}</div>`}${total ? `<nav class="pagination" aria-label="Pagine del catalogo"><button type="button" data-catalog-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${page}</span><button type="button" data-catalog-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>` : ""}</section></main>`;
  }
}

customElements.define("artaround-catalog-view", ArtAroundCatalogView);
