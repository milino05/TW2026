import { navigate } from "../application/router.js";
import { discoveryRepository } from "../infrastructure/http/discovery-repository.js";
import { icon } from "./icons.js";
import { renderExploreNavigation } from "./explore-navigation.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function state() { const p = new URLSearchParams(window.location.search); return { q: p.get("q") || "", page: Math.max(1, Number(p.get("page")) || 1) }; }

export class ArtAroundDiscoveryOrganizationsView extends HTMLElement {
  state = state();
  data = null;
  busy = false;
  error = null;

  connectedCallback() { this.addEventListener("submit", this.onSubmit); this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); this.removeEventListener("click", this.onClick); }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try { this.data = await discoveryRepository.organizations(this.state); }
    catch (error) { this.error = error instanceof Error ? error.message : "Organizzazioni non disponibili"; }
    finally { this.busy = false; this.render(); }
  }

  go(patch) {
    const next = { ...this.state, ...patch };
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.page > 1) p.set("page", String(next.page));
    navigate(`/organizations${p.toString() ? `?${p}` : ""}`);
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
    const card = target?.closest("[data-public-organization]");
    if (card) { navigate(`/organizations/public?organizationId=${encodeURIComponent(card.dataset.publicOrganization)}`); return; }
    const page = target?.closest("button[data-page]");
    if (page) this.go({ page: Number(page.dataset.page) || 1 });
  };

  render() {
    const results = this.data?.results || [];
    const total = Number(this.data?.total || 0);
    const pageSize = Number(this.data?.pageSize || 12);
    this.innerHTML = `<main class="page discovery-directory" aria-busy="${this.busy}">${renderExploreNavigation("organizations")}<header class="page-header"><div><span class="eyebrow">Esplora ArtAround</span><h1>Organizzazioni</h1><p>Trova musei, fondazioni e altri enti culturali presenti in ArtAround.</p></div></header><form class="panel inline-form" role="search"><label>Cerca organizzazioni<input name="q" value="${escapeHtml(this.state.q)}" placeholder="Nome o descrizione"></label><button>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section><div class="section-heading"><h2>Risultati</h2><span class="count">${total}</span></div>${this.busy && !this.data ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div></div>` : results.length ? `<div class="discovery-grid">${results.map((entry) => `<button class="discovery-card" type="button" data-public-organization="${escapeHtml(entry.id)}"><span class="resource-mark">${icon("building", { size: 20 })}</span><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.description || "Organizzazione culturale")}</small><span>${entry.counts.venues} sedi · ${entry.counts.publications} pubblicazioni</span></span>${icon("chevron", { size: 15 })}</button>`).join("")}</div>` : `<div class="empty-state"><h3>Nessuna organizzazione trovata</h3><p>Prova a cambiare la ricerca.</p></div>`}</section>${total > pageSize ? `<nav class="pagination"><button type="button" data-page="${this.state.page - 1}" ${this.state.page <= 1 ? "disabled" : ""}>Precedente</button><span>Pagina ${this.state.page}</span><button type="button" data-page="${this.state.page + 1}" ${this.state.page * pageSize >= total ? "disabled" : ""}>Successiva</button></nav>` : ""}</main>`;
  }
}

customElements.define("artaround-discovery-organizations-view", ArtAroundDiscoveryOrganizationsView);
