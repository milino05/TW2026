import { navigate } from "../application/router.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundEditorialSpaceView extends HTMLElement {
  contentSpaceId = null;
  section = "collections";
  data = null;
  items = null;
  busy = false;
  error = null;

  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.contentSpaceId = params.get("contentSpaceId");
    this.section = ["collections", "content", "settings"].includes(params.get("section")) ? params.get("section") : "collections";
    this.addEventListener("click", this.onClick);
    this.load();
  }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }

  async load() {
    if (!this.contentSpaceId) { this.error = "Spazio editoriale non specificato"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      this.data = await editorialRepository.spaceProjection(this.contentSpaceId);
      if (this.section === "content") this.items = await editorialRepository.listSpaceItems(this.contentSpaceId, { page: 1, limit: 50 });
    } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aprire lo spazio editoriale"; }
    finally { this.busy = false; this.render(); }
  }

  setSection(section) {
    this.section = section;
    const params = new URLSearchParams({ contentSpaceId: this.contentSpaceId, section });
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    if (section === "content" && !this.items) { this.load(); return; }
    this.render();
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest("button[data-space-section]");
    if (tab) { this.setSection(tab.dataset.spaceSection); return; }
    const collection = target?.closest("[data-collection-id]");
    if (collection) { navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(collection.dataset.collectionId)}`); return; }
    if (target?.closest("[data-new-collection]")) { navigate(`/workspace/editorial-collection-new?contentSpaceId=${encodeURIComponent(this.contentSpaceId)}`); return; }
    const item = target?.closest("[data-open-item]");
    if (item) { navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(item.dataset.openItem)}`); return; }
    if (target?.closest("[data-delete-space]")) await this.removeSpace();
    if (target?.closest("[data-back-spaces]")) navigate("/workspace/editorial-spaces");
  };

  async removeSpace() {
    if (!this.data?.permissions?.canManageSpace) return;
    const confirmed = await openActionDialog({
      title: `Eliminare lo spazio “${this.data.space.name}”?`,
      message: "Gli Item resteranno disponibili, ma le membership dello spazio verranno rimosse. L'operazione è bloccata se esistono raccolte attive.",
      confirmLabel: "Elimina spazio",
      tone: "danger",
    });
    if (!confirmed) return;
    this.busy = true; this.render();
    try { await editorialRepository.removeSpace(this.contentSpaceId); navigate("/workspace/editorial-spaces"); }
    catch (error) { this.error = error instanceof Error ? error.message : "Eliminazione non completata"; this.busy = false; this.render(); }
  }

  renderCollections() {
    const collections = this.data.collections || [];
    return `<section class="space-section"><div class="section-heading"><div><h2>Raccolte editoriali</h2><p>Ogni raccolta applica un Namespace e possiede una composizione e un grafo semantico indipendenti.</p></div>${this.data.permissions.canCreateCollection ? `<button type="button" data-new-collection>${icon("plus", { size: 16 })} Nuova raccolta</button>` : ""}</div>${collections.length ? `<div class="collection-grid">${collections.map((collection) => `<article class="panel collection-card" data-collection-id="${escapeHtml(collection.id)}" tabindex="0"><div><span class="eyebrow">${escapeHtml(collection.namespace.name)}</span><h3>${escapeHtml(collection.name)}</h3><p>${escapeHtml(collection.shortDescription || "Raccolta editoriale")}</p></div><div class="collection-meta"><span>${collection.itemCount} contenuti</span><span class="status-pill ${collection.published ? "success" : ""}">${collection.reviewActive ? "In revisione" : collection.published ? "Pubblicata" : "Working"}</span></div></article>`).join("")}</div>` : `<div class="empty-state"><h3>Nessuna raccolta</h3><p>Questo spazio può contenere Item senza obbligarli a una raccolta. Quando vuoi curarli con regole e semantica, crea una raccolta.</p>${this.data.permissions.canCreateCollection ? `<button type="button" data-new-collection>Crea raccolta</button>` : ""}</div>`}</section>`;
  }

  renderContent() {
    const rows = this.items?.results || [];
    return `<section class="space-section"><header class="section-heading"><div><h2>Contenuti dello spazio</h2><p>Questi Item sono indipendenti dal Namespace. Una stessa risorsa può essere usata da più raccolte.</p></div></header>${rows.length ? `<div class="space-item-list">${rows.map((row) => {
      const item = row.item || {};
      return `<article class="panel item-row"><div><strong>Item ${escapeHtml(id(item).slice(-6))}</strong><small>Subject ${escapeHtml(id(item.primarySubjectId).slice(-6))}</small></div><button type="button" class="button-secondary small" data-open-item="${escapeHtml(id(item))}">${icon("edit", { size: 15 })} Apri</button></article>`;
    }).join("")}</div>` : `<div class="empty-state"><h3>Nessun contenuto nello spazio</h3><p>Puoi creare un contenuto normalmente e aggiungerlo allo spazio, oppure crearne uno direttamente da una raccolta.</p></div>`}</section>`;
  }

  renderSettings() {
    return `<section class="space-section settings-grid"><article class="panel"><span class="eyebrow">Spazio editoriale</span><h2>${escapeHtml(this.data.space.name)}</h2><p>${escapeHtml(this.data.space.description || "Nessuna descrizione")}</p><dl><div><dt>Contenuti</dt><dd>${this.data.stats.itemCount}</dd></div><div><dt>Raccolte</dt><dd>${this.data.stats.collectionCount}</dd></div></dl></article><article class="panel danger-zone"><span class="eyebrow">Zona pericolosa</span><h2>Elimina spazio</h2><p>Non è consentito eliminare uno spazio che contiene raccolte attive. Gli Item non vengono mai eliminati in cascata.</p>${this.data.permissions.canManageSpace ? `<button type="button" class="button-secondary danger" data-delete-space>${icon("trash", { size: 16 })} Elimina spazio</button>` : `<p class="note">Non disponi del permesso di gestione dello spazio.</p>`}</article></section>`;
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Apertura spazio editoriale…</p></div></main>`; return; }
    if (this.error && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Spazio editoriale</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    if (!this.data) return;
    const section = this.section === "content" ? this.renderContent() : this.section === "settings" ? this.renderSettings() : this.renderCollections();
    this.innerHTML = `<style>
      artaround-editorial-space-view .space-page{max-width:var(--content);margin:auto;padding:1.5rem 1rem 5rem;display:grid;gap:1rem}artaround-editorial-space-view .space-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}artaround-editorial-space-view .space-header h1{margin:.2rem 0}artaround-editorial-space-view .space-tabs{display:flex;gap:.25rem;border-bottom:1px solid var(--border)}artaround-editorial-space-view .space-tabs button{background:none;color:inherit;border:0;border-bottom:2px solid transparent;border-radius:0;padding:.8rem 1rem}artaround-editorial-space-view .space-tabs button[aria-current="page"]{font-weight:700;border-bottom-color:currentColor}
      artaround-editorial-space-view .space-section{display:grid;gap:1rem}artaround-editorial-space-view .section-heading{display:flex;justify-content:space-between;gap:1rem;align-items:end}artaround-editorial-space-view .section-heading h2,artaround-editorial-space-view .section-heading p{margin:.2rem 0}
      artaround-editorial-space-view .collection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}artaround-editorial-space-view .collection-card{display:grid;gap:.8rem;cursor:pointer}artaround-editorial-space-view .collection-card h3{margin:.2rem 0}artaround-editorial-space-view .collection-card p{margin:.3rem 0;color:var(--muted)}artaround-editorial-space-view .collection-meta{display:flex;justify-content:space-between;align-items:center;gap:.6rem;color:var(--muted)}
      artaround-editorial-space-view .space-item-list{display:grid;gap:.55rem}artaround-editorial-space-view .item-row{display:flex;justify-content:space-between;gap:1rem;align-items:center}artaround-editorial-space-view .item-row>div{display:grid;gap:.15rem}artaround-editorial-space-view .item-row small{color:var(--muted)}artaround-editorial-space-view .settings-grid{grid-template-columns:1fr 1fr}artaround-editorial-space-view dl div{display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:.5rem 0}
      @media(max-width:50rem){artaround-editorial-space-view .collection-grid,artaround-editorial-space-view .settings-grid{grid-template-columns:1fr}artaround-editorial-space-view .section-heading{align-items:start;flex-direction:column}}
    </style><main class="page space-page" aria-busy="${this.busy}"><header class="space-header"><div><button type="button" class="text-button" data-back-spaces>${icon("arrowLeft", { size: 15 })} Spazi editoriali</button><span class="eyebrow">Spazio editoriale</span><h1>${escapeHtml(this.data.space.name)}</h1><p>${escapeHtml(this.data.space.description || "Workspace di Item indipendenti dal vocabolario.")}</p></div><div class="button-row"><span class="status-pill">${this.data.stats.itemCount} contenuti</span><span class="status-pill">${this.data.stats.collectionCount} raccolte</span></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<nav class="space-tabs"><button type="button" data-space-section="collections" aria-current="${this.section === "collections" ? "page" : "false"}">Raccolte</button><button type="button" data-space-section="content" aria-current="${this.section === "content" ? "page" : "false"}">Contenuti</button><button type="button" data-space-section="settings" aria-current="${this.section === "settings" ? "page" : "false"}">Impostazioni</button></nav>${section}</main>`;
  }
}
customElements.define("artaround-editorial-space-view", ArtAroundEditorialSpaceView);
