import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { renderLibrarySectionNav } from "./library-section-nav.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundEditorialSpacesView extends HTMLElement {
  context = readOperatingContext();
  preflight = null;
  spaces = null;
  busy = false;
  creating = false;
  createOpen = false;
  createDirty = false;
  createDraft = { name: "", description: "" };
  error = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
  }

  hasUnsavedChanges() { return this.createDirty; }
  discardUnsavedChanges() { this.createDirty = false; }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-create-space]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.createDraft, target.name)) return;
    this.createDraft[target.name] = target.value;
    this.createDirty = true;
  };

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [spaces, preflight] = await Promise.all([
        editorialRepository.spaceSummaries({ ownerType: this.context.type, ownerId: this.context.id }),
        marketplaceRepository.authoringPreflight(principal),
      ]);
      this.spaces = spaces || [];
      this.preflight = preflight;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare gli spazi editoriali";
    } finally {
      this.busy = false; this.render();
    }
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest("[data-space-id]");
    if (open) { navigate(`/workspace/editorial-space?contentSpaceId=${encodeURIComponent(open.dataset.spaceId)}`); return; }
    if (target?.closest("[data-new-space]")) { this.createOpen = true; this.error = null; this.render(); return; }
    if (target?.closest("[data-cancel-space]")) {
      this.createOpen = false;
      this.createDirty = false;
      this.createDraft = { name: "", description: "" };
      this.error = null;
      this.render();
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-space]")) return;
    event.preventDefault();
    if (!this.preflight?.capabilities?.editorialSpaceManage || !this.context) return;
    const data = new FormData(form);
    this.createDraft = {
      name: String(data.get("name") || ""),
      description: String(data.get("description") || ""),
    };
    const name = this.createDraft.name.trim();
    if (!name) return;
    this.creating = true; this.error = null; this.render();
    try {
      const created = await editorialRepository.createSpace({
        name,
        description: this.createDraft.description.trim() || null,
        ownerType: this.context.type,
        ownerId: this.context.id,
      });
      const id = created?._id || created?.id;
      if (!id) throw new Error("Lo spazio è stato creato ma non è stato restituito il suo identificatore");
      this.createDirty = false;
      navigate(`/workspace/editorial-space?contentSpaceId=${encodeURIComponent(id)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione dello spazio non completata";
      this.creating = false; this.render();
    }
  };

  renderSpace(space) {
    const stats = space.stats || {};
    return `<article class="asset owned"><header><span class="asset-icon">${icon("workspace", { size: 20 })}</span><div><p class="badge">Spazio editoriale</p><h3>${escapeHtml(space.name)}</h3></div></header><div class="asset-copy"><p>${escapeHtml(space.description || "Raggruppa contenuti riutilizzabili da più raccolte editoriali.")}</p><div class="stats"><span><strong>${Number(stats.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(stats.collectionCount || 0)}</strong> raccolte</span><span><strong>${Number(stats.publishedCollectionCount || 0)}</strong> pubblicate</span></div></div><footer class="operations"><button type="button" data-space-id="${escapeHtml(space.id)}">Apri spazio ${icon("chevron", { size: 14 })}</button></footer></article>`;
  }

  renderCreateForm() {
    if (!this.createOpen) return "";
    return `<section class="panel" aria-labelledby="new-space-title"><div class="section-heading"><div><span class="eyebrow">Nuovo spazio</span><h2 id="new-space-title">Crea un contenitore editoriale</h2><p>Lo spazio raccoglie i contenuti condivisi. Le raccolte verranno create successivamente al suo interno.</p></div></div><form class="form-grid" data-create-space><label>Nome dello spazio<input name="name" required maxlength="160" placeholder="Collezione permanente" value="${escapeHtml(this.createDraft.name)}"></label><label class="full">Descrizione<textarea name="description" rows="3" placeholder="Ambito, corpus o finalità dello spazio">${escapeHtml(this.createDraft.description)}</textarea></label><div class="operations full"><button type="button" class="button-secondary" data-cancel-space>Annulla</button><button type="submit" ${this.creating ? "disabled" : ""}>${this.creating ? "Creazione…" : `Crea spazio ${icon("chevron", { size: 14 })}`}</button></div></form></section>`;
  }

  render() {
    const spaces = this.spaces || [];
    const canCreate = this.preflight?.capabilities?.editorialSpaceManage === true;
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy || this.creating}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><span>Spazi editoriali</span></nav><header class="page-header"><div><span class="eyebrow">Libreria</span><h1>Spazi editoriali</h1><p>Organizza i contenuti in corpus riutilizzabili e crea al loro interno raccolte con regole, selezioni e grafi semantici.</p></div>${canCreate && !this.createOpen ? `<button type="button" data-new-space>${icon("plus", { size: 16 })} Nuovo spazio</button>` : ""}</header>${renderLibrarySectionNav("spaces")}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderCreateForm()}<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Spazi disponibili</span><h2>${this.context?.type === "organization" ? "Dell'organizzazione" : "Personali"}</h2></div><span class="count">${spaces.length}</span></div>${this.busy && !this.spaces ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : spaces.length ? `<div class="asset-grid">${spaces.map((space) => this.renderSpace(space)).join("")}</div>` : `<div class="empty-state"><span>${icon("workspace", { size: 30 })}</span><h3>Nessuno spazio editoriale</h3><p>Uno spazio è il punto di partenza per organizzare contenuti e raccolte editoriali.</p>${canCreate ? `<button type="button" data-new-space>${icon("plus", { size: 15 })} Crea il primo spazio</button>` : ""}</div>`}</section></main>`;
  }
}
customElements.define("artaround-editorial-spaces-view", ArtAroundEditorialSpacesView);
