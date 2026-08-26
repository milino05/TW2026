import { readOperatingContext, operatingPrincipal } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function roleLabel(role) { return role === "manager" ? "Manager" : role === "operator" ? "Operatore" : ""; }

export class ArtAroundHomeView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  owned = null;
  licensed = null;
  organization = null;
  busy = false;
  error = null;

  connectedCallback() { this.load(); }

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const base = [
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.workspaceResources(principal, { ownership: "owned", page: 1, limit: 4 }),
        marketplaceRepository.workspaceResources(principal, { ownership: "licensed", page: 1, limit: 4 }),
      ];
      const [workspaceContext, owned, licensed, organization] = await Promise.all([
        ...base,
        this.context.type === "organization" ? managementRepository.organization(this.context.id, { limit: 4 }) : Promise.resolve(null),
      ]);
      this.workspaceContext = workspaceContext;
      this.owned = owned;
      this.licensed = licensed;
      this.organization = organization;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Home non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  renderOrganizationSummary() {
    if (!this.organization) return "";
    const venues = this.organization.venues?.results || [];
    return `<section class="home-section"><div class="section-heading"><div><span class="eyebrow">Organizzazione</span><h2>Sedi e collaborazione</h2></div><a class="button-link secondary" data-route href="/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}">Gestisci organizzazione</a></div><div class="home-metrics"><a data-route href="/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=venues"><strong>${Number(this.organization.venues?.total || 0)}</strong><span>Sedi</span></a><a data-route href="/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=people"><strong>${Number(this.organization.members?.total || 0)}</strong><span>Persone</span></a><a data-route href="/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=rules"><strong>${Number(this.organization.namespaces?.total || 0)}</strong><span>Regole editoriali</span></a></div>${venues.length ? `<div class="home-venue-list">${venues.map((venue) => `<a data-route href="/venues/editor?venueId=${encodeURIComponent(venue.id)}"><span>${icon("building", { size: 18 })}</span><span><strong>${escapeHtml(venue.name)}</strong><small>${escapeHtml(venue.description || "Gestisci sede e spazi fisici")}</small></span>${icon("chevron", { size: 15 })}</a>`).join("")}</div>` : `<div class="empty-state compact"><h3>Nessuna sede ancora</h3><p>Crea la prima sede dalla gestione dell'organizzazione.</p></div>`}</section>`;
  }

  render() {
    const contextName = this.context?.name || "ArtAround";
    const personal = this.context?.type !== "organization";
    const ownedTotal = Number(this.owned?.total || 0);
    const licensedTotal = Number(this.licensed?.total || 0);
    this.innerHTML = `<main class="home-page" aria-busy="${this.busy}"><header class="home-hero"><div><span class="eyebrow">${personal ? "Area personale" : `Organizzazione · ${escapeHtml(roleLabel(this.context?.role))}`}</span><h1>${personal ? `Ciao, ${escapeHtml(contextName)}` : escapeHtml(contextName)}</h1><p>${personal ? "Crea, organizza e pubblica le tue esperienze culturali da un unico punto." : "Gestisci contenuti, visite, sedi e attività Marketplace dell'organizzazione."}</p></div><a class="button-link" data-route href="/create">${icon("plus", { size: 16 })} Crea</a></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="home-actions" aria-label="Azioni principali"><a class="home-action-card" data-route href="/workspace"><span>${icon("workspace", { size: 22 })}</span><strong>Libreria</strong><small>${ownedTotal} di proprietà · ${licensedTotal} acquisite</small></a><a class="home-action-card" data-route href="/workspace?resourceType=visit"><span>${icon("route", { size: 22 })}</span><strong>Visite</strong><small>Progetta e gestisci le sequenze per il Navigator.</small></a><a class="home-action-card" data-route href="/catalog"><span>${icon("catalog", { size: 22 })}</span><strong>Catalogo</strong><small>Trova contenuti e visite da aggiungere a questa area.</small></a><a class="home-action-card" data-route href="/acquisitions"><span>${icon("store", { size: 22 })}</span><strong>Marketplace</strong><small>Controlla acquisizioni, licenze e vendite.</small></a></section>${this.context?.type === "organization" ? this.renderOrganizationSummary() : ""}<section class="home-section"><div class="section-heading"><div><span class="eyebrow">Continua il lavoro</span><h2>Risorse recenti</h2></div><a data-route href="/workspace">Apri tutta la libreria ${icon("chevron", { size: 14 })}</a></div>${this.busy && !this.owned ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : (this.owned?.results || []).length ? `<div class="home-resource-list">${this.owned.results.map((asset) => `<a data-route href="/workspace/resource?resourceType=${encodeURIComponent(asset.resourceType)}&resourceId=${encodeURIComponent(asset.resourceId)}&ownership=owned"><span class="resource-mark">${icon(String(asset.resourceType).startsWith("visit") ? "route" : "book", { size: 18 })}</span><span><strong>${escapeHtml(asset.title)}</strong><small>${escapeHtml(asset.summary || asset.state || "Risorsa")}</small></span>${icon("chevron", { size: 14 })}</a>`).join("")}</div>` : `<div class="empty-state compact"><h3>Nessuna risorsa ancora</h3><p>Inizia creando un contenuto o una visita.</p><a class="button-link" data-route href="/create">Crea la prima risorsa</a></div>`}</section></main>`;
  }
}

customElements.define("artaround-home-view", ArtAroundHomeView);
