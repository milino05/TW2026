import { navigate } from "../application/router.js";
import { readOperatingContext } from "../application/operating-context.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export class ArtAroundEditorialSpacesView extends HTMLElement {
  context = readOperatingContext();
  spaces = null;
  busy = false;
  error = null;

  connectedCallback() { this.addEventListener("click", this.onClick); this.load(); }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }

  async load() {
    if (!this.context) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.render();
    try { this.spaces = await editorialRepository.spaceSummaries({ ownerType: this.context.type, ownerId: this.context.id }); }
    catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile caricare gli spazi editoriali"; }
    finally { this.busy = false; this.render(); }
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest("[data-space-id]");
    if (open) navigate(`/workspace/editorial-space?contentSpaceId=${encodeURIComponent(open.dataset.spaceId)}`);
    if (target?.closest("[data-new-collection]")) navigate("/workspace/editorial-collection-new");
  };

  renderSpace(space) {
    const stats = space.stats || {};
    return `<article class="panel space-card" data-space-id="${escapeHtml(space.id)}" tabindex="0"><span class="resource-mark">${icon("workspace", { size: 21 })}</span><div><h2>${escapeHtml(space.name)}</h2><p>${escapeHtml(space.description || "Spazio di lavoro per contenuti indipendenti dal vocabolario.")}</p><div class="space-stats"><span><strong>${stats.itemCount || 0}</strong> contenuti</span><span><strong>${stats.collectionCount || 0}</strong> raccolte</span><span><strong>${stats.publishedCollectionCount || 0}</strong> pubblicate</span></div></div><span class="open-mark">${icon("chevron", { size: 18 })}</span></article>`;
  }

  render() {
    const spaces = this.spaces || [];
    this.innerHTML = `<style>
      artaround-editorial-spaces-view .spaces-page{max-width:var(--content);margin:auto;padding:2rem 1rem 5rem;display:grid;gap:1rem}artaround-editorial-spaces-view .spaces-header{display:flex;justify-content:space-between;gap:1rem;align-items:end}
      artaround-editorial-spaces-view .space-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}artaround-editorial-spaces-view .space-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.8rem;align-items:start;cursor:pointer}artaround-editorial-spaces-view .space-card h2{margin:.1rem 0}artaround-editorial-spaces-view .space-card p{margin:.35rem 0;color:var(--muted)}
      artaround-editorial-spaces-view .space-stats{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.7rem;color:var(--muted)}artaround-editorial-spaces-view .space-stats strong{color:var(--text)}artaround-editorial-spaces-view .open-mark{align-self:center}
      @media(max-width:48rem){artaround-editorial-spaces-view .space-grid{grid-template-columns:1fr}artaround-editorial-spaces-view .spaces-header{align-items:start;flex-direction:column}}
    </style><main class="page spaces-page" aria-busy="${this.busy}"><header class="spaces-header"><div><span class="eyebrow">Libreria editoriale</span><h1>Spazi editoriali</h1><p>Gli spazi raccolgono Item indipendenti dal Namespace. Le raccolte applicano regole editoriali e un proprio grafo semantico.</p></div><button type="button" data-new-collection>${icon("plus", { size: 16 })} Nuova raccolta</button></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && !this.spaces ? `<div class="empty-state"><p>Caricamento spazi…</p></div>` : spaces.length ? `<section class="space-grid">${spaces.map((space) => this.renderSpace(space)).join("")}</section>` : `<div class="empty-state"><span>${icon("workspace", { size: 30 })}</span><h2>Nessuno spazio editoriale</h2><p>Non devi crearne uno in anticipo: creando la prima raccolta ArtAround può preparare anche il suo spazio di lavoro.</p><button type="button" data-new-collection>Crea la prima raccolta</button></div>`}</main>`;
  }
}
customElements.define("artaround-editorial-spaces-view", ArtAroundEditorialSpacesView);
