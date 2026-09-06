import { libraryRepository } from "../infrastructure/http/library-repository.js";
import { semanticRepository } from "../infrastructure/http/semantic-repository.js";
import { suggestRecognitionMedia } from "../application/subject-recognition-media.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function id(value) { return String(value?.id || value?._id || value || ""); }
function wikidataLabel(subject) {
  const identity = (subject?.externalIdentities || []).find((entry) => entry.scheme === "wikidata" && entry.role === "canonical")
    || (subject?.externalIdentities || []).find((entry) => entry.scheme === "wikidata");
  return identity?.id ? `Wikidata · ${identity.id}` : "Identità ArtAround";
}

export class ArtAroundContentSpaceItemAddDialog extends HTMLElement {
  contentSpaceId = null;
  ownerType = null;
  ownerId = null;
  spaceName = "Spazio editoriale";
  step = "subject";
  subject = null;
  addContext = null;
  recognitionMedia = null;
  mediaNotice = null;
  busy = false;
  error = null;

  connectedCallback() {
    this.contentSpaceId = this.getAttribute("content-space-id") || null;
    this.ownerType = this.getAttribute("owner-type") || null;
    this.ownerId = this.getAttribute("owner-id") || null;
    this.spaceName = this.getAttribute("space-name") || "Spazio editoriale";
    this.addEventListener("click", this.onClick);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.render();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

  close() {
    this.dispatchEvent(new CustomEvent("library-item-add-close", { bubbles: true }));
    this.remove();
  }
  async selectSubject(subject) {
    if (!subject || !this.contentSpaceId) return;
    this.subject = subject;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.addContext = await libraryRepository.itemAddContext(this.contentSpaceId, id(subject));
      this.subject = this.addContext.subject || subject;
      if ((this.addContext.ownedItems || []).length) {
        this.step = "existing";
      } else {
        await this.prepareNewItem();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile verificare i contenuti esistenti";
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async prepareNewItem() {
    this.step = "preview";
    this.recognitionMedia = null;
    this.mediaNotice = "Ricerca immagine di riconoscimento…";
    this.render();
    const suggestion = await suggestRecognitionMedia(this.subject, semanticRepository);
    this.recognitionMedia = suggestion.media;
    this.mediaNotice = suggestion.reason === "found"
      ? "Immagine di riconoscimento proposta da Wikidata e Wikimedia Commons."
      : suggestion.reason === "no_wikidata"
        ? "Il Subject non è collegato a Wikidata. L'immagine di riconoscimento resta facoltativa."
        : suggestion.reason === "unavailable"
          ? "La ricerca automatica dell'immagine non è disponibile. Puoi continuare senza immagine."
          : "Wikidata non propone un'immagine per questo Subject.";
  }

  onSubjectSelected = (event) => {
    event.stopPropagation();
    void this.selectSubject(event.detail?.subject);
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-close-item-add]")) { this.close(); return; }
    if (target.closest("[data-back-subject]")) {
      this.step = "subject";
      this.subject = null;
      this.addContext = null;
      this.recognitionMedia = null;
      this.error = null;
      this.render();
      return;
    }
    if (target.closest("[data-create-distinct-item]")) {
      this.busy = true; this.error = null; this.render();
      try { await this.prepareNewItem(); }
      finally { this.busy = false; this.render(); }
      return;
    }
    if (target.closest("[data-remove-recognition-media]")) {
      this.recognitionMedia = null;
      this.mediaNotice = "Immagine rimossa. Puoi creare l'Item senza immagine di riconoscimento.";
      this.render();
      return;
    }
    const openExisting = target.closest("[data-open-existing-item]");
    if (openExisting) {
      this.dispatchEvent(new CustomEvent("library-item-open", { bubbles: true, detail: { itemId: openExisting.dataset.openExistingItem } }));
      this.close();
      return;
    }
    const addExisting = target.closest("[data-add-existing-item]");
    if (addExisting) {
      this.busy = true; this.error = null; this.render();
      try {
        await libraryRepository.addItemToSpace(this.contentSpaceId, addExisting.dataset.addExistingItem);
        this.dispatchEvent(new CustomEvent("library-item-added", { bubbles: true, detail: { itemId: addExisting.dataset.addExistingItem, reused: true } }));
        this.close();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere l'Item allo spazio";
        this.busy = false; this.render();
      }
      return;
    }
    if (target.closest("[data-confirm-new-item]")) {
      if (!this.subject || !this.addContext?.availableOperations?.canCreateItem) return;
      this.busy = true; this.error = null; this.render();
      try {
        const item = await libraryRepository.createItem({
          primarySubjectId: id(this.subject),
          ownerType: this.ownerType,
          ownerId: this.ownerId,
          contentSpaceId: this.contentSpaceId,
          recognitionMedia: this.recognitionMedia,
        });
        this.dispatchEvent(new CustomEvent("library-item-added", { bubbles: true, detail: { itemId: id(item), reused: false } }));
        this.close();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Non è stato possibile creare l'Item";
        this.busy = false; this.render();
      }
    }
  };

  renderSubjectStep() {
    return `<section><div class="task-step-heading"><span class="eyebrow">1 · Soggetto</span><h2>Di cosa parla il contenuto?</h2><p>Cerca prima nelle identità ArtAround; se serve, la ricerca prosegue su Wikidata.</p></div><artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker></section>`;
  }

  renderExistingStep() {
    const items = this.addContext?.ownedItems || [];
    return `<section><div class="task-step-heading"><span class="eyebrow">2 · Item</span><h2>${escapeHtml(this.subject?.preferredLabel || "Subject selezionato")}</h2><p>Esistono già Item della tua area di lavoro per questo Subject. Riutilizzali quando rappresentano lo stesso contenuto editoriale; crea un Item distinto solo quando vuoi una lineage autonoma.</p></div><div class="quick-item-list">${items.map((item) => {
      const spaces = (item.spaces || []).map((space) => space.current ? `${space.name} · corrente` : space.name).join(" · ");
      return `<article class="panel quick-item-choice"><div><strong>${escapeHtml(this.subject?.preferredLabel || "Item")}</strong><p>${escapeHtml(spaces || "Nessuno spazio attivo")}</p><small>${Number(item.editionCount || 0)} ${Number(item.editionCount || 0) === 1 ? "edizione" : "edizioni"}</small></div>${item.alreadyInCurrentSpace ? `<button type="button" class="button-secondary" data-open-existing-item="${escapeHtml(id(item))}">Apri contenuto</button>` : this.addContext?.availableOperations?.canAddExistingItem ? `<button type="button" data-add-existing-item="${escapeHtml(id(item))}" ${this.busy ? "disabled" : ""}>Aggiungi allo spazio</button>` : ""}</article>`;
    }).join("")}</div>${this.addContext?.availableOperations?.canCreateItem ? `<div class="task-secondary-action"><button type="button" class="button-secondary" data-create-distinct-item ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Crea un Item distinto</button></div>` : ""}<button type="button" class="button-secondary" data-back-subject>← Cambia Subject</button></section>`;
  }

  renderPreviewStep() {
    const media = this.recognitionMedia;
    return `<section><div class="task-step-heading"><span class="eyebrow">2 · Item</span><h2>Conferma il nuovo contenuto</h2><p>L'Item viene aggiunto direttamente a <strong>${escapeHtml(this.spaceName)}</strong>. Titoli, testi, licenza e metadati editoriali verranno definiti nelle sue Edition.</p></div><article class="item-preview-card">${media?.url ? `<figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || this.subject?.preferredLabel || "")}"></figure>` : `<div class="item-preview-placeholder">${icon("image", { size: 30 })}</div>`}<div><span class="eyebrow">Subject</span><h3>${escapeHtml(this.subject?.preferredLabel || "")}</h3><p>${escapeHtml(this.subject?.description || "Nessuna descrizione disponibile")}</p><p class="note">${escapeHtml(wikidataLabel(this.subject))}</p><p class="note">${escapeHtml(this.mediaNotice || "")}</p>${media?.url ? `<button type="button" class="button-secondary small" data-remove-recognition-media>Rimuovi immagine</button>` : ""}</div></article><div class="step-actions"><button type="button" class="button-secondary" data-back-subject>Indietro</button><button type="button" data-confirm-new-item ${this.busy || !this.addContext?.availableOperations?.canCreateItem ? "disabled" : ""}>${icon("plus", { size: 15 })} Aggiungi contenuto</button></div></section>`;
  }

  render() {
    const body = this.step === "existing" ? this.renderExistingStep() : this.step === "preview" ? this.renderPreviewStep() : this.renderSubjectStep();
    this.innerHTML = `<div class="context-task-modal-layer" role="presentation"><section class="context-task-modal content-space-item-add-modal" role="dialog" aria-modal="true" aria-label="Aggiungi contenuto"><header class="task-modal-header"><div><span class="eyebrow">${escapeHtml(this.spaceName)}</span><h1>Aggiungi contenuto</h1></div><button type="button" class="button-secondary small" data-close-item-add aria-label="Chiudi">×</button></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && this.step === "subject" ? `<p>Preparazione…</p>` : body}</section></div>`;
  }
}

customElements.define("artaround-content-space-item-add-dialog", ArtAroundContentSpaceItemAddDialog);
