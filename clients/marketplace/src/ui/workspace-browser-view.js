import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { editorLabel, integrityLabel, resourceLabel, resourceStateLabel } from "./presentation.js";

const OWNED_TYPES = [["", "Tutte le risorse"], ["item_edition", "Contenuti"], ["visit", "Visite"], ["editorial_context", "Raccolte editoriali"], ["namespace", "Regole editoriali"], ["physical_vocabulary", "Vocabolari fisici"]];
const LICENSED_TYPES = [["", "Tutte le risorse"], ["item_edition", "Contenuti"], ["item_revision", "Versioni dei contenuti"], ["visit", "Visite"], ["visit_revision", "Versioni delle visite"], ["editorial_context", "Raccolte editoriali"], ["editorial_release", "Versioni delle raccolte"], ["namespace", "Regole editoriali"], ["namespace_revision", "Versioni delle regole editoriali"], ["physical_vocabulary", "Vocabolari fisici"], ["physical_vocabulary_revision", "Versioni dei vocabolari fisici"]];
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function initialState() { const p = new URLSearchParams(window.location.search); return { ownership: p.get("ownership") === "licensed" ? "licensed" : "owned", q: p.get("q") || "", resourceType: p.get("resourceType") || "", page: Math.max(1, Number(p.get("page")) || 1) }; }
function authoringHref(ref) { const type = String(ref?.resourceType || ""); const id = String(ref?.resourceId || ""); if (!id) return null; if (type === "item") return `/workspace/item-authoring?itemId=${encodeURIComponent(id)}`; if (type === "visit") return `/workspace/visit-authoring?visitId=${encodeURIComponent(id)}`; if (type === "namespace") return `/namespaces/editor?namespaceId=${encodeURIComponent(id)}`; if (type === "editorial_context") return `/workspace/context-compose?editorialContextId=${encodeURIComponent(id)}`; return null; }

export class ArtAroundWorkspaceBrowserView extends HTMLElement {
  context = readOperatingContext();
  workspaceContext = null;
  resources = null;
  busy = false;
  error = null;
  state = initialState();

  connectedCallback() { this.addEventListener("click", this.onClick); this.addEventListener("submit", this.onSubmit); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); this.removeEventListener("submit", this.onSubmit); }
  principal() { return operatingPrincipal(this.context); }
  createHref() { return "/create"; }
  ownedLabel() { return this.context?.type === "organization" ? "Dell'organizzazione" : "Personali"; }

  async load() {
    const principal = this.principal();
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [workspaceContext, resources] = await Promise.all([
        marketplaceRepository.workspaceContext(principal),
        marketplaceRepository.workspaceResources(principal, { ownership: this.state.ownership, q: this.state.q, resourceTypes: this.state.resourceType ? [this.state.resourceType] : null, page: this.state.page }),
      ]);
      this.workspaceContext = workspaceContext;
      this.resources = resources;
      this.state.page = resources.page;
    } catch (error) { this.error = error instanceof Error ? error.message : "La libreria non è disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  navigateWith(patch) {
    const next = { ...this.state, ...patch };
    const p = new URLSearchParams();
    if (next.ownership !== "owned") p.set("ownership", next.ownership);
    if (next.q) p.set("q", next.q);
    if (next.resourceType) p.set("resourceType", next.resourceType);
    if (next.page > 1) p.set("page", String(next.page));
    navigate(`/workspace${p.toString() ? `?${p.toString()}` : ""}`);
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-resource-search]")) return;
    event.preventDefault();
    const data = new FormData(form);
    this.navigateWith({ q: String(data.get("q") || "").trim(), resourceType: String(data.get("resourceType") || ""), page: 1 });
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const ownership = target?.closest("button[data-ownership]");
    if (ownership) { this.navigateWith({ ownership: ownership.dataset.ownership, resourceType: "", page: 1 }); return; }
    const page = target?.closest("button[data-page]");
    if (page) { this.navigateWith({ page: Math.max(1, Number(page.dataset.page) || 1) }); return; }
    const edit = target?.closest("button[data-authoring-href]");
    if (edit) { navigate(edit.dataset.authoringHref); return; }
    const detail = target?.closest("button[data-resource-detail]");
    if (detail) {
      const p = new URLSearchParams({ resourceType: detail.dataset.resourceType, resourceId: detail.dataset.resourceId, ownership: detail.dataset.resourceOwnership });
      navigate(`/workspace/resource?${p.toString()}`);
    }
  };

  renderFilters() {
    const types = this.state.ownership === "owned" ? OWNED_TYPES : LICENSED_TYPES;
    const options = types.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === this.state.resourceType ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    return `<section class="panel"><div class="button-row" role="group" aria-label="Disponibilità"><button type="button" data-ownership="owned" class="${this.state.ownership === "owned" ? "" : "button-secondary"}" aria-pressed="${this.state.ownership === "owned"}">${escapeHtml(this.ownedLabel())}</button><button type="button" data-ownership="licensed" class="${this.state.ownership === "licensed" ? "" : "button-secondary"}" aria-pressed="${this.state.ownership === "licensed"}">Acquisite</button></div><form data-resource-search class="inline-form" role="search"><label>Cerca <input name="q" value="${escapeHtml(this.state.q)}" placeholder="Titolo, descrizione o autore"></label><label>Tipo di risorsa <select name="resourceType">${options}</select></label><button type="submit" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Mostra i risultati</button></form></section>`;
  }

  renderAsset(asset) {
    const editHref = asset.ownership === "owned" && (asset.availableOperations || []).some((op) => op.code === "open_editor") ? authoringHref(asset.authoringRef) : null;
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    const ownershipCopy = asset.ownership === "owned" ? (this.context?.type === "organization" ? "Dell'organizzazione" : "Di tua proprietà") : "Disponibile tramite licenza";
    return `<article class="asset ${escapeHtml(asset.ownership)}"><header><span class="asset-icon">${icon(asset.resourceType.startsWith("visit") ? "route" : asset.resourceType.startsWith("namespace") || asset.resourceType.startsWith("physical_vocabulary") ? "book" : "catalog")}</span><div><p class="badge">${escapeHtml(resourceLabel(asset.resourceType))}</p><h3>${escapeHtml(asset.title)}</h3></div>${state}</header><div class="asset-copy"><p class="muted">${escapeHtml(ownershipCopy)}</p>${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}</div><footer class="operations">${editHref ? `<button type="button" data-authoring-href="${escapeHtml(editHref)}">${icon("edit", { size: 15 })}${escapeHtml(editorLabel(asset.resourceType, "Modifica"))}</button>` : ""}<button class="button-secondary" type="button" data-resource-detail data-resource-type="${escapeHtml(asset.resourceType)}" data-resource-id="${escapeHtml(asset.resourceId)}" data-resource-ownership="${escapeHtml(asset.ownership)}">Dettagli e azioni ${icon("chevron", { size: 14 })}</button></footer></article>`;
  }

  renderSpaces() {
    const spaces = this.workspaceContext?.contentSpaces || [];
    return spaces.length ? `<details class="panel technical-details"><summary>Spazi editoriali (${spaces.length})</summary><p class="note">Organizzano i contenuti disponibili nelle raccolte editoriali di questa area.</p><div class="space-grid">${spaces.map((space) => `<article class="space-card"><span class="space-icon">${icon("workspace")}</span><div><strong>${escapeHtml(space.name)}</strong><p>${escapeHtml(space.description || "Spazio editoriale")}</p></div></article>`).join("")}</div></details>` : "";
  }

  render() {
    if (this.busy && !this.workspaceContext) { this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento della libreria…</p></div></main>`; return; }
    if (this.error && !this.workspaceContext) { this.innerHTML = `<main class="page"><p role="alert">${escapeHtml(this.error)}</p></main>`; return; }
    const results = this.resources?.results || [];
    const total = Number(this.resources?.total || 0);
    const page = Number(this.resources?.page || this.state.page);
    const pageSize = Number(this.resources?.pageSize || 12);
    const emptyAction = this.state.ownership === "owned" ? `<a class="button-link" data-route href="${this.createHref()}">Crea una risorsa</a>` : `<a class="button-link" data-route href="/catalog">Esplora il catalogo</a>`;
    this.innerHTML = `<main class="page workspace-page"><header class="page-header"><div><span class="eyebrow">Libreria</span><h1>Trova e gestisci le risorse</h1><p>Ricerca contenuti, visite e raccolte disponibili in questa area di lavoro.</p></div><a class="button-link" data-route href="${this.createHref()}">${icon("plus")} Crea</a></header>${this.renderFilters()}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Risultati</span><h2>${this.state.ownership === "owned" ? escapeHtml(this.ownedLabel()) : "Acquisite"}</h2></div><span class="count">${total}</span></div>${this.busy ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : results.length ? `<div class="asset-grid">${results.map((asset) => this.renderAsset(asset)).join("")}</div>` : `<div class="empty-state"><h3>Nessuna risorsa trovata</h3><p>${this.state.q || this.state.resourceType ? "Prova a modificare la ricerca o il tipo di risorsa." : this.state.ownership === "owned" ? "Crea la prima risorsa per iniziare." : "Le risorse acquisite dal catalogo compariranno qui."}</p>${emptyAction}</div>`}<nav class="pagination" aria-label="Pagine delle risorse"><button type="button" data-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}</span><button type="button" data-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav></section>${this.renderSpaces()}</main>`;
  }
}
customElements.define("artaround-workspace-browser-view", ArtAroundWorkspaceBrowserView);
