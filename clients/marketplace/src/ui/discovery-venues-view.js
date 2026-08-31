import { navigate } from "../application/router.js";
import { QueryState } from "../application/query-state.js";
import { ResourceBrowserController } from "../application/resource-browser-controller.js";
import { discoveryRepository } from "../infrastructure/http/discovery-repository.js";
import { icon } from "./icons.js";
import { renderExploreNavigation } from "./explore-navigation.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
class DiscoveryQueryState extends QueryState {
  constructor({ q = "", page = 1 } = {}) { super({ query: String(q || ""), page, pageSize: 12 }); }
  get q() { return this.query; }
}
function state() {
  const p = new URLSearchParams(window.location.search);
  return new DiscoveryQueryState({ q: p.get("q") || "", page: Math.max(1, Number(p.get("page")) || 1) });
}

export class ArtAroundDiscoveryVenuesView extends HTMLElement {
  state = state();
  data = null;
  busy = false;
  error = null;
  browser = new ResourceBrowserController({
    queryState: this.state,
    load: async ({ query, page }) => {
      const data = await discoveryRepository.venues({ q: query, page });
      this.state.page = Math.max(1, Number(data?.page) || page);
      return { ...data, items: Array.isArray(data?.results) ? data.results : [] };
    },
    onStateChange: (browserState) => {
      this.busy = browserState.loading;
      this.error = browserState.error;
      if (browserState.result) this.data = browserState.result;
      if (this.isConnected) this.render();
    },
  });

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.browser.dispose();
  }

  async load() { await this.browser.refresh(); }

  go(patch) {
    const next = { q: patch.q ?? this.state.q, page: patch.page ?? this.state.page };
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.page > 1) p.set("page", String(next.page));
    navigate(`/venues${p.toString() ? `?${p}` : ""}`);
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    this.go({ q: String(data.get("q") || "").trim(), page: 1 });
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const venue = target?.closest("[data-public-venue]");
    if (venue) { navigate(`/venues/public?venueId=${encodeURIComponent(venue.dataset.publicVenue)}`); return; }
    const page = target?.closest("button[data-page]");
    if (page) this.go({ page: Number(page.dataset.page) || 1 });
  };

  render() {
    const results = this.data?.results || [];
    const total = Number(this.data?.total || 0);
    const pageSize = Number(this.data?.pageSize || 12);
    this.innerHTML = `<main class="page discovery-directory" aria-busy="${this.busy}">${renderExploreNavigation("venues")}<header class="page-header"><div><span class="eyebrow">Esplora ArtAround</span><h1>Musei e sedi</h1><p>Trova luoghi configurati e pubblicati dalle organizzazioni presenti in ArtAround.</p></div></header><form class="panel inline-form" role="search"><label>Cerca sedi<input name="q" value="${escapeHtml(this.state.q)}" placeholder="Nome o descrizione"></label><button>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section><div class="section-heading"><h2>Risultati</h2><span class="count">${total}</span></div>${this.busy && !this.data ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div></div>` : results.length ? `<div class="discovery-grid">${results.map((entry) => `<button class="discovery-card" type="button" data-public-venue="${escapeHtml(entry.id)}"><span class="resource-mark">${icon("museum", { size: 20 })}</span><span><small>${escapeHtml(entry.organization.name)}</small><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.description || "Sede culturale")}</small></span>${icon("chevron", { size: 15 })}</button>`).join("")}</div>` : `<div class="empty-state"><h3>Nessuna sede trovata</h3><p>Prova a cambiare la ricerca.</p></div>`}</section>${total > pageSize ? `<nav class="pagination"><button type="button" data-page="${this.state.page - 1}" ${this.state.page <= 1 ? "disabled" : ""}>Precedente</button><span>Pagina ${this.state.page}</span><button type="button" data-page="${this.state.page + 1}" ${this.state.page * pageSize >= total ? "disabled" : ""}>Successiva</button></nav>` : ""}</main>`;
  }
}

customElements.define("artaround-discovery-venues-view", ArtAroundDiscoveryVenuesView);
