import { navigate } from "../application/router.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function queryState() {
  const params = new URLSearchParams(window.location.search);
  return { principalType: params.get("principalType") || "user", principalId: params.get("principalId") || null };
}
function principalQuery(state) {
  const params = new URLSearchParams({ principalType: state.principalType });
  if (state.principalId) params.set("principalId", state.principalId);
  return params.toString();
}

export class ArtAroundCreateHubView extends HTMLElement {
  context = null;
  preflight = null;
  venues = null;
  busy = false;
  error = null;
  state = queryState();

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); }
  principal() { return { principalType: this.state.principalType, principalId: this.state.principalId }; }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const [context, preflight, venues] = await Promise.all([
        marketplaceRepository.workspaceContext(this.principal()),
        marketplaceRepository.authoringPreflight(this.principal()),
        marketplaceRepository.venueSelector(),
      ]);
      this.context = context;
      this.preflight = preflight;
      this.venues = venues;
      this.state.principalType = context.principal.type;
      this.state.principalId = String(context.principal.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare gli strumenti di creazione";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.matches("[data-principal]")) {
      const [principalType, principalId] = String(data.get("principal") || "").split(":");
      if (!principalType || !principalId) return;
      navigate(`/create?principalType=${encodeURIComponent(principalType)}&principalId=${encodeURIComponent(principalId)}`);
      return;
    }
    if (form.matches("[data-venue-content]")) {
      const venueId = String(data.get("venueId") || "");
      if (venueId && this.preflight?.content?.allowed) navigate(`/workspace/venue-targets?venueId=${encodeURIComponent(venueId)}&${principalQuery(this.state)}`);
    }
  };

  renderPrincipal() {
    const options = (this.context?.availablePrincipals || []).map((entry) => {
      const selected = entry.type === this.state.principalType && String(entry.id) === String(this.state.principalId);
      const role = entry.type === "organization" && entry.role ? ` · ${entry.role}` : "";
      return `<option value="${escapeHtml(`${entry.type}:${entry.id}`)}" ${selected ? "selected" : ""}>${escapeHtml(entry.name)}${escapeHtml(role)}</option>`;
    }).join("");
    return `<form data-principal class="principal working-context surface"><label><span>Stai lavorando per</span><select name="principal">${options}</select></label><button class="button-secondary" type="submit">Cambia</button></form>`;
  }

  remediationHref() {
    const content = this.preflight?.content;
    const configurable = (content?.needsConfiguration || []).find((entry) => entry.source === "owned");
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.state.principalType === "organization" && this.state.principalId) {
      return `/organizations/detail?organizationId=${encodeURIComponent(this.state.principalId)}#organization-namespaces`;
    }
    return "/profile";
  }

  blockerCard({ physical = false } = {}) {
    const blocker = this.preflight?.content?.blockers?.[0];
    return `<article class="panel create-choice blocked"><span class="resource-mark">${icon("warning", { size: 21 })}</span><div><span class="eyebrow">${physical ? "Oggetto della sede" : "Contenuto"}</span><h2>Prima prepara le regole editoriali</h2><p>${escapeHtml(blocker?.message || "Manca una configurazione editoriale utilizzabile.")}</p><p class="note">Non verrà creato alcun contenuto finché questo prerequisito non è risolto.</p></div><a class="button-link" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderContentCard() {
    const content = this.preflight?.content;
    if (!content?.allowed) return this.blockerCard();
    return `<article class="panel create-choice"><span class="resource-mark">${icon("book", { size: 21 })}</span><div><span class="eyebrow">Contenuto</span><h2>Scrivi un nuovo contenuto</h2><p>Parti da un'opera, una persona, uno stile o un altro soggetto e crea le varianti editoriali necessarie.</p><p class="note">${content.usableNamespaceCount} ${content.usableNamespaceCount === 1 ? "insieme di regole editoriali disponibile" : "insiemi di regole editoriali disponibili"}.</p></div><a class="button-link" data-route href="/workspace/item-authoring?${principalQuery(this.state)}">Crea contenuto ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderVisitCard() {
    return `<article class="panel create-choice"><span class="resource-mark">${icon("route", { size: 21 })}</span><div><span class="eyebrow">Visita</span><h2>Progetta una visita</h2><p>Organizza contenuti, tappe e preferenze in una sequenza pronta per il Navigator.</p></div><a class="button-link" data-route href="/workspace/visit-authoring?${principalQuery(this.state)}">Crea visita ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderVenueCard() {
    if (!this.preflight?.content?.allowed) return this.blockerCard({ physical: true });
    const groups = this.venues?.organizations || [];
    const options = groups.flatMap((organization) => (organization.venues || []).map((venue) => ({
      id: venue.id,
      name: venue.name,
      organization: organization.name,
    })));
    if (!options.length) {
      const href = this.state.principalType === "organization" && this.state.principalId
        ? `/organizations/detail?organizationId=${encodeURIComponent(this.state.principalId)}#organization-venues`
        : "/profile";
      return `<article class="panel create-choice"><span class="resource-mark">${icon("museum", { size: 21 })}</span><div><span class="eyebrow">Oggetto della sede</span><h2>Crea contenuto per un oggetto fisico</h2><p>Non ci sono ancora sedi disponibili da cui scegliere un oggetto.</p></div><a class="button-link secondary" data-route href="${escapeHtml(href)}">Gestisci sedi ${icon("chevron", { size: 15 })}</a></article>`;
    }
    return `<article class="panel create-choice"><span class="resource-mark">${icon("museum", { size: 21 })}</span><div><span class="eyebrow">Oggetto della sede</span><h2>Crea contenuto per un oggetto fisico</h2><p>Scegli prima la sede. Nel passaggio successivo selezionerai l'oggetto e il suo soggetto verrà precompilato.</p><form data-venue-content class="inline-form"><label>Sede<select name="venueId">${options.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.organization)} · ${escapeHtml(venue.name)}</option>`).join("")}</select></label><button type="submit">Scegli oggetto ${icon("chevron", { size: 15 })}</button></form></div></article>`;
  }

  render() {
    if (this.busy && !this.context) {
      this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Controllo dei prerequisiti…</p></div></main>`;
      return;
    }
    if (this.error && !this.context) {
      this.innerHTML = `<main class="page"><div class="empty-state"><h1>Crea</h1><p role="alert">${escapeHtml(this.error)}</p><a class="button-link secondary" data-route href="/workspace">Torna alle mie risorse</a></div></main>`;
      return;
    }
    this.innerHTML = `<style>
      artaround-create-hub-view .create-hub-page{display:grid;gap:1rem;max-width:var(--content);margin:auto;padding:2rem 1rem 5rem}
      artaround-create-hub-view .create-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
      artaround-create-hub-view .create-choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.9rem;align-items:start;padding:1.2rem}
      artaround-create-hub-view .create-choice>.button-link{grid-column:2;justify-self:start}
      artaround-create-hub-view .create-choice h2{margin:.2rem 0}
      artaround-create-hub-view .create-choice p{margin:.35rem 0}
      artaround-create-hub-view .create-choice.blocked{border-color:#e4c28a;background:var(--amber-100)}
      artaround-create-hub-view .create-choice form{margin-top:.8rem}
      @media(max-width:50rem){artaround-create-hub-view .create-choice-grid{grid-template-columns:1fr}}
    </style><main class="page create-hub-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Crea</span><h1>Cosa vuoi creare?</h1><p>Scegli un obiettivo. ArtAround mostra solo i passaggi e i prerequisiti necessari per completarlo.</p></div></header>${this.renderPrincipal()}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="create-choice-grid" aria-label="Tipi di creazione">${this.renderContentCard()}${this.renderVisitCard()}${this.renderVenueCard()}</section><details class="panel technical-details"><summary>Gestione avanzata</summary><div class="button-row"><a class="button-link secondary" data-route href="/workspace?${principalQuery(this.state)}">Le mie risorse e spazi editoriali</a><a class="button-link secondary" data-route href="${escapeHtml(this.remediationHref())}">Regole editoriali</a><a class="button-link secondary" data-route href="/profile">Account e organizzazioni</a></div></details></main>`;
  }
}

customElements.define("artaround-create-hub-view", ArtAroundCreateHubView);