import { readOperatingContext, operatingPrincipal } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { escapeHtml, formatPrice, marketplaceResourceLabel } from "./commercial-utils.js";
import { icon } from "./icons.js";
import { resourceStateLabel } from "./presentation.js";

function roleLabel(roles = []) { return roles.map((role) => role.name).join(" · ") || "Membro"; }

function relativeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86400000);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(date);
}

function authoringHref(asset) {
  const type = String(asset?.authoringRef?.resourceType || "");
  const id = String(asset?.authoringRef?.resourceId || "");
  if (!id) return null;
  if (type === "item") return `/workspace/item-authoring?itemId=${encodeURIComponent(id)}`;
  if (type === "visit") return `/workspace/visit-authoring?visitId=${encodeURIComponent(id)}`;
  if (type === "namespace") return `/namespaces/editor?namespaceId=${encodeURIComponent(id)}`;
  if (type === "physical_vocabulary") return `/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(id)}`;
  if (type === "editorial_context") return `/workspace/context-compose?editorialContextId=${encodeURIComponent(id)}`;
  return null;
}

function resourceDetailHref(asset, ownership = asset?.ownership || "owned") {
  const params = new URLSearchParams({
    resourceType: String(asset?.resourceType || ""),
    resourceId: String(asset?.resourceId || ""),
    ownership,
  });
  return `/workspace/resource?${params.toString()}`;
}

function hasOperation(asset, code) {
  return (asset?.availableOperations || []).some((operation) => operation.code === code);
}

function attentionCopy(asset) {
  const workflow = asset?.editorialWorkflow;
  if (workflow?.status === "changes_requested") return workflow.reviewMessage || "Sono state richieste alcune modifiche.";
  if (workflow?.status === "in_review") {
    if (hasOperation(asset, "workflow.publish")) return "La revisione è pronta per essere approvata e pubblicata.";
    return "La risorsa è in attesa di revisione.";
  }
  if (workflow?.integrityStatus === "needs_review") {
    const count = Number(workflow.issueCount || 0);
    return count ? `Controlla ${count} ${count === 1 ? "aspetto" : "aspetti"} prima di pubblicare.` : "Controlla la consistenza prima di pubblicare.";
  }
  if (hasOperation(asset, "workflow.publish")) return "I controlli sono completi: puoi pubblicare.";
  if (asset?.state === "empty") return "Aggiungi le informazioni necessarie per iniziare.";
  if (["working", "private"].includes(asset?.state)) return "Riprendi la bozza e completa il prossimo passaggio.";
  return asset?.summary || "Apri la risorsa per vedere dettagli e azioni disponibili.";
}

function needsAttention(asset) {
  const workflow = asset?.editorialWorkflow;
  return ["empty", "working", "private"].includes(asset?.state)
    || ["draft", "in_review", "changes_requested"].includes(workflow?.status)
    || workflow?.integrityStatus === "needs_review";
}

function activityCopy(asset) {
  const event = asset?.editorialWorkflow?.lastEvent;
  const actor = event?.actor?.username || asset?.updatedBy?.username || "Il team";
  const actions = {
    review_requested: "ha inviato in revisione",
    review_withdrawn: "ha ritirato dalla revisione",
    changes_requested: "ha richiesto modifiche a",
    published: "ha pubblicato",
  };
  return {
    actor,
    action: event?.action ? (actions[event.action] || "ha aggiornato") : "ha aggiornato",
    at: event?.at || asset?.updatedAt,
  };
}

function resourceIcon(type = "") {
  if (String(type).startsWith("visit")) return "route";
  if (String(type).startsWith("namespace") || String(type).startsWith("physical_vocabulary")) return "book";
  return "catalog";
}

function firstOffer(offers = []) {
  if (!offers.length) return "Non disponibile";
  return formatPrice(offers.find((offer) => offer.pricing?.type === "free")?.pricing || offers[0].pricing);
}

export class ArtAroundHomeView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  owned = null;
  licensed = null;
  organization = null;
  catalog = null;
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
      const [workspaceContext, owned, licensed, organization] = await Promise.all([
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.workspaceResources(principal, { ownership: "owned", page: 1, limit: 8 }),
        marketplaceRepository.workspaceResources(principal, { ownership: "licensed", page: 1, limit: 3 }),
        this.context.type === "organization"
          ? managementRepository.organization(this.context.id, { limit: 6 })
          : Promise.resolve(null),
      ]);
      this.workspaceContext = workspaceContext;
      this.owned = owned;
      this.licensed = licensed;
      this.organization = organization;
      const selectedVenueIds = this.context.type === "organization"
        ? (organization?.venues?.results || []).map((venue) => venue.id)
        : [];
      try {
        this.catalog = await marketplaceRepository.catalog({ selectedVenueIds, page: 1, limit: 3 });
      } catch {
        this.catalog = null;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Home non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  renderResourceCard(asset, { licensed = false } = {}) {
    const editHref = !licensed && hasOperation(asset, "open_editor") ? authoringHref(asset) : null;
    const href = editHref || resourceDetailHref(asset, licensed ? "licensed" : "owned");
    const editable = Boolean(editHref);
    const date = relativeDate(asset.updatedAt);
    const state = licensed ? "Con licenza" : resourceStateLabel(asset.editorialWorkflow?.status || asset.state || "working");
    return `<article class="home-work-card"><header><span class="home-work-card__type">${icon(resourceIcon(asset.resourceType), { size: 16 })}${escapeHtml(marketplaceResourceLabel(asset.resourceType))}</span><span class="status">${escapeHtml(state)}</span></header><h3>${escapeHtml(asset.title || "Risorsa senza titolo")}</h3><p>${escapeHtml(licensed ? (asset.summary || "Disponibile nella tua libreria tramite licenza.") : attentionCopy(asset))}</p><footer><span>${date ? `${licensed ? "Ottenuta" : "Modificata"} ${escapeHtml(date)}` : licensed ? "Disponibile nella libreria" : "Attività recente"}</span><a data-route href="${escapeHtml(href)}">${editable ? "Continua" : "Apri"} ${icon("chevron", { size: 14 })}</a></footer></article>`;
  }

  renderCatalogCard(entry, selectedVenueIds = []) {
    const asset = entry.asset || {};
    const params = new URLSearchParams({ listingId: String(entry.listingId || ""), returnTo: "/home" });
    if (selectedVenueIds.length) params.set("selectedVenueIds", selectedVenueIds.join(","));
    return `<article class="home-catalog-card"><div class="home-catalog-card__cover"><span>${icon(resourceIcon(asset.type), { size: 16 })}${escapeHtml(marketplaceResourceLabel(asset.type))}</span></div><div class="home-catalog-card__body"><h3>${escapeHtml(asset.title || "Risorsa senza titolo")}</h3><p>${escapeHtml(asset.summary || "Nessuna descrizione disponibile.")}</p></div><footer><strong>${escapeHtml(firstOffer(entry.offers || []))}</strong><a data-route href="/catalog/detail?${params.toString()}">Dettagli ${icon("chevron", { size: 14 })}</a></footer></article>`;
  }

  renderCatalogSection({ organization = false } = {}) {
    const entries = this.catalog?.results || [];
    const venues = this.organization?.venues?.results || [];
    const selectedVenueIds = organization ? venues.map((venue) => String(venue.id)) : [];
    const title = organization && selectedVenueIds.length ? "Adatti alle vostre sedi" : "Dal Catalogo";
    const description = organization && selectedVenueIds.length
      ? "Contenuti e visite pertinenti alle sedi visibili in questa organizzazione."
      : "Nuove risorse che puoi acquisire e usare nei tuoi progetti.";
    const catalogHref = selectedVenueIds.length ? `/catalog?selectedVenueIds=${encodeURIComponent(selectedVenueIds.join(","))}` : "/catalog";
    return `<section class="home-section"><div class="section-heading"><div><span class="eyebrow">Da esplorare</span><h2>${title}</h2><p>${description}</p></div><a data-route href="${catalogHref}">Esplora il Catalogo ${icon("chevron", { size: 14 })}</a></div>${this.busy && !this.catalog ? `<div class="home-card-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : entries.length ? `<div class="home-card-grid">${entries.map((entry) => this.renderCatalogCard(entry, selectedVenueIds)).join("")}</div>` : `<div class="empty-state compact"><h3>Nessuna proposta disponibile</h3><p>Il Catalogo non contiene ancora risorse adatte a questa area.</p></div>`}</section>`;
  }

  renderPersonal() {
    const owned = this.owned?.results || [];
    const licensed = this.licensed?.results || [];
    const cards = [
      ...owned.slice(0, licensed.length ? 2 : 3).map((asset) => this.renderResourceCard(asset)),
      ...licensed.slice(0, 1).map((asset) => this.renderResourceCard(asset, { licensed: true })),
    ].join("");
    return `<header class="home-intro"><div><h1>Buongiorno, ${escapeHtml(this.context?.name || "ArtAround")}.</h1><p>${owned.length ? "Riprendi il tuo lavoro oppure scopri nuove risorse per i prossimi progetti." : "Inizia un nuovo progetto oppure scopri risorse già pronte nel Catalogo."}</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="home-section"><div class="section-heading"><div><span class="eyebrow">Area personale</span><h2>Continua il tuo lavoro</h2><p>Le risorse personali più recenti e le ultime licenze disponibili.</p></div><a data-route href="/workspace">Apri tutta la Libreria ${icon("chevron", { size: 14 })}</a></div>${this.busy && !this.owned ? `<div class="home-card-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : cards ? `<div class="home-card-grid">${cards}</div>` : `<div class="empty-state compact"><h3>Qui appariranno le tue attività recenti</h3><p>Crea una risorsa o acquisiscine una dal Catalogo per iniziare.</p></div>`}</section>${this.renderCatalogSection()}`;
  }

  renderOrganizationActivity(assets) {
    const rows = assets.filter((asset) => asset.updatedAt || asset.editorialWorkflow?.lastEvent?.at).slice(0, 3).map((asset) => {
      const activity = activityCopy(asset);
      return `<li><span class="home-activity-avatar">${escapeHtml(activity.actor.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(activity.actor)}</strong><small>${escapeHtml(activity.action)} “${escapeHtml(asset.title)}”${activity.at ? ` · ${escapeHtml(relativeDate(activity.at))}` : ""}</small></span></li>`;
    }).join("");
    return `<section class="home-activity"><div class="section-heading"><div><span class="eyebrow">Team</span><h2>Attività recente</h2><p>Gli ultimi aggiornamenti sulle risorse condivise.</p></div></div>${rows ? `<ul>${rows}</ul>` : `<div class="empty-state compact"><p>Nessuna attività recente da mostrare.</p></div>`}</section>`;
  }

  renderOrganizationVenues() {
    const venues = this.organization?.venues?.results || [];
    const canOpenManagement = new Set((this.organization?.organization?.availableSections || []).map((section) => section.code)).has("venues");
    return `<section class="home-venues"><div class="section-heading"><div><span class="eyebrow">Luoghi</span><h2>Le vostre sedi</h2><p>Sedi disponibili nel contesto organizzativo corrente.</p></div></div>${venues.length ? `<div class="home-venue-list">${venues.map((venue) => `<a data-route href="${canOpenManagement ? `/venues/editor?venueId=${encodeURIComponent(venue.id)}` : `/venues/public?venueId=${encodeURIComponent(venue.id)}`}"><span>${icon("building", { size: 17 })}</span><span><strong>${escapeHtml(venue.name)}</strong><small>${escapeHtml(venue.description || "Apri la sede")}</small></span>${icon("chevron", { size: 14 })}</a>`).join("")}</div>` : `<div class="empty-state compact"><p>Nessuna sede visibile con i permessi attuali.</p></div>`}</section>`;
  }

  renderOrganization() {
    const assets = this.owned?.results || [];
    const attention = assets.filter(needsAttention).slice(0, 3);
    const manageHref = `/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=overview`;
    const attentionCards = attention.map((asset) => this.renderResourceCard(asset)).join("");
    return `<header class="home-intro"><div><span class="eyebrow">Organizzazione · ${escapeHtml(roleLabel(this.context?.roles))}${this.context?.isOwner ? " · Owner" : ""}</span><h1>${escapeHtml(this.context?.name || "Organizzazione")}</h1><p>${attention.length ? `${attention.length} ${attention.length === 1 ? "attività richiede" : "attività richiedono"} attenzione in questa area.` : "Il lavoro condiviso è aggiornato. Puoi esplorare nuove risorse per le vostre sedi."}</p></div><a class="home-manage-organization" data-route href="${manageHref}">Gestisci organizzazione ${icon("chevron", { size: 14 })}</a></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<div class="home-organization-layout"><div class="home-organization-main"><section class="home-section"><div class="section-heading"><div><span class="eyebrow">Lavoro condiviso</span><h2>Da completare</h2><p>Risorse che attendono un controllo, una revisione o la pubblicazione.</p></div><a data-route href="/workspace">Tutto il lavoro ${icon("chevron", { size: 14 })}</a></div>${this.busy && !this.owned ? `<div class="home-card-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : attentionCards ? `<div class="home-card-grid">${attentionCards}</div>` : `<div class="empty-state compact"><h3>Nessuna attività aperta</h3><p>Le risorse recenti non richiedono interventi.</p></div>`}</section>${this.renderCatalogSection({ organization: true })}</div><aside class="home-organization-side">${this.renderOrganizationVenues()}${this.renderOrganizationActivity(assets)}</aside></div>`;
  }

  render() {
    const organization = this.context?.type === "organization";
    this.innerHTML = `<main class="home-page" aria-busy="${this.busy}">${organization ? this.renderOrganization() : this.renderPersonal()}</main>`;
  }
}

customElements.define("artaround-home-view", ArtAroundHomeView);
