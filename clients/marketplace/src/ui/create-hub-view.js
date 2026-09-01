import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundCreateHubView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  preflight = null;
  busy = false;
  error = null;

  connectedCallback() { this.load(); }
  principal() { return operatingPrincipal(this.context); }

  async load() {
    const principal = this.principal();
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      [this.workspaceContext, this.preflight] = await Promise.all([
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.authoringPreflight(principal),
      ]);
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile preparare gli strumenti di creazione"; }
    finally { this.busy = false; this.render(); }
  }

  remediationHref() {
    const configurable = (this.preflight?.content?.needsConfiguration || []).find((entry) => entry.source === "owned");
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.context?.type === "organization" && this.context?.id) return `/organizations/detail?organizationId=${encodeURIComponent(this.context.id)}&section=rules`;
    return "/profile#account-rules";
  }

  blockedCard({ eyebrow, title, message, iconName = "warning" }) {
    return `<article class="panel create-choice blocked"><span class="resource-mark">${icon(iconName, { size: 21 })}</span><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div><a class="button-link secondary" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderContentCard() {
    const content = this.preflight?.content;
    if (!this.preflight?.capabilities?.contentCreate) return "";
    if (!content?.allowed) return this.blockedCard({ eyebrow: "Contenuto", title: "Prima prepara le regole editoriali", message: content?.blockers?.[0]?.message || "Manca una configurazione editoriale utilizzabile.", iconName: "book" });
    return `<article class="panel create-choice"><span class="resource-mark">${icon("book", { size: 21 })}</span><div><span class="eyebrow">Contenuto</span><h2>Crea un contenuto</h2><p>Parti dal Subject di cui vuoi parlare. La presenza nelle sedi verrà mostrata nel contesto del Subject, senza obbligarti a scegliere prima un inventario.</p><p class="note">${content.usableNamespaceCount} ${content.usableNamespaceCount === 1 ? "insieme di regole editoriali disponibile" : "insiemi di regole editoriali disponibili"}.</p></div><a class="button-link" data-route href="/workspace/item-authoring">Crea contenuto ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderCollectionCard() {
    const collection = this.preflight?.collection;
    if (!this.preflight?.capabilities?.editorialCollectionCreate) return "";
    if (!collection?.allowed) return this.blockedCard({ eyebrow: "Raccolta editoriale", title: "La raccolta richiede regole utilizzabili", message: collection?.blockers?.[0]?.message || "Mancano le regole editoriali necessarie.", iconName: "link" });
    return `<article class="panel create-choice"><span class="resource-mark">${icon("link", { size: 21 })}</span><div><span class="eyebrow">Raccolta editoriale</span><h2>Organizza contenuti e semantica</h2><p>Definisci un contesto curatoriale con un proprio Namespace, una composizione di contenuti e un grafo semantico fra Subject.</p><p class="note">Se non hai ancora uno spazio editoriale, ArtAround può crearlo insieme alla raccolta.</p></div><a class="button-link" data-route href="/workspace/editorial-collection-new">Crea raccolta ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderVisitCard() {
    if (!this.preflight?.capabilities?.visitCreate) return "";
    return `<article class="panel create-choice"><span class="resource-mark">${icon("route", { size: 21 })}</span><div><span class="eyebrow">Visita</span><h2>Progetta una visita</h2><p>Organizza contenuti, tappe e preferenze in una sequenza pronta per il Navigator.</p></div><a class="button-link" data-route href="/workspace/visit-authoring">Crea visita ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderEditorialManagement() {
    if (!this.preflight?.capabilities?.editorialSpaceManage && !this.preflight?.capabilities?.editorialCollectionCreate) return "";
    return `<aside class="panel editorial-management"><div><span class="eyebrow">Gestione editoriale</span><h2>Spazi editoriali</h2><p>Esplora gli Item namespace-neutral, le raccolte che li usano e il loro stato di pubblicazione.</p></div><a class="button-link secondary" data-route href="/workspace/editorial-spaces">Apri spazi editoriali ${icon("chevron", { size: 15 })}</a></aside>`;
  }

  render() {
    if (this.busy && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Controllo dei prerequisiti…</p></div></main>`; return; }
    if (this.error && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Crea</h1><p role="alert">${escapeHtml(this.error)}</p><a class="button-link secondary" data-route href="/workspace">Torna alla Libreria</a></div></main>`; return; }
    const choices = `${this.renderContentCard()}${this.renderCollectionCard()}${this.renderVisitCard()}`;
    const noCapabilities = !choices ? `<div class="empty-state"><span>${icon("lock", { size: 26 })}</span><h2>Nessuno strumento di creazione disponibile</h2><p>I ruoli assegnati consentono la consultazione, ma non la creazione. Un responsabile può aggiornare i ruoli dalla gestione dell'organizzazione.</p></div>` : "";
    this.innerHTML = `<style>
      artaround-create-hub-view .create-hub-page{display:grid;gap:1rem;max-width:var(--content);margin:auto;padding:2rem 1rem 5rem}
      artaround-create-hub-view .create-choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
      artaround-create-hub-view .create-choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.9rem;align-items:start;padding:1.2rem}
      artaround-create-hub-view .create-choice>.button-link{grid-column:2;justify-self:start}
      artaround-create-hub-view .create-choice h2,artaround-create-hub-view .editorial-management h2{margin:.2rem 0}
      artaround-create-hub-view .create-choice p,artaround-create-hub-view .editorial-management p{margin:.35rem 0}
      artaround-create-hub-view .create-choice.blocked{border-color:#e4c28a;background:var(--amber-100)}
      artaround-create-hub-view .editorial-management{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:.5rem}
      @media(max-width:68rem){artaround-create-hub-view .create-choice-grid{grid-template-columns:1fr 1fr}}
      @media(max-width:46rem){artaround-create-hub-view .create-choice-grid{grid-template-columns:1fr}artaround-create-hub-view .editorial-management{align-items:flex-start;flex-direction:column}}
    </style><main class="page create-hub-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Crea</span><h1>Cosa vuoi creare?</h1><p>Scegli l'obiettivo editoriale. ArtAround conserva automaticamente l'area di lavoro corrente; inventario e semantica compaiono soltanto quando sono pertinenti.</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${choices ? `<section class="create-choice-grid" aria-label="Tipi di creazione">${choices}</section>` : noCapabilities}${this.renderEditorialManagement()}</main>`;
  }
}
customElements.define("artaround-create-hub-view", ArtAroundCreateHubView);
