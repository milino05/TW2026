import { libraryRepository } from "../infrastructure/http/library-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
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
function pricingLabel(pricing) {
  if (!pricing || pricing.type === "free") return "Gratis";
  const amount = Number(pricing.amountMinor || 0) / 100;
  return `${amount.toFixed(2)} ${pricing.currency || ""}`.trim();
}

export class ArtAroundContentSpaceItemAddDialog extends HTMLElement {
  contentSpaceId = null;
  ownerType = null;
  ownerId = null;
  spaceName = "Spazio editoriale";
  origin = null;
  step = "subject";
  subject = null;
  addContext = null;
  recognitionMedia = null;
  mediaNotice = null;
  distinctLineage = false;
  distinctReturnStep = "existing";
  busy = false;
  error = null;

  connectedCallback() {
    this.contentSpaceId = this.getAttribute("content-space-id") || null;
    this.ownerType = this.getAttribute("owner-type") || null;
    this.ownerId = this.getAttribute("owner-id") || null;
    this.spaceName = this.getAttribute("space-name") || "Spazio editoriale";
    this.origin = this.getAttribute("origin") || null;
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
    this.distinctLineage = false;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.addContext = await libraryRepository.itemAddContext(this.contentSpaceId, id(subject));
      this.subject = this.addContext.subject || subject;
      if ((this.addContext.ownedItems || []).length) {
        this.step = "existing";
      } else if ((this.addContext.marketplaceOptions || []).length) {
        this.step = "marketplace";
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
      this.distinctLineage = false;
      this.error = null;
      this.render();
      return;
    }
    if (target.closest("[data-create-distinct-item]")) {
      this.distinctReturnStep = this.step === "marketplace" ? "marketplace" : "existing";
      this.step = "distinct-confirm";
      this.error = null;
      this.render();
      return;
    }
    if (target.closest("[data-cancel-distinct-lineage]")) {
      this.step = this.distinctReturnStep;
      this.distinctLineage = false;
      this.render();
      return;
    }
    if (target.closest("[data-confirm-distinct-lineage]")) {
      this.distinctLineage = true;
      this.busy = true; this.error = null; this.render();
      try { await this.prepareNewItem(); }
      finally { this.busy = false; this.render(); }
      return;
    }
    if (target.closest("[data-remove-recognition-media]")) {
      this.recognitionMedia = null;
      this.mediaNotice = "Immagine rimossa. Puoi continuare senza immagine di riconoscimento.";
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
        this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere il contenuto allo spazio";
        this.busy = false; this.render();
      }
      return;
    }
    const acquireMarketplace = target.closest("[data-acquire-marketplace-item]");
    if (acquireMarketplace) {
      const offerId = acquireMarketplace.dataset.acquireMarketplaceItem;
      const editionId = acquireMarketplace.dataset.marketplaceEditionId;
      if (!offerId || !editionId || !this.addContext?.availableOperations?.canAcquireAndForkMarketplaceItem) return;
      this.busy = true; this.error = null; this.render();
      try {
        await marketplaceRepository.acquire(offerId, {
          beneficiaryType: this.ownerType,
          beneficiaryId: this.ownerId,
        });
        const result = await marketplaceRepository.executeWorkspaceOperation({
          operationCode: "content.fork",
          sourceRef: { resourceType: "item_edition", resourceId: editionId },
          targetPrincipal: { type: this.ownerType, id: this.ownerId },
          payload: { contentSpaceId: this.contentSpaceId },
        });
        const itemId = id(result?.resultRef?.resourceId);
        if (!itemId) throw new Error("Il Marketplace non ha restituito il nuovo contenuto");
        this.dispatchEvent(new CustomEvent("library-item-added", {
          bubbles: true,
          detail: { itemId, reused: false, acquired: true, forked: true },
        }));
        this.close();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Non è stato possibile acquisire e aggiungere il contenuto";
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
          creationMode: this.distinctLineage ? "distinct_lineage" : "reuse_first",
        });
        this.dispatchEvent(new CustomEvent("library-item-added", { bubbles: true, detail: { itemId: id(item), reused: false, distinct: this.distinctLineage } }));
        this.close();
      } catch (error) {
        if (error?.code === "ITEM_REUSE_AVAILABLE") {
          const selected = this.subject;
          await this.selectSubject(selected);
          this.error = "Esiste già un contenuto da riutilizzare o verificare. Sceglilo dall'elenco; crea un contenuto indipendente solo se è davvero distinto.";
          this.render();
          return;
        }
        this.error = error instanceof Error ? error.message : "Non è stato possibile creare il contenuto";
        this.busy = false; this.render();
      }
    }
  };

  renderSubjectStep() {
    return `<section><div class="task-step-heading"><span class="eyebrow">1 · Soggetto</span><h2>Di cosa parla il contenuto?</h2><p>Cerca prima nelle identità ArtAround; se serve, la ricerca prosegue su Wikidata.</p></div><artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker></section>`;
  }

  renderExistingStep() {
    const items = this.addContext?.ownedItems || [];
    return `<section><div class="task-step-heading"><span class="eyebrow">2 · Riusa contenuto</span><h2>${escapeHtml(this.subject?.preferredLabel || "Soggetto selezionato")}</h2><p>Prima di crearne uno nuovo, scegli un contenuto esistente quando rappresenta ciò che stai cercando.</p></div><div class="quick-item-list">${items.map((item) => {
      const spaces = (item.spaces || []).map((space) => space.current ? `${space.name} · corrente` : space.name).join(" · ");
      const candidateSubject = item.subject || this.subject || {};
      const possibleHomonym = item.matchReason === "same_label";
      return `<article class="panel quick-item-choice"><div><strong>${escapeHtml(candidateSubject.preferredLabel || "Contenuto")}</strong>${possibleHomonym ? `<p class="note">Stesso nome, identità distinta: verifica che sia davvero lo stesso soggetto prima di riutilizzarlo.</p>` : ""}<p>${escapeHtml(spaces || "Nessuno spazio attivo")}</p><small>${Number(item.editionCount || 0)} ${Number(item.editionCount || 0) === 1 ? "edizione" : "edizioni"}</small></div>${item.alreadyInCurrentSpace ? `<button type="button" class="button-secondary" data-open-existing-item="${escapeHtml(id(item))}">Usa questo contenuto</button>` : this.addContext?.availableOperations?.canAddExistingItem ? `<button type="button" data-add-existing-item="${escapeHtml(id(item))}" ${this.busy ? "disabled" : ""}>Riusa nello spazio</button>` : ""}</article>`;
    }).join("")}</div>${this.addContext?.availableOperations?.canCreateItem ? `<div class="task-secondary-action"><button type="button" class="button-secondary" data-create-distinct-item ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Crea contenuto indipendente</button></div>` : ""}<button type="button" class="button-secondary" data-back-subject>← Cambia soggetto</button></section>`;
  }

  renderDistinctConfirmStep() {
    return `<section><div class="task-step-heading"><span class="eyebrow">Conferma</span><h2>Creare un contenuto indipendente?</h2><p>Esiste già almeno un contenuto da riutilizzare o verificare. Continuando ne verrà creato un altro separato nello Spazio editoriale.</p></div><div class="step-actions"><button type="button" class="button-secondary" data-cancel-distinct-lineage>← Torna ai contenuti esistenti</button><button type="button" data-confirm-distinct-lineage ${this.busy ? "disabled" : ""}>Crea contenuto indipendente</button></div></section>`;
  }

  renderMarketplaceStep() {
    const options = this.addContext?.marketplaceOptions || [];
    const canAcquire = this.addContext?.availableOperations?.canAcquireAndForkMarketplaceItem;
    return `<section><div class="task-step-heading"><span class="eyebrow">2 · Marketplace</span><h2>${escapeHtml(this.subject?.preferredLabel || "Soggetto selezionato")}</h2><p>Acquisire una proposta creerà un nuovo contenuto indipendente nello Spazio editoriale, derivato dalla versione acquistata.</p></div>${!canAcquire ? `<p class="note" role="status">Nel contesto corrente non hai i permessi necessari per acquisire questo contenuto.</p>` : ""}<div class="quick-item-list">${options.map((option) => `<article class="panel quick-item-choice"><div><span class="eyebrow">Marketplace</span><strong>${escapeHtml(option.listingTitle || this.subject?.preferredLabel || "Contenuto")}</strong>${option.listingSummary ? `<p>${escapeHtml(option.listingSummary)}</p>` : ""}<small>${escapeHtml(option.offerLabel || "Offerta")} · ${escapeHtml(pricingLabel(option.pricing))}</small></div><button type="button" data-acquire-marketplace-item="${escapeHtml(id(option.offerId))}" data-marketplace-edition-id="${escapeHtml(id(option.editionId))}" ${this.busy || !canAcquire ? "disabled" : ""}>Crea copia indipendente e aggiungi</button></article>`).join("")}</div>${this.addContext?.availableOperations?.canCreateItem ? `<div class="task-secondary-action"><button type="button" class="button-secondary" data-create-distinct-item ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Crea contenuto indipendente da zero</button></div>` : ""}<button type="button" class="button-secondary" data-back-subject>← Cambia soggetto</button></section>`;
  }

  renderPreviewStep() {
    const media = this.recognitionMedia;
    const distinctNotice = this.distinctLineage
      ? `<p class="note">Stai creando un contenuto indipendente da quelli già trovati nello Spazio editoriale.</p>`
      : "";
    return `<section><div class="task-step-heading"><span class="eyebrow">2 · Contenuto</span><h2>Conferma il nuovo contenuto</h2>${distinctNotice}</div><article class="item-preview-card">${media?.url ? `<figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || this.subject?.preferredLabel || "")}"></figure>` : `<div class="item-preview-placeholder">${icon("image", { size: 30 })}</div>`}<div><span class="eyebrow">Soggetto</span><h3>${escapeHtml(this.subject?.preferredLabel || "")}</h3><p>${escapeHtml(this.subject?.description || "Nessuna descrizione disponibile")}</p><p class="note">${escapeHtml(wikidataLabel(this.subject))}</p><p class="note">${escapeHtml(this.mediaNotice || "")}</p>${media?.url ? `<button type="button" class="button-secondary small" data-remove-recognition-media>Rimuovi immagine</button>` : ""}</div></article><div class="step-actions"><button type="button" class="button-secondary" data-back-subject>Indietro</button><button type="button" data-confirm-new-item ${this.busy || !this.addContext?.availableOperations?.canCreateItem ? "disabled" : ""}>${icon("plus", { size: 15 })} Aggiungi contenuto</button></div></section>`;
  }

  render() {
    const body = this.step === "existing"
      ? this.renderExistingStep()
      : this.step === "marketplace"
        ? this.renderMarketplaceStep()
        : this.step === "distinct-confirm"
          ? this.renderDistinctConfirmStep()
          : this.step === "preview"
            ? this.renderPreviewStep()
            : this.renderSubjectStep();
    this.innerHTML = `<div class="context-task-modal-layer" role="presentation"><section class="context-task-modal content-space-item-add-modal" role="dialog" aria-modal="true" aria-label="Aggiungi contenuto"><header class="task-modal-header"><div><span class="eyebrow">${escapeHtml(this.spaceName)}</span><h1>Aggiungi contenuto</h1></div><button type="button" class="button-secondary small" data-close-item-add aria-label="Chiudi">×</button></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.busy && this.step === "subject" ? `<p>Preparazione…</p>` : body}</section></div>`;
  }
}

customElements.define("artaround-content-space-item-add-dialog", ArtAroundContentSpaceItemAddDialog);
