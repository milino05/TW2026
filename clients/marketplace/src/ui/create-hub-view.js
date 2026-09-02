import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundCreateHubView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  preflight = null;
  relationChoices = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); }
  principal() { return operatingPrincipal(this.context); }
  relationMode() { return new URLSearchParams(window.location.search).get("mode") === "relations"; }
  relationQuery() { return String(new URLSearchParams(window.location.search).get("q") || ""); }
  relationPage() { return Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1); }

  async load() {
    const principal = this.principal();
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      [this.workspaceContext, this.preflight] = await Promise.all([
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.authoringPreflight(principal),
      ]);
      if (this.relationMode() && this.preflight?.relations?.allowed) {
        this.relationChoices = await editorialRepository.relationChoices({
          ownerType: this.context.type,
          ownerId: this.context.id,
          q: this.relationQuery(),
          page: this.relationPage(),
          limit: 12,
        });
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile preparare gli strumenti di creazione"; }
    finally { this.busy = false; this.render(); }
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-relation-search]")) return;
    event.preventDefault();
    const q = String(new FormData(form).get("q") || "").trim();
    const params = new URLSearchParams({ mode: "relations" });
    if (q) params.set("q", q);
    navigate(`/create?${params.toString()}`);
  };

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

  renderVisitCard() {
    if (!this.preflight?.capabilities?.visitCreate) return "";
    return `<article class="panel create-choice"><span class="resource-mark">${icon("route", { size: 21 })}</span><div><span class="eyebrow">Visita</span><h2>Progetta una visita</h2><p>Organizza contenuti, tappe e preferenze in una sequenza pronta per il Navigator.</p></div><a class="button-link" data-route href="/workspace/visit-authoring">Crea visita ${icon("chevron", { size: 15 })}</a></article>`;
  }

  renderRelationsCard() {
    if (!this.preflight?.capabilities?.semanticGraphEdit) return "";
    return `<article class="panel create-choice"><span class="resource-mark">${icon("link", { size: 21 })}</span><div><span class="eyebrow">Relazioni</span><h2>Collega soggetti</h2><p>Definisci come opere, persone, luoghi e altri soggetti sono collegati nel grafo semantico usato dalle raccolte.</p></div><a class="button-link" data-route href="/create?mode=relations">Scegli la raccolta ${icon("chevron", { size: 15 })}</a></article>`;
  }

  relationHref(page) {
    const params = new URLSearchParams({ mode: "relations" });
    if (this.relationQuery()) params.set("q", this.relationQuery());
    if (page > 1) params.set("page", String(page));
    return `/create?${params.toString()}`;
  }

  renderRelationChoice(choice) {
    const graph = choice.semanticGraph || {};
    const shared = Number(graph.sharedByCollections || 1);
    return `<article class="asset owned"><header><span class="asset-icon">${icon("link", { size: 20 })}</span><div><p class="badge">Raccolta editoriale</p><h3>${escapeHtml(choice.name)}</h3></div></header><div class="asset-copy">${choice.shortDescription ? `<p>${escapeHtml(choice.shortDescription)}</p>` : ""}<p class="muted">Spazio: ${escapeHtml(choice.contentSpace?.name || "Spazio editoriale")}</p><p class="muted">Regole editoriali: ${escapeHtml(choice.namespace?.name || "—")}</p><div class="stats"><span><strong>${Number(choice.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(choice.relationCount || 0)}</strong> relazioni</span>${shared > 1 ? `<span><strong>${shared}</strong> raccolte condividono il grafo</span>` : ""}</div></div><footer class="operations"><a class="button-link" data-route href="/workspace/editorial-studio?editorialContextId=${encodeURIComponent(choice.id)}&section=relations">Apri relazioni ${icon("chevron", { size: 14 })}</a></footer></article>`;
  }

  renderRelationChooser() {
    if (!this.preflight?.relations?.allowed) {
      return `<main class="page create-hub-page"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/create">Crea</a><span aria-hidden="true">/</span><span>Collega soggetti</span></nav><div class="empty-state"><span>${icon("lock", { size: 28 })}</span><h1>Collegamenti non modificabili</h1><p>${escapeHtml(this.preflight?.relations?.blockers?.[0]?.message || "Il tuo ruolo non consente di modificare i collegamenti semantici.")}</p><a class="button-link secondary" data-route href="/create">Torna a Crea</a></div></main>`;
    }
    const results = this.relationChoices?.results || [];
    const pagination = this.relationChoices?.pagination || { page: this.relationPage(), limit: 12, total: 0, totalPages: 0 };
    return `<main class="page create-hub-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/create">Crea</a><span aria-hidden="true">/</span><span>Collega soggetti</span></nav><header class="page-header"><div><span class="eyebrow">Relazioni</span><h1>Scegli la raccolta</h1><p>La raccolta determina il contesto di lavoro. Il grafo semantico può essere condiviso con altre raccolte e viene modificato senza cambiare i loro contenuti.</p></div></header><form class="panel inline-form" data-relation-search role="search"><label>Cerca raccolta<input name="q" value="${escapeHtml(this.relationQuery())}" placeholder="Nome o descrizione"></label><button type="submit" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Raccolte modificabili</span><h2>Collega soggetti nel contesto giusto</h2></div><span class="count">${Number(pagination.total || 0)}</span></div>${this.busy && !this.relationChoices ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : results.length ? `<div class="asset-grid">${results.map((choice) => this.renderRelationChoice(choice)).join("")}</div>` : `<div class="empty-state"><span>${icon("link", { size: 28 })}</span><h3>Nessuna raccolta disponibile</h3><p>${this.relationQuery() ? "Nessuna raccolta modificabile corrisponde alla ricerca." : "Per curare i collegamenti serve almeno una raccolta editoriale accessibile."}</p><a class="button-link secondary" data-route href="/workspace/editorial-spaces">Apri gli spazi editoriali</a></div>`}<nav class="pagination" aria-label="Pagine delle raccolte"><a class="button-link secondary ${pagination.page <= 1 ? "disabled" : ""}" ${pagination.page <= 1 ? "aria-disabled=\"true\"" : `data-route href="${escapeHtml(this.relationHref(pagination.page - 1))}"`}>← Precedente</a><span>Pagina ${Number(pagination.page || 1)}</span><a class="button-link secondary ${pagination.page >= pagination.totalPages ? "disabled" : ""}" ${pagination.page >= pagination.totalPages ? "aria-disabled=\"true\"" : `data-route href="${escapeHtml(this.relationHref(pagination.page + 1))}"`}>Successiva →</a></nav></section></main>`;
  }

  render() {
    if (this.busy && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Controllo dei prerequisiti…</p></div></main>`; return; }
    if (this.error && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Crea</h1><p role="alert">${escapeHtml(this.error)}</p><a class="button-link secondary" data-route href="/workspace">Torna alla Libreria</a></div></main>`; return; }
    if (this.relationMode()) { this.innerHTML = this.renderRelationChooser(); return; }
    const choices = `${this.renderContentCard()}${this.renderVisitCard()}${this.renderRelationsCard()}`;
    const noCapabilities = !choices ? `<div class="empty-state"><span>${icon("lock", { size: 26 })}</span><h2>Nessuno strumento di creazione disponibile</h2><p>I ruoli assegnati consentono la consultazione, ma non la creazione. Un responsabile può aggiornare i ruoli dalla gestione dell'organizzazione.</p></div>` : "";
    this.innerHTML = `<style>
      artaround-create-hub-view .create-hub-page{display:grid;gap:1rem;max-width:var(--content);margin:auto;padding:2rem 1rem 5rem}
      artaround-create-hub-view .create-choice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:1rem}
      artaround-create-hub-view .create-choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.9rem;align-items:start;padding:1.2rem}
      artaround-create-hub-view .create-choice>.button-link{grid-column:2;justify-self:start}
      artaround-create-hub-view .create-choice h2{margin:.2rem 0}
      artaround-create-hub-view .create-choice p{margin:.35rem 0}
      artaround-create-hub-view .create-choice.blocked{border-color:#e4c28a;background:var(--amber-100)}
    </style><main class="page create-hub-page" aria-busy="${this.busy}"><header class="page-header"><div><span class="eyebrow">Crea</span><h1>Cosa vuoi fare?</h1><p>Crea contenuti o visite, oppure cura i collegamenti semantici. Spazi e raccolte si organizzano dalla Libreria.</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${choices ? `<section class="create-choice-grid" aria-label="Strumenti di creazione">${choices}</section>` : noCapabilities}</main>`;
  }
}
customElements.define("artaround-create-hub-view", ArtAroundCreateHubView);
