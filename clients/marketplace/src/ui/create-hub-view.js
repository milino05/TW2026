import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundCreateHubView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  preflight = null;
  venues = null;
  busy = false;
  error = null;

  connectedCallback() { this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); }
  principal() { return operatingPrincipal(this.context); }

  async load() {
    const principal = this.principal();
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [workspaceContext, preflight] = await Promise.all([
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.authoringPreflight(principal),
      ]);
      const venues = this.context?.type === "organization" && preflight?.capabilities?.venueObjectContentCreate
        ? await marketplaceRepository.venueSelector()
        : { organizations: [] };
      this.workspaceContext = workspaceContext; this.preflight = preflight; this.venues = venues;
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile preparare gli strumenti di creazione"; }
    finally { this.busy = false; this.render(); }
  }

  organizationVenues() {
    if (this.context?.type !== "organization") return [];
    const currentOrganizationId = String(this.context.id || "");
    return (this.venues?.organizations || [])
      .filter((organization) => String(organization.id || organization._id || "") === currentOrganizationId)
      .flatMap((organization) => (organization.venues || []).map((venue) => ({ id: String(venue.id || venue._id || ""), name: venue.name })))
      .filter((venue) => venue.id);
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-create-item]")) {
      event.preventDefault();
      if (!this.preflight?.content?.allowed) return;
      const venueId = String(new FormData(form).get("venueId") || "");
      navigate(`/workspace/item-authoring${venueId ? `?venueId=${encodeURIComponent(venueId)}` : ""}`);
      return;
    }
    if (!form.matches("[data-venue-content]")) return;
    event.preventDefault();
    const data = new FormData(form);
    const venueId = String(data.get("venueId") || "");
    if (venueId && this.preflight?.content?.allowed) navigate(`/workspace/venue-targets?venueId=${encodeURIComponent(venueId)}`);
  };

  remediationHref() {
    const content = this.preflight?.content;
    const configurable = (content?.needsConfiguration || []).find((entry) => entry.source === "owned");
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.context?.type === "organization" && this.context?.id) return `/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=rules`;
    return "/profile#account-rules";
  }

  blockerCard() {
    const blocker = this.preflight?.content?.blockers?.[0];
    return `<article class="panel create-choice blocked"><span class="resource-mark">${icon("warning", { size: 21 })}</span><div><span class="eyebrow">Contenuto</span><h2>Prima prepara le regole editoriali</h2><p>${escapeHtml(blocker?.message || "Manca una configurazione editoriale utilizzabile.")}</p><p class="note">Non verrà creato alcun contenuto finché questo prerequisito non è risolto.</p></div><a class="button-link" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderContentCard() {
    if (!this.preflight?.capabilities?.contentCreate) return "";
    const content = this.preflight?.content;
    if (!content?.allowed) return this.blockerCard();
    const note = `${content.usableNamespaceCount} ${content.usableNamespaceCount === 1 ? "insieme di regole editoriali disponibile" : "insiemi di regole editoriali disponibili"}.`;
    if (this.context?.type !== "organization") {
      return `<article class="panel create-choice"><span class="resource-mark">${icon("book", { size: 21 })}</span><div><span class="eyebrow">Contenuto</span><h2>Scrivi un nuovo contenuto</h2><p>Parti da un'opera, una persona, uno stile o un altro soggetto e crea le varianti editoriali necessarie.</p><p class="note">${note}</p></div><a class="button-link" data-route href="/workspace/item-authoring">Crea contenuto ${icon("chevron", { size: 15 })}</a></article>`;
    }
    const venues = this.organizationVenues();
    const options = venues.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</option>`).join("");
    return `<article class="panel create-choice"><span class="resource-mark">${icon("book", { size: 21 })}</span><div><span class="eyebrow">Contenuto</span><h2>Scrivi un nuovo contenuto</h2><p>Indica la sede per cui stai preparando il contenuto quando ne esiste una. Questo permette di riconoscere subito le entità già inventariate e, se necessario, aggiungere il soggetto all'inventario corretto.</p><p class="note">${note}</p><form data-create-item class="inline-form"><label>Sede di riferimento<select name="venueId"><option value="">Nessuna sede specifica</option>${options}</select></label><button type="submit">Crea contenuto ${icon("chevron", { size: 15 })}</button></form>${!venues.length ? `<p class="note">L'organizzazione non ha ancora sedi disponibili: puoi comunque creare un contenuto generale.</p>` : ""}</div></article>`;
  }

  renderVisitCard() {
    if (!this.preflight?.capabilities?.visitCreate) return "";
    return `<article class="panel create-choice"><span class="resource-mark">${icon("route", { size: 21 })}</span><div><span class="eyebrow">Visita</span><h2>Progetta una visita</h2><p>Organizza contenuti, tappe e preferenze in una sequenza pronta per il Navigator.</p></div><a class="button-link" data-route href="/workspace/visit-authoring">Crea visita ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderVenueCard() {
    if (!this.preflight?.capabilities?.venueObjectContentCreate || this.context?.type !== "organization") return "";
    if (!this.preflight?.content?.allowed) return "";
    const options = this.organizationVenues();
    if (!options.length) {
      const href = `/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=venues`;
      return `<article class="panel create-choice"><span class="resource-mark">${icon("museum", { size: 21 })}</span><div><span class="eyebrow">Entità della sede</span><h2>Crea contenuto partendo dall'inventario</h2><p>Non ci sono ancora sedi disponibili da cui scegliere un'entità.</p></div><a class="button-link secondary" data-route href="${escapeHtml(href)}">Gestisci sedi ${icon("chevron", { size: 15 })}</a></article>`;
    }
    return `<article class="panel create-choice"><span class="resource-mark">${icon("museum", { size: 21 })}</span><div><span class="eyebrow">Entità della sede</span><h2>Crea contenuto partendo dall'inventario</h2><p>Scegli prima la sede. Nel passaggio successivo selezionerai un'entità già presente o ne preparerai una nuova e il Subject verrà precompilato.</p><form data-venue-content class="inline-form"><label>Sede<select name="venueId">${options.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</option>`).join("")}</select></label><button type="submit">Scegli entità ${icon("chevron", { size: 15 })}</button></form></div></article>`;
  }

  render() {
    if (this.busy && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:12rem"></div><p>Controllo dei prerequisiti…</p></div></main>`; return; }
    if (this.error && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Crea</h1><p role="alert">${escapeHtml(this.error)}</p><a class="button-link secondary" data-route href="/workspace">Torna alla libreria</a></div></main>`; return; }
    const choices = `${this.renderContentCard()}${this.renderVisitCard()}${this.renderVenueCard()}`;
    const noCapabilities = !choices ? `<div class="empty-state"><span>${icon("lock", { size: 26 })}</span><h2>Nessuno strumento di creazione disponibile</h2><p>I ruoli assegnati in questa organizzazione consentono la consultazione, ma non la creazione. Un responsabile può aggiornare i tuoi ruoli dalla sezione Persone.</p></div>` : "";
    this.innerHTML = `<style>artaround-create-hub-view .create-hub-page{display:grid;gap:1rem;max-width:var(--content);margin:auto;padding:2rem 1rem 5rem}artaround-create-hub-view .create-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}artaround-create-hub-view .create-choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.9rem;align-items:start;padding:1.2rem}artaround-create-hub-view .create-choice>.button-link{grid-column:2;justify-self:start}artaround-create-hub-view .create-choice h2{margin:.2rem 0}artaround-create-hub-view .create-choice p{margin:.35rem 0}artaround-create-hub-view .create-choice.blocked{border-color:#e4c28a;background:var(--amber-100)}artaround-create-hub-view .create-choice form{margin-top:.8rem;display:grid;gap:.65rem}artaround-create-hub-view .create-choice form button{justify-self:start}@media(max-width:50rem){artaround-create-hub-view .create-choice-grid{grid-template-columns:1fr}}</style><main class="page create-hub-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Crea</span><h1>Cosa vuoi creare?</h1><p>Scegli un obiettivo. La nuova risorsa appartiene automaticamente all'area di lavoro selezionata dopo il login.</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${choices ? `<section class="create-choice-grid" aria-label="Tipi di creazione">${choices}</section>` : noCapabilities}</main>`;
  }
}
customElements.define("artaround-create-hub-view", ArtAroundCreateHubView);
