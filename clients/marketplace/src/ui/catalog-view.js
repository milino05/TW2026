import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { escapeHtml, formatPrice, marketplaceResourceLabel } from "./commercial-utils.js";

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

function readState() {
  const params = new URLSearchParams(window.location.search);
  const type = Object.hasOwn(TYPE_FILTERS, params.get("type")) ? params.get("type") : "all";
  return {
    q: String(params.get("q") || "").trim(),
    type,
    selectedVenueIds: [...new Set(String(params.get("selectedVenueIds") || "").split(",").map((value) => value.trim()).filter(Boolean))],
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function firstOfferSummary(offers = []) {
  if (!offers.length) return { price: "Non disponibile", suffix: "Nessuna offerta attiva" };
  const free = offers.find((offer) => offer.pricing?.type === "free");
  const offer = free || offers[0];
  return {
    price: formatPrice(offer.pricing),
    suffix: offers.length === 1 ? "1 offerta" : `${offers.length} offerte`,
  };
}

export class ArtAroundCatalogView extends HTMLElement {
  catalog = null;
  venueSelector = null;
  busy = false;
  error = null;
  state = readState();

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
      if (!this.venueSelector) this.venueSelector = await marketplaceRepository.venueSelector();
      this.catalog = await marketplaceRepository.catalog({
        selectedVenueIds: this.state.selectedVenueIds,
        page: this.state.page,
        q: this.state.q,
        resourceTypes: TYPE_FILTERS[this.state.type],
      });
      this.syncUrl();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Catalogo non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  syncUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (this.state.q) url.searchParams.set("q", this.state.q);
    if (this.state.type !== "all") url.searchParams.set("type", this.state.type);
    if (this.state.selectedVenueIds.length) url.searchParams.set("selectedVenueIds", this.state.selectedVenueIds.join(","));
    if (this.state.page > 1) url.searchParams.set("page", String(this.state.page));
    window.history.replaceState({}, "", url);
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-catalog-search]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.state = {
      q: String(data.get("q") || "").trim(),
      type: Object.hasOwn(TYPE_FILTERS, String(data.get("type") || "")) ? String(data.get("type")) : "all",
      selectedVenueIds: [...new Set(data.getAll("selectedVenueIds").map(String).filter(Boolean))],
      page: 1,
    };
    await this.load();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const pageButton = target?.closest("button[data-catalog-page]");
    if (pageButton) {
      this.state.page = Math.max(1, Number(pageButton.dataset.catalogPage) || 1);
      await this.load();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target?.closest("button[data-clear-catalog]")) {
      this.state = { q: "", type: "all", selectedVenueIds: [], page: 1 };
      await this.load();
    }
  };

  filterCount() {
    return (this.state.type === "all" ? 0 : 1) + this.state.selectedVenueIds.length;
  }

  selectedVenueNames() {
    const selected = new Set(this.state.selectedVenueIds);
    return (this.venueSelector?.organizations || [])
      .flatMap((organization) => organization.venues || [])
      .filter((venue) => selected.has(String(venue.id)))
      .map((venue) => venue.name);
  }

  renderVenueFilters() {
    const selected = new Set(this.state.selectedVenueIds);
    const groups = (this.venueSelector?.organizations || []).map((organization) => `
      <fieldset class="consumer-venue-group">
        <legend>${escapeHtml(organization.name)}</legend>
        ${(organization.venues || []).map((venue) => `<label class="consumer-venue-choice"><input type="checkbox" name="selectedVenueIds" value="${escapeHtml(venue.id)}" ${selected.has(String(venue.id)) ? "checked" : ""}><span><strong>${escapeHtml(venue.name)}</strong>${venue.description ? `<small>${escapeHtml(venue.description)}</small>` : ""}</span></label>`).join("")}
      </fieldset>`).join("");
    return groups || `<p class="muted">Nessuna sede disponibile per il filtro.</p>`;
  }

  renderCard(entry) {
    const asset = entry.asset || {};
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
    return `<article class="catalog-card consumer-catalog-card">
      <div class="catalog-card__body">
        <div class="catalog-card__meta"><span class="chip">${escapeHtml(marketplaceResourceLabel(asset.type))}</span>${alreadyAvailable ? `<span class="chip" data-tone="success">${icon("check", { size: 13 })} Hai già accesso</span>` : ""}</div>
        <div><h2>${escapeHtml(asset.title || "Risorsa senza titolo")}</h2><p>${escapeHtml(asset.summary || "Nessuna descrizione disponibile.")}</p></div>
        <p class="publisher">Pubblicato da <strong>${escapeHtml(asset.publisher?.name || "Autore")}</strong></p>
        ${physicalScope.length ? `<div class="consumer-scope"><span>${icon("museum", { size: 16 })}</span><span><strong>Sedi coinvolte</strong><small>${escapeHtml(physicalScope.map((venue) => venue.name).join(" · "))}</small></span></div>` : ""}
        <details class="technical-details"><summary>Dettagli della versione</summary><dl class="definition-list"><div><dt>Tipo tecnico</dt><dd><code>${escapeHtml(asset.type || "")}</code></dd></div>${asset.version ? `<div><dt>Versione</dt><dd>${escapeHtml(asset.version)}</dd></div>` : ""}${asset.editorialLicense ? `<div><dt>Licenza editoriale</dt><dd>${escapeHtml(asset.editorialLicense)}</dd></div>` : ""}</dl></details>
      </div>
      <footer class="catalog-card__footer"><div class="consumer-price"><strong>${escapeHtml(offerSummary.price)}</strong><small>${escapeHtml(offerSummary.suffix)}</small></div><a class="button-link secondary catalog-detail-link" data-route href="/catalog/detail?${detailParams.toString()}">Vedi dettagli ${icon("chevron", { size: 14 })}</a></footer>
    </article>`;
  }

  render() {
    const total = Number(this.catalog?.total) || 0;
    const page = Number(this.catalog?.page) || this.state.page;
    const pageSize = Number(this.catalog?.pageSize) || 20;
    const selectedNames = this.selectedVenueNames();
    const cards = (this.catalog?.results || []).map((entry) => this.renderCard(entry)).join("");
    const typeOptions = TYPE_OPTIONS.map(([value, label]) => `<option value="${value}" ${this.state.type === value ? "selected" : ""}>${label}</option>`).join("");
    const noResults = !this.busy && this.catalog && total === 0;

    this.innerHTML = `<main class="page consumer-catalog" aria-busy="${this.busy}">
      <header class="consumer-catalog__intro"><span class="eyebrow">Catalogo ArtAround</span><h1>Trova contenuti e visite da usare.</h1><p>Cerca per titolo o descrizione. Se serve, restringi i risultati per tipo e sede.</p></header>
      <form class="consumer-search" data-catalog-search role="search">
        <div class="consumer-search__bar"><label class="sr-only" for="catalog-q">Cerca nel catalogo</label><span class="input-icon">${icon("search")}<input id="catalog-q" name="q" value="${escapeHtml(this.state.q)}" placeholder="Cerca contenuti, visite o raccolte…"></span><button type="submit" ${this.busy ? "disabled" : ""}>Cerca</button></div>
        <details class="consumer-filters" ${this.filterCount() ? "open" : ""}><summary>Filtri (${this.filterCount()})</summary><div class="consumer-filters__body"><label>Che cosa cerchi?<select name="type">${typeOptions}</select></label><div class="consumer-venues"><div><strong>Musei e sedi</strong><small>Puoi selezionarne più di una.</small></div>${this.renderVenueFilters()}</div><div class="button-row"><button type="submit" ${this.busy ? "disabled" : ""}>Mostra i risultati</button>${this.filterCount() || this.state.q ? `<button class="button-secondary" type="button" data-clear-catalog>Rimuovi filtri</button>` : ""}</div></div></details>
      </form>
      ${selectedNames.length ? `<div class="selected-venues"><span class="muted">Sedi selezionate:</span>${selectedNames.map((name) => `<span class="chip">${icon("museum", { size: 13 })}${escapeHtml(name)}</span>`).join("")}</div>` : ""}
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      <section class="catalog-results" aria-live="polite"><div class="results-toolbar"><div><span class="eyebrow">Risultati</span><strong>${total} ${total === 1 ? "risorsa" : "risorse"}</strong></div>${total ? `<span class="muted">Pagina ${page}</span>` : ""}</div>
        ${this.busy && !this.catalog ? `<div class="catalog-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : noResults ? `<div class="empty-state"><span>${icon("search", { size: 28 })}</span><h3>Nessun risultato</h3><p>Prova una ricerca più ampia oppure rimuovi alcuni filtri.</p><button type="button" data-clear-catalog>Mostra tutto il catalogo</button></div>` : `<div class="catalog-grid">${cards}</div>`}
        ${total ? `<nav class="pagination" aria-label="Pagine del catalogo"><button type="button" data-catalog-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>${icon("arrowLeft", { size: 14 })} Precedente</button><span>Pagina ${page}</span><button type="button" data-catalog-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva ${icon("chevron", { size: 14 })}</button></nav>` : ""}
      </section>
    </main>`;
  }
}

customElements.define("artaround-catalog-view", ArtAroundCatalogView);
