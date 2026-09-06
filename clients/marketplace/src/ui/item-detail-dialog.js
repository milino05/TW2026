import { navigate } from "../application/router.js";
import { libraryRepository } from "../infrastructure/http/library-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function id(value) { return String(value?.id || value?._id || value || ""); }
function statusLabel(value) {
  return ({ draft: "Bozza", in_review: "In revisione", changes_requested: "Modifiche richieste", published: "Pubblicata", superseded: "Superata" })[value] || value || "Da completare";
}
function wikidataIdentity(subject) {
  return (subject?.externalIdentities || []).find((entry) => entry.scheme === "wikidata" && entry.role === "canonical")
    || (subject?.externalIdentities || []).find((entry) => entry.scheme === "wikidata")
    || null;
}

export class ArtAroundItemDetailDialog extends HTMLElement {
  contentSpaceId = null;
  itemId = null;
  initialCollectionId = null;
  data = null;
  tab = "editions";
  view = "tabs";
  focusedCollectionId = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.contentSpaceId = this.getAttribute("content-space-id") || null;
    this.itemId = this.getAttribute("item-id") || null;
    this.initialCollectionId = this.getAttribute("initial-collection-id") || null;
    if (this.initialCollectionId) {
      this.tab = "collections";
      this.view = "collection-detail";
      this.focusedCollectionId = this.initialCollectionId;
    }
    this.addEventListener("click", this.onClick);
    void this.load();
  }
  disconnectedCallback() { this.removeEventListener("click", this.onClick); }

  async load() {
    if (!this.contentSpaceId || !this.itemId) return;
    this.busy = true; this.error = null; this.render();
    try { this.data = await libraryRepository.itemDetail(this.contentSpaceId, this.itemId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aprire il contenuto"; }
    finally { this.busy = false; this.render(); }
  }
  close() {
    this.dispatchEvent(new CustomEvent("library-item-detail-close", { bubbles: true }));
    this.remove();
  }
  collection(collectionId = this.focusedCollectionId) {
    return (this.data?.collections || []).find((entry) => id(entry.id) === id(collectionId)) || null;
  }
  authoringHref(namespaceId = null) {
    const query = new URLSearchParams({ itemId: this.itemId, contentSpaceId: this.contentSpaceId });
    if (namespaceId) query.set("namespaceId", namespaceId);
    return `/workspace/item-authoring?${query.toString()}`;
  }
  notifyChanged(detail = {}) {
    this.dispatchEvent(new CustomEvent("library-item-detail-changed", { bubbles: true, detail: { itemId: this.itemId, ...detail } }));
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-close-item-detail]")) { this.close(); return; }
    const tab = target.closest("[data-item-detail-tab]");
    if (tab) { this.tab = tab.dataset.itemDetailTab; this.view = "tabs"; this.focusedCollectionId = null; this.render(); return; }
    if (target.closest("[data-back-collections]")) { this.tab = "collections"; this.view = "tabs"; this.focusedCollectionId = null; this.render(); return; }
    if (target.closest("[data-add-collection-mode]")) { this.tab = "collections"; this.view = "collection-picker"; this.focusedCollectionId = null; this.render(); return; }
    const focus = target.closest("[data-focus-collection]");
    if (focus) { this.tab = "collections"; this.view = "collection-detail"; this.focusedCollectionId = focus.dataset.focusCollection; this.render(); return; }
    const openEdition = target.closest("[data-open-item-edition]");
    if (openEdition) { navigate(this.authoringHref(openEdition.dataset.openItemEdition)); return; }
    if (target.closest("[data-create-item-edition]")) { navigate(this.authoringHref(target.closest("[data-create-item-edition]").dataset.createItemEdition || null)); return; }
    const openCollection = target.closest("[data-open-collection]");
    if (openCollection) { navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(openCollection.dataset.openCollection)}&section=content`); return; }
    const openGraph = target.closest("[data-open-collection-graph]");
    if (openGraph) { navigate(`/workspace/semantic-graph?semanticGraphId=${encodeURIComponent(openGraph.dataset.openCollectionGraph)}`); return; }
    const add = target.closest("[data-add-to-collection]");
    if (add) {
      this.busy = true; this.error = null; this.render();
      try {
        await editorialRepository.addEntry(add.dataset.addToCollection, { itemId: this.itemId, curationSignals: [] });
        this.focusedCollectionId = add.dataset.addToCollection;
        this.view = "collection-detail";
        await this.load();
        this.notifyChanged({ editorialContextId: this.focusedCollectionId, action: "added" });
      } catch (error) { this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere il contenuto alla raccolta"; this.busy = false; this.render(); }
      return;
    }
    const remove = target.closest("[data-remove-from-collection]");
    if (remove) {
      const collection = this.collection(remove.dataset.removeFromCollection);
      if (!collection?.entryId) return;
      const confirmed = await openActionDialog({
        title: `Rimuovere il contenuto da “${collection.name}”?`,
        message: "L'Item resterà nello spazio editoriale e potrà continuare a essere usato da altre raccolte.",
        confirmLabel: "Rimuovi dalla raccolta",
        tone: "danger",
      });
      if (!confirmed) return;
      this.busy = true; this.error = null; this.render();
      try {
        await editorialRepository.removeEntry(collection.id, collection.entryId);
        this.view = "tabs"; this.focusedCollectionId = null;
        await this.load();
        this.notifyChanged({ editorialContextId: collection.id, action: "removed" });
      } catch (error) { this.error = error instanceof Error ? error.message : "Non è stato possibile rimuovere il contenuto dalla raccolta"; this.busy = false; this.render(); }
    }
  };

  renderHeader() {
    if (!this.data) return "";
    const subject = this.data.subject || {};
    const media = this.data.item?.recognitionMedia || null;
    const wikidata = wikidataIdentity(subject);
    return `<header class="item-detail-header"><div class="item-detail-identity">${media?.url ? `<figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || subject.preferredLabel || "")}"></figure>` : `<div class="item-detail-media-placeholder">${icon("image", { size: 28 })}</div>`}<div><span class="eyebrow">Item</span><h1>${escapeHtml(subject.preferredLabel || "Contenuto")}</h1><p>${escapeHtml(subject.description || "Nessuna descrizione disponibile")}</p><small>${wikidata?.id ? `Wikidata · ${escapeHtml(wikidata.id)}` : "Identità ArtAround"} · Spazio: ${escapeHtml(this.data.space?.name || "-")}</small></div></div><button type="button" class="button-secondary small" data-close-item-detail aria-label="Chiudi">×</button></header>`;
  }

  renderEditions() {
    const editions = this.data?.editions || [];
    return `<section class="item-detail-section"><div class="section-heading"><div><span class="eyebrow">Edizioni</span><h2>Versioni editoriali</h2><p>Ogni Edition combina questo Item con un insieme di Regole editoriali.</p></div>${this.data?.availableOperations?.canCreateEdition ? `<button type="button" class="button-secondary" data-create-item-edition>${icon("plus", { size: 15 })} Crea edizione</button>` : ""}</div>${editions.length ? `<div class="asset-grid">${editions.map((edition) => {
      const revision = edition.revision;
      return `<article class="asset owned"><header><span class="asset-icon">${icon("book", { size: 19 })}</span><div><p class="badge">${escapeHtml(edition.namespace?.name || "Regole editoriali")}</p><h3>${escapeHtml(revision?.label || "Edizione da completare")}</h3></div><span class="status">${escapeHtml(statusLabel(revision?.status))}</span></header><div class="asset-copy"><p>${revision ? `v${escapeHtml(revision.version)} · ${Number(revision.presentationCount || 0)} presentazioni` : "Nessuna revisione disponibile"}</p>${revision?.locales?.length ? `<p class="muted">Lingue: ${escapeHtml(revision.locales.join(", "))}</p>` : ""}</div><footer class="operations">${edition.availableOperations?.canOpen ? `<button type="button" data-open-item-edition="${escapeHtml(id(edition.namespace?.id))}">Apri edizione ${icon("chevron", { size: 14 })}</button>` : ""}</footer></article>`;
    }).join("")}</div>` : `<div class="empty-state compact"><h3>Nessuna edizione</h3><p>L'Item esiste nello spazio ma non ha ancora una versione editoriale.</p>${this.data?.availableOperations?.canCreateEdition ? `<button type="button" data-create-item-edition>${icon("plus", { size: 15 })} Crea la prima edizione</button>` : ""}</div>`}</section>`;
  }

  collectionDiagnostic(collection) {
    const edition = collection.compatibleEdition;
    const coverage = collection.semanticCoverage;
    return `<div class="collection-diagnostics"><span class="${edition ? "ok" : "warning"}">${edition ? "✓ Edizione disponibile" : "⚠ Edizione da creare"}</span><span class="${coverage === "covered" ? "ok" : "warning"}">${coverage === "covered" ? "✓ Subject nel grafo" : coverage === "missing" ? "⚠ Subject non nel grafo" : "– Grafo non disponibile"}</span></div>`;
  }

  renderCollectionCard(collection) {
    return `<button type="button" class="collection-item-card" data-focus-collection="${escapeHtml(id(collection))}"><span><strong>${escapeHtml(collection.name)}</strong><small>${escapeHtml(collection.namespace?.name || "Regole editoriali")}</small></span>${this.collectionDiagnostic(collection)}</button>`;
  }

  renderCollections() {
    const collections = (this.data?.collections || []).filter((entry) => entry.containsItem);
    const available = (this.data?.collections || []).filter((entry) => !entry.containsItem && entry.availableOperations?.canAdd);
    return `<section class="item-detail-section"><div class="section-heading"><div><span class="eyebrow">Raccolte</span><h2>Raccolte che usano questo Item</h2><p>Qui vedi dove il contenuto è selezionato nello spazio editoriale corrente.</p></div></div><div class="collection-item-grid">${collections.map((collection) => this.renderCollectionCard(collection)).join("")}${available.length ? `<button type="button" class="collection-item-card collection-item-card--add" data-add-collection-mode><span class="collection-add-icon">+</span><strong>Aggiungi a una raccolta</strong></button>` : ""}</div>${!collections.length && !available.length ? `<div class="empty-state compact"><p>Non ci sono raccolte disponibili nello spazio corrente.</p></div>` : ""}</section>`;
  }

  renderCollectionPicker() {
    const available = (this.data?.collections || []).filter((entry) => !entry.containsItem && entry.availableOperations?.canAdd);
    return `<section class="item-detail-section"><div class="section-heading"><div><span class="eyebrow">Aggiungi a una raccolta</span><h2>Scegli la raccolta</h2><p>Sono mostrate solo le raccolte dello spazio corrente che non contengono ancora questo Item.</p></div><button type="button" class="button-secondary" data-back-collections>← Raccolte</button></div>${available.length ? `<div class="collection-item-grid">${available.map((collection) => `<button type="button" class="collection-item-card" data-add-to-collection="${escapeHtml(id(collection))}"><span><strong>${escapeHtml(collection.name)}</strong><small>${escapeHtml(collection.namespace?.name || "Regole editoriali")}</small></span>${this.collectionDiagnostic(collection)}<span class="collection-card-action">Aggiungi</span></button>`).join("")}</div>` : `<div class="empty-state compact"><h3>Nessun'altra raccolta disponibile</h3><p>L'Item è già presente in tutte le raccolte modificabili dello spazio.</p></div>`}</section>`;
  }

  renderCollectionDetail() {
    const collection = this.collection();
    if (!collection) return `<section class="empty-state"><p>Raccolta non disponibile.</p><button type="button" class="button-secondary" data-back-collections>← Raccolte</button></section>`;
    const edition = collection.compatibleEdition;
    const revision = edition?.revision;
    return `<section class="item-detail-section collection-item-detail"><div class="section-heading"><div><span class="eyebrow">Item nella raccolta</span><h2>${escapeHtml(collection.name)}</h2><p>${escapeHtml(collection.namespace?.name || "Regole editoriali")}</p></div><button type="button" class="button-secondary" data-back-collections>← Raccolte</button></div><div class="detail-block-grid"><article class="panel"><span class="eyebrow">Versione editoriale</span>${edition ? `<h3>${escapeHtml(revision?.label || "Edizione compatibile")}</h3><p>${revision ? `${escapeHtml(statusLabel(revision.status))} · v${escapeHtml(revision.version)} · ${Number(revision.presentationCount || 0)} presentazioni` : "Edizione presente, revisione da completare."}</p>${collection.availableOperations?.canOpenEdition ? `<button type="button" class="button-secondary" data-open-item-edition="${escapeHtml(id(collection.namespace?.id))}">Apri versione</button>` : ""}` : `<h3>Versione mancante</h3><p>La raccolta usa queste Regole editoriali, ma l'Item non ha ancora una Edition compatibile. Può restare nella raccolta, ma la revisione verrà bloccata finché non la completi.</p>${collection.availableOperations?.canCreateEdition ? `<button type="button" data-create-item-edition="${escapeHtml(id(collection.namespace?.id))}">Crea versione</button>` : ""}`}</article><article class="panel"><span class="eyebrow">Semantica</span><h3>${escapeHtml(collection.semanticGraph?.name || "Grafo non disponibile")}</h3><p>${collection.semanticCoverage === "covered" ? "✓ Il Subject è presente nel grafo della raccolta." : collection.semanticCoverage === "missing" ? "⚠ Il Subject non è ancora presente nel grafo della raccolta." : "La coverage semantica non è disponibile."}</p>${collection.availableOperations?.canOpenGraph && collection.semanticGraph?.id ? `<button type="button" class="button-secondary" data-open-collection-graph="${escapeHtml(id(collection.semanticGraph))}">Apri grafo</button>` : ""}</article></div><div class="operations"><button type="button" class="button-secondary" data-open-collection="${escapeHtml(id(collection))}">Apri raccolta</button>${collection.availableOperations?.canRemove ? `<button type="button" class="button-secondary danger" data-remove-from-collection="${escapeHtml(id(collection))}">Rimuovi dalla raccolta</button>` : ""}</div></section>`;
  }

  renderBody() {
    if (this.view === "collection-picker") return this.renderCollectionPicker();
    if (this.view === "collection-detail") return this.renderCollectionDetail();
    return `${this.renderTabs()}${this.tab === "collections" ? this.renderCollections() : this.renderEditions()}`;
  }
  renderTabs() {
    return `<nav class="context-workspace-tabs item-detail-tabs" aria-label="Dettaglio Item"><button type="button" data-item-detail-tab="editions" aria-current="${this.tab === "editions" ? "page" : "false"}">Edizioni</button><button type="button" data-item-detail-tab="collections" aria-current="${this.tab === "collections" ? "page" : "false"}">Raccolte</button></nav>`;
  }

  render() {
    const header = this.data ? this.renderHeader() : `<header class="task-modal-header"><div><span class="eyebrow">Item</span><h1>Dettaglio contenuto</h1></div><button type="button" class="button-secondary small" data-close-item-detail aria-label="Chiudi">×</button></header>`;
    this.innerHTML = `<div class="context-task-modal-layer" role="presentation"><section class="context-task-modal context-task-modal--large item-detail-modal" role="dialog" aria-modal="true" aria-label="Dettaglio Item">${header}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && !this.data ? `<div class="empty-state"><p>Caricamento del contenuto…</p></div>` : this.data ? this.renderBody() : ""}</section></div>`;
  }
}

customElements.define("artaround-item-detail-dialog", ArtAroundItemDetailDialog);
