import { navigate } from "../application/router.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundEditorialCollectionContentManager extends HTMLElement {
  editorialContextId = null;
  contentSpaceId = null;
  namespaceId = null;
  editable = false;
  locked = false;
  entriesData = null;
  candidateData = null;
  query = "";
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
  }

  configure({ editorialContextId, contentSpaceId, namespaceId, editable = false, locked = false } = {}) {
    this.editorialContextId = editorialContextId || null;
    this.contentSpaceId = contentSpaceId || null;
    this.namespaceId = namespaceId || null;
    this.editable = editable === true;
    this.locked = locked === true;
    if (this.isConnected) this.load();
  }

  async load() {
    if (!this.editorialContextId) { this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [entriesData, candidateData] = await Promise.all([
        editorialRepository.entries(this.editorialContextId, { page: 1, limit: 60 }),
        editorialRepository.candidates(this.editorialContextId, { q: this.query, page: 1, limit: 40 }),
      ]);
      this.entriesData = entriesData;
      this.candidateData = candidateData;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i contenuti della raccolta";
    } finally { this.busy = false; this.render(); }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-search-candidates]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    await this.load();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest("button[data-open-item]");
    if (open) {
      navigate(`/workspace/item-authoring?itemId=${encodeURIComponent(open.dataset.openItem)}`);
      return;
    }
    const add = target?.closest("button[data-add-edition]");
    if (add && this.editable && !this.locked) {
      await this.mutate(() => editorialRepository.addEntry(this.editorialContextId, { itemEditionId: add.dataset.addEdition, curationSignals: [] }));
      return;
    }
    const remove = target?.closest("button[data-remove-entry]");
    if (remove && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questo contenuto dalla raccolta?",
        message: "L'Item e lo spazio editoriale resteranno invariati.",
        confirmLabel: "Rimuovi",
        tone: "danger",
      });
      if (!confirmed) return;
      await this.mutate(() => editorialRepository.removeEntry(this.editorialContextId, remove.dataset.removeEntry));
      return;
    }
    if (target?.closest("button[data-create-context-content]")) {
      const params = new URLSearchParams();
      if (this.contentSpaceId) params.set("contentSpaceId", this.contentSpaceId);
      if (this.editorialContextId) params.set("editorialContextId", this.editorialContextId);
      if (this.namespaceId) params.set("namespaceId", this.namespaceId);
      navigate(`/workspace/item-authoring?${params.toString()}`);
    }
  };

  async mutate(operation) {
    this.busy = true; this.error = null; this.render();
    try {
      await operation();
      await this.load();
      this.dispatchEvent(new CustomEvent("editorial-content-changed", { bubbles: true }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non completata";
      this.busy = false; this.render();
    }
  }

  renderEntry(row) {
    const entry = row?.entry || {};
    const revision = row?.revision || {};
    const subject = row?.subject || {};
    const item = row?.item || {};
    const state = revision.status || "senza revisione";
    return `<article class="collection-content-row"><div class="row-main"><strong>${escapeHtml(revision.label || subject.preferredLabel || "Contenuto")}</strong><span>${escapeHtml(subject.preferredLabel || "Subject")}</span><small>${escapeHtml(state)}${revision.version ? ` · v${escapeHtml(revision.version)}` : ""}</small></div><div class="button-row"><button type="button" class="button-secondary small" data-open-item="${escapeHtml(id(item))}">${icon("edit", { size: 15 })} Apri</button>${this.editable && !this.locked ? `<button type="button" class="button-secondary small danger" data-remove-entry="${escapeHtml(id(entry))}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</div></article>`;
  }

  renderCandidate(row) {
    const subject = row?.subject || {};
    const revision = row?.revision || {};
    return `<article class="candidate-row"><div><strong>${escapeHtml(revision.label || subject.label || "Contenuto")}</strong><span>${escapeHtml(subject.label || "Subject")}</span><small>${revision.status ? escapeHtml(revision.status) : "Nessuna revisione disponibile"}</small></div>${row.inCollection ? `<span class="status-pill success">Già nella raccolta</span>` : this.editable && !this.locked ? `<button type="button" class="button-secondary small" data-add-edition="${escapeHtml(row.itemEditionId)}">${icon("plus", { size: 15 })} Aggiungi</button>` : ""}</article>`;
  }

  render() {
    const entries = this.entriesData?.results || [];
    const candidates = this.candidateData?.results || [];
    const disabledNote = this.locked ? `<div class="inline-notice">${icon("lock", { size: 16 })}<span>La composizione è bloccata durante la revisione.</span></div>` : "";
    this.innerHTML = `<style>
      artaround-editorial-collection-content-manager{display:grid;gap:1rem}
      artaround-editorial-collection-content-manager .manager-toolbar{display:flex;justify-content:space-between;gap:.8rem;align-items:center;flex-wrap:wrap}
      artaround-editorial-collection-content-manager .content-list,artaround-editorial-collection-content-manager .candidate-list{display:grid;gap:.55rem}
      artaround-editorial-collection-content-manager .collection-content-row,artaround-editorial-collection-content-manager .candidate-row{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.85rem 1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}
      artaround-editorial-collection-content-manager .row-main,artaround-editorial-collection-content-manager .candidate-row>div{display:grid;gap:.15rem;min-width:0}
      artaround-editorial-collection-content-manager .row-main span,artaround-editorial-collection-content-manager .candidate-row span{color:var(--muted)}
      artaround-editorial-collection-content-manager .search-box{display:flex;gap:.5rem;align-items:end;flex-wrap:wrap}
      artaround-editorial-collection-content-manager .search-box label{min-width:min(22rem,100%)}
      artaround-editorial-collection-content-manager .inline-notice{display:flex;gap:.5rem;align-items:center;padding:.7rem .85rem;border-radius:var(--radius);background:var(--surface-subtle)}
      @media(max-width:44rem){artaround-editorial-collection-content-manager .collection-content-row,artaround-editorial-collection-content-manager .candidate-row{align-items:flex-start;flex-direction:column}}
    </style><section aria-busy="${this.busy}">${disabledNote}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<div class="manager-toolbar"><div><h2>Contenuti della raccolta</h2><p class="muted">${entries.length} contenuti caricati. La raccolta usa soltanto versioni compatibili con le sue regole editoriali.</p></div>${this.editable && !this.locked ? `<button type="button" data-create-context-content>${icon("plus", { size: 16 })} Crea nuovo contenuto</button>` : ""}</div><div class="content-list">${entries.length ? entries.map((row) => this.renderEntry(row)).join("") : `<div class="empty-state"><h3>La raccolta è vuota</h3><p>Aggiungi contenuti già presenti nello spazio oppure creane uno nuovo direttamente in questo contesto.</p></div>`}</div><hr><div class="manager-toolbar"><div><h3>Aggiungi dallo spazio editoriale</h3><p class="muted">Sono mostrati solo gli Item che hanno una versione per il Namespace della raccolta.</p></div><form class="search-box" data-search-candidates><label>Cerca<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo o soggetto"></label><button type="submit" class="button-secondary">${icon("search", { size: 16 })} Cerca</button></form></div><div class="candidate-list">${candidates.length ? candidates.map((row) => this.renderCandidate(row)).join("") : `<div class="empty-state"><p>Nessun contenuto compatibile trovato.</p></div>`}</div></section>`;
  }
}

customElements.define("artaround-editorial-collection-content-manager", ArtAroundEditorialCollectionContentManager);
