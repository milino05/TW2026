import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { resolveEditorialSpacePreference } from "../application/editorial-space-preference.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { semanticRepository } from "../infrastructure/http/semantic-repository.js";
import { userFacingIssueMessage } from "../application/user-facing-errors.js";
import { navigate, replaceCurrentHistoryUrl } from "../application/router.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";
import "./subject-presence.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function params() { return new URLSearchParams(window.location.search); }
function id(value) { return String(value?.id || value?._id || value || ""); }
function isWorkflowOperation(code) { return String(code || "").startsWith("workflow."); }
function safeExternalHref(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}
function writableMedia(entry, { includeId = true } = {}) {
  if (!entry) return null;
  return {
    ...(includeId && id(entry) ? { _id: id(entry) } : {}),
    url: String(entry.url || ""),
    originalUrl: entry.originalUrl || null,
    altText: entry.altText || null,
    mimeType: entry.mimeType || null,
    width: entry.width || null,
    height: entry.height || null,
    source: entry.source ? { ...entry.source } : null,
    rights: entry.rights ? { ...entry.rights } : null,
  };
}
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("Non è stato possibile leggere l'immagine")), { once: true });
    reader.readAsDataURL(file);
  });
}
function canvasAsBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Non è stato possibile ottimizzare l'immagine")),
    mimeType,
    quality,
  ));
}
async function optimizedMediaFile(file) {
  const maxBytes = 700 * 1024;
  if (file.size <= maxBytes) return file;
  if (typeof createImageBitmap !== "function") throw new Error("L'immagine è troppo grande. Scegline una più piccola di 700 KB.");
  const bitmap = await createImageBitmap(file);
  try {
    for (const option of [{ maxSide: 1600, quality: .82 }, { maxSide: 1200, quality: .7 }, { maxSide: 900, quality: .58 }]) {
      const scale = Math.min(1, option.maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Non è stato possibile preparare l'immagine");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const optimized = await canvasAsBlob(canvas, "image/webp", option.quality);
      if (optimized.size <= maxBytes) return optimized;
    }
  } finally { bitmap.close(); }
  throw new Error("Non è stato possibile ridurre abbastanza l'immagine. Scegline una più leggera.");
}
function projectedRevisionToWrite(revision) {
  return {
    label: revision.label,
    relatedSubjectIds: (revision.relatedSubjects || []).map((entry) => entry.id).filter(Boolean),
    tags: revision.tags || [],
    authorCredits: revision.authorCredits || [],
    metadata: { license: revision.license || null },
    illustrativeMedia: (revision.illustrativeMedia || []).map((entry) => writableMedia(entry)).filter(Boolean),
    selectionSignals: (revision.selectionSignals || []).map((entry) => ({ definitionId: entry.definitionId, weight: entry.weight })),
    presentationVariants: (revision.presentationVariants || []).map((variant) => ({
      _id: variant.id,
      key: variant.key,
      label: variant.label,
      description: variant.description || null,
      semanticFocus: (variant.semanticFocus || []).map((entry) => ({ subjectId: entry.subject?.id, weight: entry.weight })).filter((entry) => entry.subjectId),
      presentationAspects: (variant.presentationAspects || []).map((entry) => ({ definitionId: entry.definitionId, weight: entry.weight })),
      knowledgeRequirements: (variant.knowledgeRequirements || []).map((entry) => ({ subjectId: entry.subject?.id, minLevel: entry.minLevel, maxLevel: entry.maxLevel, weight: entry.weight })).filter((entry) => entry.subjectId),
      representations: (variant.representations || []).map((entry) => ({
        _id: entry.id,
        durationTypeDefinitionId: entry.duration.definitionId,
        languageLevelDefinitionId: entry.languageComplexity.definitionId,
        locale: entry.locale,
        text: entry.text,
      })),
    })),
    defaultPresentation: revision.defaultPresentation || null,
  };
}
function newRepresentation(overrides = {}) {
  return {
    id: id(overrides.id || overrides._id),
    durationTypeDefinitionId: String(overrides.durationTypeDefinitionId || ""),
    languageLevelDefinitionId: String(overrides.languageLevelDefinitionId || ""),
    locale: String(overrides.locale || "it-IT"),
    text: String(overrides.text || ""),
  };
}
function normalizedSelectionSignals(values = []) {
  const result = [];
  const seen = new Set();
  for (const entry of Array.isArray(values) ? values : []) {
    const definitionId = String(entry?.definitionId || "").trim();
    if (!definitionId || seen.has(definitionId)) continue;
    const weight = Number(entry?.weight ?? 1);
    result.push({ definitionId, weight: Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 1 });
    seen.add(definitionId);
  }
  return result;
}
function newDraft(author = "", illustrativeMedia = []) {
  return {
    namespaceId: "",
    label: "",
    author: String(author || "").trim(),
    license: "",
    illustrativeMedia: illustrativeMedia.map((entry) => writableMedia(entry, { includeId: false })).filter(Boolean).slice(0, 1),
    selectionSignals: [],
    representations: [],
  };
}
function normalizedWorkingDraft(value, defaultAuthor = "") {
  const source = value && typeof value === "object" ? value : {};
  return {
    namespaceId: String(source.namespaceId || ""),
    label: String(source.label || ""),
    author: String(source.author || defaultAuthor || "").trim(),
    license: String(source.license || ""),
    illustrativeMedia: (Array.isArray(source.illustrativeMedia) ? source.illustrativeMedia : [])
      .map((entry) => writableMedia(entry, { includeId: false })).filter(Boolean).slice(0, 1),
    selectionSignals: normalizedSelectionSignals(source.selectionSignals),
    representations: (Array.isArray(source.representations) ? source.representations : []).map((entry) => newRepresentation(entry)),
  };
}

export class ItemAuthoringView extends HTMLElement {
  context = readOperatingContext();
  workspace = null;
  preflight = null;
  principal = null;
  selectedSubject = null;
  itemId = params().get("itemId") || null;
  preselectedSubjectId = params().get("subjectId") || null;
  contextContentSpaceId = params().get("contentSpaceId") || null;
  contextEditorialContextId = params().get("editorialContextId") || null;
  contextNamespaceId = params().get("namespaceId") || null;
  projection = null;
  namespaceControls = null;
  activeStep = 1;
  activeRepresentationIndex = null;
  mediaEditorOpen = false;
  mediaBusy = false;
  mediaSuggestionAttempted = false;
  mediaNotice = null;
  newEditionMode = false;
  draft = newDraft();
  busy = false;
  error = null;
  notice = null;
  privateSuccessOpen = false;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("invalid", this.onInvalid, true);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.bootstrap();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("invalid", this.onInvalid, true);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

  availableOperation(code) { return (this.projection?.availableOperations || []).find((operation) => operation.code === code) || null; }
  workflowOperations() {
    return (this.projection?.availableOperations || [])
      .filter((operation) => isWorkflowOperation(operation.code))
      .filter((operation) => operation.code === "workflow.check");
  }
  selectedRevision() { return this.projection?.selected?.revision || null; }
  selectedEdition() { return this.projection?.selected?.edition || null; }
  selectedNamespace() { return this.projection?.selected?.namespace || null; }
  firstVariant() { return this.selectedRevision()?.presentationVariants?.[0] || null; }
  firstRepresentation() { return this.firstVariant()?.representations?.[0] || null; }
  defaultAuthor() { return String(this.workspace?.principal?.name || this.context?.name || "").trim(); }
  currentMedia() { return this.draft.illustrativeMedia?.[0] || null; }
  inCollectionContext() { return Boolean(this.contextContentSpaceId && this.contextEditorialContextId && this.contextNamespaceId); }
  collectionReturnHref() { return this.contextEditorialContextId ? `/workspace/editorial-studio?editorialContextId=${encodeURIComponent(this.contextEditorialContextId)}&section=content` : "/workspace"; }

  workingDraftStorageKey() {
    const principalType = String(this.principal?.type || "");
    const principalId = id(this.principal?.id);
    if (!this.itemId || !principalType || !principalId) return "";
    return `artaround:item-authoring-draft:v2:${encodeURIComponent(principalType)}:${encodeURIComponent(principalId)}:${encodeURIComponent(this.itemId)}`;
  }
  persistWorkingDraft() {
    if (!this.itemId || ![2, 3].includes(this.activeStep)) return;
    const key = this.workingDraftStorageKey(); if (!key) return;
    const isNewWorkingDraft = this.newEditionMode || !this.selectedRevision();
    try {
      window.sessionStorage.setItem(key, JSON.stringify({
        version: 2,
        activeStep: this.activeStep,
        mode: isNewWorkingDraft ? "new" : "edit",
        editionId: isNewWorkingDraft ? null : id(this.selectedEdition()?.id),
        revisionId: isNewWorkingDraft ? null : id(this.selectedRevision()?.id),
        activeRepresentationIndex: Number.isInteger(this.activeRepresentationIndex) ? this.activeRepresentationIndex : null,
        mediaEditorOpen: Boolean(this.mediaEditorOpen),
        draft: normalizedWorkingDraft(this.draft, this.defaultAuthor()),
      }));
    } catch { /* Draft locale best effort. */ }
  }
  readWorkingDraft() {
    const key = this.workingDraftStorageKey(); if (!key) return null;
    try {
      const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
      return value?.version === 2 && ["new", "edit"].includes(value.mode) ? value : null;
    } catch { return null; }
  }
  clearWorkingDraft() {
    const key = this.workingDraftStorageKey(); if (!key) return;
    try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
  }
  async restoreWorkingDraft() {
    const stored = this.readWorkingDraft(); if (!stored) return false;
    if (stored.mode === "edit") {
      const revision = this.selectedRevision();
      if (!revision || id(this.selectedEdition()?.id) !== String(stored.editionId || "") || id(revision?.id) !== String(stored.revisionId || "")) {
        this.clearWorkingDraft(); return false;
      }
      this.newEditionMode = false;
      this.namespaceControls = null;
      this.draft = normalizedWorkingDraft(stored.draft, this.defaultAuthor());
    } else {
      const choices = this.usableNamespaceChoices({ excludeUsed: true });
      this.newEditionMode = true;
      this.namespaceControls = null;
      this.draft = normalizedWorkingDraft(stored.draft, this.defaultAuthor());
      const preferred = this.contextNamespaceId || this.draft.namespaceId;
      if (preferred && choices.some((entry) => entry.id === preferred)) await this.selectNamespace(preferred);
      else if (choices.length === 1) await this.selectNamespace(choices[0].id);
      else this.draft.namespaceId = "";
    }
    const restoredIndex = Number(stored.activeRepresentationIndex);
    this.activeRepresentationIndex = Number.isInteger(restoredIndex) && this.draft.representations[restoredIndex] ? restoredIndex : null;
    this.mediaEditorOpen = Boolean(stored.mediaEditorOpen && this.currentMedia());
    this.mediaSuggestionAttempted = Boolean(this.currentMedia());
    this.activeStep = Number(stored.activeStep) === 3 && this.generalDetailsReady() ? 3 : 2;
    this.notice = "Bozza ripristinata dopo l'aggiornamento della pagina.";
    return true;
  }

  wikidataIdentity() {
    const identities = this.selectedSubject?.externalIdentities || [];
    return identities.find((entry) => entry.scheme === "wikidata" && entry.role === "canonical")
      || identities.find((entry) => entry.scheme === "wikidata") || null;
  }
  async loadSuggestedMedia({ force = false } = {}) {
    if (this.currentMedia() || (this.mediaSuggestionAttempted && !force)) return;
    const identity = this.wikidataIdentity();
    if (!identity) {
      this.mediaSuggestionAttempted = true;
      this.mediaNotice = "Questo Subject non è collegato a Wikidata: puoi comunque aggiungere un'immagine.";
      return;
    }
    this.mediaBusy = true; this.mediaNotice = null; this.render();
    try {
      const resolution = await semanticRepository.resolveExternal({ scheme: "wikidata", id: identity.id, locale: "it", includeMedia: true });
      const candidate = resolution.mediaCandidates?.[0] || null;
      if (candidate) {
        this.draft.illustrativeMedia = [writableMedia(candidate, { includeId: false })];
        this.mediaEditorOpen = false;
        this.mediaNotice = "Immagine proposta da Wikidata e Wikimedia Commons.";
      } else this.mediaNotice = "Wikidata non propone immagini per questo Subject. Puoi aggiungerne una manualmente.";
    } catch { this.mediaNotice = "La ricerca automatica dell'immagine non è disponibile. Puoi continuare senza immagine."; }
    finally { this.mediaSuggestionAttempted = true; this.mediaBusy = false; this.persistWorkingDraft(); this.render(); }
  }
  async uploadMediaFile(file) {
    if (!file) return;
    const optimized = await optimizedMediaFile(file);
    const uploaded = await authoringRepository.uploadItemMedia({
      fileName: file.name,
      mimeType: optimized.type || file.type,
      dataBase64: await fileAsBase64(optimized),
      altText: this.currentMedia()?.altText || this.selectedSubject?.preferredLabel || "",
    });
    this.draft.illustrativeMedia = [writableMedia(uploaded, { includeId: false })];
    this.mediaEditorOpen = true;
    this.mediaSuggestionAttempted = true;
    this.mediaNotice = "Immagine caricata. Controlla la descrizione prima di salvare.";
    this.persistWorkingDraft();
  }

  async bootstrap() {
    this.busy = true; this.error = null; this.render();
    try {
      await this.reloadAuthoringContext();
      if (this.preselectedSubjectId) {
        this.selectedSubject = await authoringRepository.getSubject(this.preselectedSubjectId);
        await this.loadSuggestedMedia();
      }
      if (this.itemId) {
        await this.reloadProjection();
        if (this.contextNamespaceId) {
          const contextualEdition = (this.projection?.editions || []).find((edition) => id(edition.namespace?.id) === id(this.contextNamespaceId));
          if (contextualEdition && id(this.selectedEdition()?.id) !== id(contextualEdition.id)) await this.reloadProjection(contextualEdition.id);
        }
        await this.loadSuggestedMedia();
        const restored = await this.restoreWorkingDraft();
        if (!restored) {
          if (this.selectedRevision()) this.activeStep = 4;
          else await this.prepareNewEdition();
        }
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Impossibile inizializzare l'editor"; }
    finally { this.busy = false; this.render(); }
  }
  async reloadAuthoringContext() {
    const selected = operatingPrincipal(this.context);
    if (!selected) throw new Error("Area di lavoro non selezionata");
    const [workspace, preflight] = await Promise.all([
      marketplaceRepository.workspaceContext(selected),
      marketplaceRepository.authoringPreflight(selected),
    ]);
    this.workspace = workspace;
    this.preflight = preflight;
    this.principal = { type: workspace.principal.type, id: workspace.principal.id };
    if (!this.itemId) {
      const spaces = workspace.contentSpaces || [];
      if (this.contextContentSpaceId) {
        const requested = spaces.find((space) => id(space) === id(this.contextContentSpaceId));
        if (!requested) throw new Error("Lo spazio editoriale scelto non è disponibile in questa area di lavoro.");
      } else {
        const preferred = resolveEditorialSpacePreference(selected, spaces);
        if (!preferred) throw new Error("Crea o seleziona prima uno spazio editoriale dalla Libreria.");
        this.contextContentSpaceId = id(preferred);
      }
    }
    if (!this.draft.author) this.draft.author = this.defaultAuthor();
  }
  hydrateDraftFromProjection() {
    if (this.newEditionMode) return;
    const revision = this.selectedRevision(); if (!revision) return;
    this.draft = {
      namespaceId: id(this.selectedNamespace()?.id),
      label: revision.label || "",
      author: revision.authorCredits?.[0] || this.defaultAuthor(),
      license: revision.license || "",
      illustrativeMedia: (revision.illustrativeMedia || []).map((entry) => writableMedia(entry)).filter(Boolean).slice(0, 1),
      selectionSignals: normalizedSelectionSignals(revision.selectionSignals),
      representations: (this.firstVariant()?.representations || []).map((entry) => newRepresentation({
        id: entry.id,
        durationTypeDefinitionId: entry.duration?.definitionId,
        languageLevelDefinitionId: entry.languageComplexity?.definitionId,
        locale: entry.locale,
        text: entry.text,
      })),
    };
    if (this.draft.illustrativeMedia.length) this.mediaSuggestionAttempted = true;
  }
  async reloadProjection(editionId = null) {
    if (!this.itemId) return;
    this.projection = await authoringRepository.projection(this.itemId, { editionId });
    this.selectedSubject = this.projection.subject;
    const owner = this.projection.lineage?.owner;
    if (owner && (!this.principal || owner.type !== this.principal.type || id(owner.id) !== id(this.principal.id))) {
      throw new Error("Questo contenuto appartiene a un'altra area di lavoro. Cambia area prima di modificarlo.");
    }
    this.hydrateDraftFromProjection();
  }
  usableNamespaceChoices({ excludeUsed = false } = {}) {
    const used = new Set(excludeUsed ? (this.projection?.editions || []).map((edition) => id(edition.namespace?.id)).filter(Boolean) : []);
    return (this.preflight?.content?.usableNamespaces || [])
      .filter((entry) => !used.has(id(entry.id)))
      .map((entry) => ({ id: id(entry.id), name: entry.name, ownership: entry.source }));
  }
  async prepareNewEdition() {
    if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
    const illustrativeMedia = this.draft.illustrativeMedia || [];
    this.newEditionMode = true;
    this.namespaceControls = null;
    this.draft = newDraft(this.defaultAuthor(), illustrativeMedia);
    this.activeRepresentationIndex = null;
    this.activeStep = 2;
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    const preferred = this.contextNamespaceId && choices.some((entry) => entry.id === id(this.contextNamespaceId)) ? id(this.contextNamespaceId) : null;
    if (preferred) await this.selectNamespace(preferred);
    else if (choices.length === 1) await this.selectNamespace(choices[0].id);
    this.persistWorkingDraft();
  }
  async selectNamespace(namespaceId) {
    this.draft.namespaceId = String(namespaceId || "");
    this.namespaceControls = null;
    if (!this.draft.namespaceId) { this.draft.selectionSignals = []; return; }
    this.namespaceControls = await authoringRepository.namespaceControls(this.draft.namespaceId, this.principal);
    const durationIds = new Set((this.namespaceControls?.controls?.durationTypes || []).map((entry) => entry.definitionId));
    const languageIds = new Set((this.namespaceControls?.controls?.languageLevels || []).map((entry) => entry.definitionId));
    const signalIds = new Set((this.namespaceControls?.controls?.selectionSignals || []).map((entry) => entry.definitionId));
    this.draft.selectionSignals = normalizedSelectionSignals(this.draft.selectionSignals).filter((entry) => signalIds.has(entry.definitionId));
    for (const representation of this.draft.representations) {
      if (!durationIds.has(representation.durationTypeDefinitionId)) representation.durationTypeDefinitionId = "";
      if (!languageIds.has(representation.languageLevelDefinitionId)) representation.languageLevelDefinitionId = "";
    }
    this.persistWorkingDraft();
  }

  updateDraftField(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    const signalId = String(target.dataset.selectionSignalId || "").trim();
    if (signalId) {
      const currentIndex = this.draft.selectionSignals.findIndex((entry) => entry.definitionId === signalId);
      if (target.dataset.selectionSignalToggle !== undefined && target instanceof HTMLInputElement) {
        if (target.checked && currentIndex < 0) this.draft.selectionSignals.push({ definitionId: signalId, weight: 1 });
        if (!target.checked && currentIndex >= 0) this.draft.selectionSignals.splice(currentIndex, 1);
      } else if (target.dataset.selectionSignalWeight !== undefined && currentIndex >= 0) {
        const weight = Number(target.value);
        this.draft.selectionSignals[currentIndex].weight = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 1;
      }
      return;
    }
    const mediaField = target.dataset.mediaField;
    if (mediaField) {
      const media = this.currentMedia();
      if (!media || !["url", "altText"].includes(mediaField)) return;
      if (mediaField === "url" && media.url !== target.value) {
        media.originalUrl = null; media.mimeType = null; media.width = null; media.height = null;
        media.source = { provider: "author_url", retrievedAt: new Date().toISOString() }; media.rights = null;
      }
      media[mediaField] = target.value; return;
    }
    const representationIndex = target.dataset.representationIndex;
    if (representationIndex !== undefined) {
      const representation = this.draft.representations[Number(representationIndex)];
      if (representation && Object.prototype.hasOwnProperty.call(representation, target.name)) representation[target.name] = target.value;
      return;
    }
    if (target.name && Object.prototype.hasOwnProperty.call(this.draft, target.name)) this.draft[target.name] = target.value;
  }
  onInput = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) event.target.setCustomValidity("");
    this.updateDraftField(event.target); this.persistWorkingDraft();
  };
  onInvalid = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    target.setCustomValidity(target instanceof HTMLSelectElement ? "Seleziona un'opzione prima di continuare." : "Compila questo campo prima di continuare.");
  };
  onChange = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) target.setCustomValidity("");
    this.updateDraftField(target); this.persistWorkingDraft();
    if (target.closest("[data-selection-signal-toggle]")) { this.render(); return; }
    const mediaUpload = target.closest("input[data-media-upload]");
    if (mediaUpload instanceof HTMLInputElement && mediaUpload.files?.[0]) {
      this.mediaBusy = true; this.error = null; this.mediaNotice = "Caricamento dell'immagine in corso…"; this.render();
      try { await this.uploadMediaFile(mediaUpload.files[0]); }
      catch (error) { this.error = error instanceof Error ? error.message : "Non è stato possibile caricare l'immagine"; }
      finally { this.mediaBusy = false; this.render(); }
      return;
    }
    const namespaceSelect = target.closest("select[data-namespace-select]");
    if (namespaceSelect) {
      this.busy = true; this.error = null; this.render();
      try { await this.selectNamespace(namespaceSelect.value); }
      catch (error) { this.error = error instanceof Error ? error.message : "Regole editoriali non disponibili"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const membership = target.closest("input[data-content-space-id]");
    if (!membership || !this.itemId) return;
    membership.disabled = true; this.error = null;
    try {
      await authoringRepository.setContentSpaceMembership({ contentSpaceId: membership.dataset.contentSpaceId, itemId: this.itemId, member: membership.checked });
      const projected = (this.projection?.workspaceMemberships || []).find((entry) => id(entry.contentSpaceId) === membership.dataset.contentSpaceId);
      if (projected) projected.member = membership.checked;
      this.notice = "Spazio editoriale aggiornato.";
    } catch (error) { membership.checked = !membership.checked; this.error = error instanceof Error ? error.message : "Spazio editoriale non aggiornato"; }
    finally { membership.disabled = false; this.render(); }
  };

  onSubjectSelected = async (event) => {
    if (this.itemId || !event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.notice = event.detail.source === "reuse_existing" ? "Identità ArtAround esistente riutilizzata." : "Subject selezionato. Puoi continuare.";
    this.render();
    await this.loadSuggestedMedia();
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    this.busy = true; this.error = null; this.notice = null; this.render();
    try {
      if (form.matches("[data-create-item]")) {
        if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
        if (!this.selectedSubject) throw new Error("Scegli prima di cosa deve parlare il contenuto");
        if (!this.contextContentSpaceId) throw new Error("Seleziona prima uno spazio editoriale dalla Libreria.");
        const created = await authoringRepository.createItem({
          primarySubjectId: id(this.selectedSubject),
          ownerType: this.principal.type,
          ownerId: this.principal.id,
          contentSpaceId: this.contextContentSpaceId,
        });
        this.itemId = id(created.item || created);
        const url = new URL(window.location.href);
        url.searchParams.set("itemId", this.itemId);
        replaceCurrentHistoryUrl(url);
        await this.reloadProjection();
        await this.prepareNewEdition();
        this.notice = this.inCollectionContext()
          ? "Item creato nello spazio della raccolta. Ora completa la sua versione editoriale."
          : "Item creato nello spazio editoriale corrente. Ora completa le informazioni generali.";
      } else if (form.matches("[data-content-details]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        this.normalizeAndValidateGeneralDetails();
        this.activeStep = 3; this.persistWorkingDraft();
        this.notice = "Informazioni generali completate. Ora configura regole e testi.";
      } else if (form.matches("[data-content-draft]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        this.normalizeAndValidateGeneralDetails();
        this.draft.selectionSignals = normalizedSelectionSignals(this.draft.selectionSignals);
        for (const representation of this.draft.representations) {
          representation.locale = String(representation.locale || "").trim();
          representation.text = String(representation.text || "").trim();
        }
        const incompleteTextIndex = this.draft.representations.findIndex((entry) => [entry.durationTypeDefinitionId, entry.languageLevelDefinitionId, entry.locale, entry.text].some((value) => !String(value || "").trim()));
        if (incompleteTextIndex >= 0) {
          this.activeRepresentationIndex = incompleteTextIndex;
          throw new Error(`Completa durata, livello di linguaggio, lingua e testo per ${incompleteTextIndex === 0 ? "il testo principale" : `il testo ${incompleteTextIndex + 1}`}.`);
        }
        if (this.newEditionMode) await this.createEditionFromDraft(); else await this.updateEditionFromDraft();
      } else if (form.matches("[data-workflow-form]")) {
        const operationCode = String(data.get("operationCode") || "");
        const operation = this.availableOperation(operationCode);
        if (!operation || operationCode !== "workflow.check") throw new Error("Operazione editoriale non disponibile");
        await this.executeWorkflow(operationCode);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally {
      this.busy = false; this.render();
      if (this.privateSuccessOpen) requestAnimationFrame(() => this.querySelector(".private-success-dialog")?.focus({ preventScroll: true }));
    }
  };

  async createEditionFromDraft() {
    const controls = this.namespaceControls;
    if (!controls || id(controls.namespace.id) !== this.draft.namespaceId) throw new Error("Le regole editoriali selezionate non sono state caricate");
    const created = await authoringRepository.createEdition(this.itemId, {
      namespaceId: this.draft.namespaceId,
      authoredAgainstNamespaceRevisionId: controls.revision.id,
      revision: {
        label: this.draft.label,
        authorCredits: [this.draft.author].filter(Boolean),
        metadata: { license: this.draft.license },
        relatedSubjectIds: [], tags: [],
        illustrativeMedia: this.draft.illustrativeMedia.map((entry) => writableMedia(entry, { includeId: false })).filter(Boolean),
        selectionSignals: normalizedSelectionSignals(this.draft.selectionSignals),
        presentationVariants: [{
          key: "standard", label: "Standard", semanticFocus: [], presentationAspects: [], knowledgeRequirements: [],
          representations: this.draft.representations.map((entry) => ({
            durationTypeDefinitionId: entry.durationTypeDefinitionId,
            languageLevelDefinitionId: entry.languageLevelDefinitionId,
            locale: entry.locale,
            text: entry.text,
          })),
        }],
        defaultPresentation: null,
      },
    });
    const variant = created.revision?.presentationVariants?.[0];
    const representation = variant?.representations?.[0];
    if (variant?._id && representation?._id) {
      await authoringRepository.updateEdition(created.edition._id, { defaultPresentation: { variantId: variant._id, representationId: representation._id } });
    }
    if (this.contextEditorialContextId && id(created.edition?.namespaceId) === id(this.contextNamespaceId)) {
      try {
        await editorialRepository.addEntry(this.contextEditorialContextId, { itemEditionId: id(created.edition), curationSignals: [] });
        this.notice = "Versione salvata e aggiunta alla raccolta.";
      } catch (error) {
        if (!String(error?.message || "").toLowerCase().includes("già presente")) throw error;
      }
    }
    this.clearWorkingDraft();
    this.newEditionMode = false; this.namespaceControls = null;
    await this.reloadProjection(created.edition._id);
    await this.reloadAuthoringContext();
    this.activeStep = 4;
    if (!this.notice) this.notice = "Bozza salvata. Ora esegui il controllo finale.";
  }
  async updateEditionFromDraft() {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision();
    const editionId = id(this.selectedEdition()?.id);
    if (!revision || !editionId) throw new Error("Nessuna versione modificabile");
    const payload = projectedRevisionToWrite(revision);
    payload.label = this.draft.label;
    payload.authorCredits = [this.draft.author].filter(Boolean);
    payload.metadata = { license: this.draft.license };
    payload.illustrativeMedia = this.draft.illustrativeMedia.map((entry) => writableMedia(entry)).filter(Boolean);
    payload.selectionSignals = normalizedSelectionSignals(this.draft.selectionSignals);
    const variant = payload.presentationVariants?.[0];
    if (!variant) throw new Error("La struttura dei testi non è disponibile");
    variant.representations = this.draft.representations.map((entry) => ({
      ...(entry.id ? { _id: entry.id } : {}),
      durationTypeDefinitionId: entry.durationTypeDefinitionId,
      languageLevelDefinitionId: entry.languageLevelDefinitionId,
      locale: entry.locale,
      text: entry.text,
    }));
    if (!variant.representations.length) payload.defaultPresentation = null;
    const result = await authoringRepository.updateEdition(editionId, payload);
    await this.ensureDefaultRepresentation(editionId, result.revision);
    this.clearWorkingDraft();
    await this.reloadProjection(editionId);
    this.activeStep = 4;
    this.notice = "Modifiche salvate. Ora esegui il controllo finale.";
  }
  async ensureDefaultRepresentation(editionId, revision) {
    const variant = revision?.presentationVariants?.[0];
    const representation = variant?.representations?.[0];
    const variantId = id(variant), representationId = id(representation);
    if (!variantId || !representationId) {
      if (revision?.defaultPresentation) await authoringRepository.updateEdition(editionId, { defaultPresentation: null });
      return;
    }
    const current = revision.defaultPresentation;
    const currentVariant = (revision.presentationVariants || []).find((entry) => id(entry._id || entry.id) === id(current?.variantId));
    const currentStillExists = currentVariant?.representations?.some((entry) => id(entry._id || entry.id) === id(current?.representationId));
    if (!currentStillExists) await authoringRepository.updateEdition(editionId, { defaultPresentation: { variantId, representationId } });
  }
  async executeWorkflow(operationCode) {
    const editionId = id(this.selectedEdition()?.id);
    if (!editionId) throw new Error("Versione editoriale non disponibile");
    const result = await marketplaceRepository.executeWorkspaceOperation({
      operationCode,
      sourceRef: { resourceType: "item_edition", resourceId: editionId },
      targetPrincipal: { type: this.principal.type, id: this.principal.id },
      payload: {},
    });
    await this.reloadProjection(editionId);
    this.activeStep = 4;
    const issues = result?.result?.issues || [];
    this.privateSuccessOpen = Boolean(result?.result?.finalized && !issues.length);
    this.notice = issues.length ? `Controllo completato: ${issues.length} problema/i da risolvere.` : null;
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const closePrivateSuccess = target.closest("button[data-close-private-success]");
    if (closePrivateSuccess) { this.privateSuccessOpen = false; this.render(); return; }
    const changeMediaButton = target.closest("button[data-change-media]");
    if (changeMediaButton) {
      if (!this.currentMedia()) this.draft.illustrativeMedia = [{ url: "", altText: this.selectedSubject?.preferredLabel || "", source: { provider: "author_url", retrievedAt: new Date().toISOString() }, rights: null }];
      this.mediaEditorOpen = true; this.error = null; this.persistWorkingDraft(); this.render(); return;
    }
    if (target.closest("button[data-close-media-editor]")) { this.mediaEditorOpen = false; this.persistWorkingDraft(); this.render(); return; }
    if (target.closest("button[data-remove-media]")) {
      this.draft.illustrativeMedia = []; this.mediaEditorOpen = false; this.mediaSuggestionAttempted = true;
      this.mediaNotice = "Immagine rimossa dalla bozza."; this.persistWorkingDraft(); this.render(); return;
    }
    if (target.closest("button[data-suggest-media]")) { this.draft.illustrativeMedia = []; await this.loadSuggestedMedia({ force: true }); return; }
    if (target.closest("button[data-add-text]")) {
      this.draft.representations.push(newRepresentation());
      this.activeRepresentationIndex = this.draft.representations.length - 1;
      this.persistWorkingDraft(); this.render(); return;
    }
    const removeTextButton = target.closest("button[data-remove-text]");
    if (removeTextButton) {
      const index = Number(removeTextButton.dataset.removeText);
      if (this.draft.representations[index]) this.draft.representations.splice(index, 1);
      this.activeRepresentationIndex = null; this.persistWorkingDraft(); this.render(); return;
    }
    const editText = target.closest("button[data-edit-text]");
    if (editText) { this.activeRepresentationIndex = Number(editText.dataset.editText); this.render(); return; }
    const stepButton = target.closest("button[data-step]");
    if (stepButton) {
      const step = Number(stepButton.dataset.step);
      if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.persistWorkingDraft(); this.render(); }
      return;
    }
    const backButton = target.closest("button[data-back-step]");
    if (backButton) { const step = Number(backButton.dataset.backStep); if (this.canOpenStep(step)) { this.activeStep = step; this.render(); } return; }
    if (target.closest("button[data-new-edition]")) {
      this.busy = true; this.error = null; this.render();
      try { await this.prepareNewEdition(); }
      catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aggiungere una nuova versione editoriale"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    if (target.closest("button[data-edit-content]")) {
      this.newEditionMode = false; this.hydrateDraftFromProjection(); this.activeRepresentationIndex = null; this.activeStep = 2; this.persistWorkingDraft(); this.render(); return;
    }
    const editionButton = target.closest("button[data-edition-id]");
    if (editionButton) {
      this.busy = true; this.error = null; this.render();
      try { this.newEditionMode = false; this.namespaceControls = null; await this.reloadProjection(editionButton.dataset.editionId); this.activeStep = 4; }
      catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aprire la versione editoriale"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    if (target.closest("button[data-return-collection]")) navigate(this.collectionReturnHref());
  };

  normalizeAndValidateGeneralDetails() {
    this.draft.label = String(this.draft.label || "").trim();
    this.draft.author = String(this.draft.author || this.defaultAuthor()).trim();
    this.draft.license = String(this.draft.license || "").trim();
    if (!this.draft.label || !this.draft.license) throw new Error("Completa titolo e licenza prima di continuare.");
    const media = this.currentMedia();
    if (!media) return;
    media.url = String(media.url || "").trim(); media.altText = String(media.altText || "").trim();
    if (!media.url || !media.altText) { this.mediaEditorOpen = true; throw new Error("Completa indirizzo e descrizione dell'immagine oppure rimuovila."); }
  }
  generalDetailsReady() {
    const fieldsReady = [this.draft.label, this.draft.license].every((value) => String(value || "").trim());
    const media = this.currentMedia();
    return Boolean(fieldsReady && (!media || [media.url, media.altText].every((value) => String(value || "").trim())));
  }
  canOpenStep(step) {
    if (step === 1) return true;
    if (step === 2) return Boolean(this.itemId);
    if (step === 3) return Boolean(this.itemId && this.generalDetailsReady());
    if (step === 4) return Boolean(this.selectedRevision() && !this.newEditionMode);
    return false;
  }
  remediationHref() {
    const configurable = this.preflight?.content?.needsConfiguration?.[0];
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.context?.type === "organization" && this.context?.id) return `/organizations/detail?organizationId=${encodeURIComponent(id(this.context.id))}&section=rules`;
    return "/profile#account-rules";
  }

  renderProgress() {
    const stages = [[1, "Di cosa parla"], [2, "Info generali"], [3, "Regole e testi"], [4, "Controllo"]];
    return `<nav class="authoring-progress" aria-label="Passaggi di creazione"><ol>${stages.map(([step, label]) => {
      const current = this.activeStep === step;
      const complete = step === 1 ? Boolean(this.itemId) : step === 2 ? this.generalDetailsReady() : step === 3 ? Boolean(this.selectedRevision() && !this.newEditionMode) : this.selectedRevision()?.status === "published";
      return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${this.canOpenStep(step) ? "" : "disabled"} aria-current="${current ? "step" : "false"}"><span>${complete ? icon("check", { size: 14 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`;
    }).join("")}</ol></nav>`;
  }
  renderPrerequisiteBlocker() {
    if (this.itemId || this.preflight?.content?.allowed !== false) return "";
    const blocker = this.preflight?.content?.blockers?.[0];
    return `<section class="panel blocker-panel"><span class="resource-mark">${icon("warning", { size: 22 })}</span><div><h2>Prepara le regole editoriali</h2><p>${escapeHtml(blocker?.message || "Manca una configurazione editoriale utilizzabile.")}</p><a class="button-link" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole ${icon("chevron", { size: 15 })}</a></div></section>`;
  }
  renderSubjectSummary() {
    if (!this.selectedSubject) return "";
    const identities = (this.selectedSubject.externalIdentities || []).map((identity) => `${identity.scheme}: ${identity.id}`).join(" · ");
    return `<article class="subject-summary"><span class="eyebrow">Subject</span><h3>${escapeHtml(this.selectedSubject.preferredLabel)}</h3><p>${escapeHtml(this.selectedSubject.description || "Nessuna descrizione disponibile")}</p>${identities ? `<details><summary>Identità tecnica</summary><p>${escapeHtml(identities)}</p></details>` : ""}</article>`;
  }
  renderSubjectPresence() {
    if (!this.selectedSubject || !this.principal) return "";
    return `<artaround-subject-presence></artaround-subject-presence>`;
  }
  configureSubjectPresence() {
    const component = this.querySelector("artaround-subject-presence");
    if (component && this.selectedSubject && this.principal) component.configure({ subjectId: id(this.selectedSubject), sourceItemId: this.itemId, principal: this.principal });
  }

  mediaSourceLabel(media) {
    return ({ wikimedia_commons: "Proposta da Wikidata · Wikimedia Commons", author_upload: "Caricata dal dispositivo", author_url: "Aggiunta tramite indirizzo web" })[media?.source?.provider] || "Immagine del contenuto";
  }
  renderMediaEditor(media) {
    if (!this.mediaEditorOpen) return "";
    return `<div class="media-editor"><label>Indirizzo<input data-media-field="url" required value="${escapeHtml(media?.url || "")}" placeholder="https://..."></label><label>Descrizione accessibile<input data-media-field="altText" required value="${escapeHtml(media?.altText || "")}"></label><label class="button-secondary upload-button">${icon("image", { size: 15 })} Carica dal dispositivo<input type="file" data-media-upload accept="image/jpeg,image/png,image/webp,image/avif"></label><button class="button-secondary" type="button" data-close-media-editor>Chiudi</button></div>`;
  }
  renderMediaCard() {
    const media = this.currentMedia();
    if (this.mediaBusy) return `<section class="media-card"><p>Ricerca o caricamento dell'immagine…</p></section>`;
    if (!media?.url) return `<section class="media-card"><div class="media-placeholder">${icon("image", { size: 24 })}</div><div><span class="eyebrow">Immagine · facoltativa</span><h3>Nessuna immagine</h3><p>${escapeHtml(this.mediaNotice || "Puoi aggiungere un'immagine utile a riconoscere il Subject.")}</p><div class="button-row"><button class="button-secondary" type="button" data-change-media>Aggiungi</button>${this.wikidataIdentity() ? `<button class="button-secondary" type="button" data-suggest-media>Proponi da Wikidata</button>` : ""}</div>${this.renderMediaEditor(media)}</div></section>`;
    const sourceUrl = safeExternalHref(media.source?.pageUrl);
    return `<section class="media-card"><figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || "")}"></figure><div><span class="eyebrow">Immagine · facoltativa</span><h3>${escapeHtml(this.mediaSourceLabel(media))}</h3><p>${escapeHtml(media.altText || "Descrizione da completare")}</p>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Apri fonte</a>` : ""}<div class="button-row"><button class="button-secondary" type="button" data-change-media>Cambia</button><button class="button-secondary" type="button" data-remove-media>Rimuovi</button></div>${this.renderMediaEditor(media)}</div></section>`;
  }

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    if (this.itemId) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Subject confermato</h2><p>L'identità semantica è separata sia dalla versione editoriale sia dalla presenza fisica nelle Venue.</p></div></header>${this.renderSubjectSummary()}${this.renderSubjectPresence()}<div class="step-actions"><button type="button" data-step="2">Continua ${icon("chevron", { size: 15 })}</button></div></section>`;
    const picker = this.selectedSubject
      ? `<form data-create-item>${this.renderSubjectSummary()}${this.renderSubjectPresence()}<div class="step-actions"><button type="submit">${icon("check", { size: 15 })} Crea Item e continua ${icon("chevron", { size: 15 })}</button></div></form>`
      : `<artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Trova l'opera, la persona o il concetto</h2><p>ArtAround riusa la stessa identità Subject in tutti i musei e in tutte le raccolte.</p></div></header>${this.inCollectionContext() ? `<aside class="context-note"><strong>Creazione dalla raccolta</strong><p>Il nuovo Item verrà aggiunto allo spazio editoriale e la versione per il Namespace corrente verrà inserita nella raccolta dopo il salvataggio.</p></aside>` : `<aside class="context-note"><strong>Spazio editoriale</strong><p>Il nuovo Item verrà inserito nello spazio editoriale corrente della Libreria.</p></aside>`}${picker}</section>`;
  }
  renderStepTwo() {
    if (this.activeStep !== 2 || !this.itemId) return "";
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Informazioni generali</span><h2>Presenta il contenuto</h2><p>Queste informazioni restano comuni ai testi della stessa versione editoriale.</p></div></header><form data-content-details class="editor-form"><label>Titolo<input name="label" required value="${escapeHtml(this.draft.label)}"></label><label>Licenza<input name="license" required value="${escapeHtml(this.draft.license)}"></label><p class="note">Autore: <strong>${escapeHtml(this.draft.author || this.defaultAuthor())}</strong></p>${this.renderMediaCard()}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="1">Indietro</button><button type="submit">Continua ${icon("chevron", { size: 15 })}</button></div></form></section>`;
  }
  renderNamespaceSelector() {
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (!choices.length) return `<div class="empty-state compact"><p>Nessun'altra regola editoriale disponibile.</p></div>`;
    const lockedToCollection = this.inCollectionContext() && this.contextNamespaceId;
    return `<label>Regole editoriali<select name="namespaceId" data-namespace-select required ${lockedToCollection ? "disabled" : ""}><option value="">Scegli</option>${choices.map((choice) => `<option value="${escapeHtml(choice.id)}" ${choice.id === this.draft.namespaceId ? "selected" : ""}>${escapeHtml(choice.name)}</option>`).join("")}</select>${lockedToCollection ? `<input type="hidden" name="namespaceId" value="${escapeHtml(this.draft.namespaceId)}"><small>Impostate dalla raccolta.</small>` : ""}</label>`;
  }
  personalizationControls() { return this.newEditionMode ? this.namespaceControls?.controls || null : this.selectedNamespace()?.revision || null; }
  renderSelectionSignals(controls) {
    const definitions = controls?.selectionSignals || [];
    if (!definitions.length) return "";
    const selected = new Map(normalizedSelectionSignals(this.draft.selectionSignals).map((entry) => [entry.definitionId, entry]));
    return `<fieldset><legend>Quando è utile questo contenuto?</legend><p class="note">I segnali aiutano la selezione fra più contenuti sullo stesso Subject.</p><div class="signal-grid">${definitions.map((definition) => {
      const active = selected.get(definition.definitionId);
      return `<label class="signal-card"><span><input type="checkbox" data-selection-signal-id="${escapeHtml(definition.definitionId)}" data-selection-signal-toggle ${active ? "checked" : ""}> <strong>${escapeHtml(definition.label)}</strong></span><small>${escapeHtml(definition.description || "")}</small>${active ? `<input type="number" min="0" max="1" step=".1" data-selection-signal-id="${escapeHtml(definition.definitionId)}" data-selection-signal-weight value="${escapeHtml(active.weight)}" aria-label="Rilevanza ${escapeHtml(definition.label)}">` : ""}</label>`;
    }).join("")}</div></fieldset>`;
  }
  renderRepresentationEditors(controls) {
    if (!this.draft.representations.length) return `<div class="empty-state compact"><h3>Nessun testo</h3><p>Aggiungi almeno un testo completo prima del controllo finale.</p></div>`;
    return `<div class="representation-list">${this.draft.representations.map((representation, index) => {
      const active = index === this.activeRepresentationIndex || this.draft.representations.length === 1;
      const durationOptions = (controls.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${entry.definitionId === representation.durationTypeDefinitionId ? "selected" : ""}>${escapeHtml(entry.label)}${entry.targetSeconds ? ` · ${entry.targetSeconds}s` : ""}</option>`).join("");
      const languageOptions = (controls.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${entry.definitionId === representation.languageLevelDefinitionId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("");
      if (!active) return `<article class="representation-card collapsed"><div><strong>${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</strong><small>${escapeHtml(representation.locale || "Lingua da indicare")}</small></div><div class="button-row"><button class="button-secondary small" type="button" data-edit-text="${index}">Modifica</button><button class="button-secondary small" type="button" data-remove-text="${index}">Rimuovi</button></div></article>`;
      return `<article class="representation-card"><header><strong>${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</strong><button class="button-secondary small" type="button" data-remove-text="${index}">Rimuovi</button></header><div class="representation-settings"><label>Durata<select name="durationTypeDefinitionId" data-representation-index="${index}" required><option value="">Scegli</option>${durationOptions}</select></label><label>Livello di linguaggio<select name="languageLevelDefinitionId" data-representation-index="${index}" required><option value="">Scegli</option>${languageOptions}</select></label><label>Lingua<input name="locale" data-representation-index="${index}" required value="${escapeHtml(representation.locale)}"></label></div><label>Testo<textarea name="text" data-representation-index="${index}" rows="8" required>${escapeHtml(representation.text)}</textarea></label></article>`;
    }).join("")}</div>`;
  }
  renderMemberships() {
    if (this.inCollectionContext()) return `<aside class="context-note"><strong>Spazio editoriale già definito</strong><p>Questo Item appartiene allo spazio della raccolta. La semantica della raccolta si gestisce nello Studio, non nell'Item Editor.</p></aside>`;
    const rows = (this.projection?.workspaceMemberships || []).map((entry) => `<label class="membership"><input type="checkbox" data-content-space-id="${escapeHtml(id(entry.contentSpaceId))}" ${entry.member ? "checked" : ""}><span><strong>${escapeHtml(entry.name)}</strong><small>Rende l'Item disponibile nello spazio senza cambiarne il proprietario.</small></span></label>`).join("");
    return rows ? `<fieldset><legend>Spazi editoriali</legend><div class="membership-grid">${rows}</div></fieldset>` : "";
  }
  renderStepThree() {
    if (this.activeStep !== 3 || !this.itemId || !this.generalDetailsReady()) return "";
    const controls = this.personalizationControls();
    const namespaceChoice = this.newEditionMode ? this.renderNamespaceSelector() : `<div class="selection-summary"><span>Regole editoriali</span><strong>${escapeHtml(this.selectedNamespace()?.name || "-")}</strong></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Regole e testi</span><h2>Configura la versione editoriale</h2><p>Durata, linguaggio e segnali appartengono alla versione sotto questo Namespace. Le relazioni semantiche appartengono invece alla raccolta.</p></div></header><div class="rules-choice">${namespaceChoice}</div>${controls ? `<form data-content-draft class="editor-form">${this.renderSelectionSignals(controls)}${this.renderRepresentationEditors(controls)}<button class="button-secondary add-text" type="button" data-add-text>${icon("plus", { size: 15 })} Aggiungi testo</button>${this.renderMemberships()}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="2">Indietro</button><button type="submit">Salva e vai al controllo ${icon("chevron", { size: 15 })}</button></div></form>` : `<p class="note">Scegli le regole editoriali per configurare i testi.</p>`}</section>`;
  }
  reviewSummary() {
    const revision = this.selectedRevision(); if (!revision) return "";
    return `<div class="review-grid"><article><span>Subject</span><strong>${escapeHtml(this.selectedSubject?.preferredLabel || "-")}</strong></article><article><span>Titolo</span><strong>${escapeHtml(revision.label || "-")}</strong></article><article><span>Regole editoriali</span><strong>${escapeHtml(this.selectedNamespace()?.name || "-")}</strong></article><article><span>Testi</span><strong>${this.firstVariant()?.representations?.length || 0}</strong></article><article><span>Autore</span><strong>${escapeHtml(revision.authorCredits?.[0] || "-")}</strong></article><article><span>Licenza</span><strong>${escapeHtml(revision.license || "-")}</strong></article></div>`;
  }
  renderReviewTexts() {
    const representations = this.firstVariant()?.representations || [];
    return representations.length ? `<section class="review-texts"><h3>Testi configurati</h3>${representations.map((representation, index) => `<article><header><strong>${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</strong><span>${escapeHtml(representation.duration?.label || "-")} · ${escapeHtml(representation.languageComplexity?.label || "-")} · ${escapeHtml(representation.locale || "-")}</span></header><p>${escapeHtml(representation.text || "-")}</p></article>`).join("")}</section>` : `<div class="empty-state compact"><p>Nessun testo configurato.</p></div>`;
  }
  renderStepFour() {
    if (this.activeStep !== 4 || !this.selectedRevision() || this.newEditionMode) return "";
    const revision = this.selectedRevision();
    const issues = revision.integrity?.issues || [];
    const operations = this.workflowOperations();
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Controllo finale</span><h2>Verifica il contenuto</h2><p>Il grafo semantico non si modifica qui: se il contenuto appartiene a una raccolta, apri la sezione Relazioni dello Studio.</p></div></header>${this.reviewSummary()}${this.renderReviewTexts()}${issues.length ? `<div class="issue-panel"><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul></div>` : ""}${operations.length ? `<div class="workflow-panel"><h3>Controllo</h3>${operations.map((operation) => `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit">${icon("check", { size: 15 })} Controlla se è tutto pronto</button></form>`).join("")}</div>` : `<div class="readiness success"><strong>${revision.status === "published" ? "Contenuto privato e corretto" : "Nessun controllo disponibile nello stato corrente"}</strong></div>`}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="3">Indietro</button>${this.availableOperation("item.edit") ? `<button class="button-secondary" type="button" data-edit-content>Modifica contenuto</button>` : ""}${this.availableOperation("item.create_edition") && this.usableNamespaceChoices({ excludeUsed: true }).length ? `<button class="button-secondary" type="button" data-new-edition>Aggiungi versione editoriale</button>` : ""}${this.inCollectionContext() ? `<button type="button" data-return-collection>Torna alla raccolta</button>` : ""}</div></section>`;
  }
  renderPrivateSuccessDialog() {
    if (!this.privateSuccessOpen) return "";
    const editionId = id(this.selectedEdition()?.id);
    const marketplaceHref = `/workspace/resource?ownership=owned&resourceType=item_edition&resourceId=${encodeURIComponent(editionId)}`;
    return `<div class="private-success-overlay"><section class="private-success-dialog" role="dialog" aria-modal="true" tabindex="-1"><span class="private-success-icon">${icon("check", { size: 28 })}</span><div><span class="eyebrow">Controlli superati</span><h2>Il contenuto è corretto e resta privato</h2><p>Puoi configurarne la distribuzione nel Marketplace oppure mantenerlo nella Libreria.</p></div><div class="button-row"><a class="button-link" data-route href="${escapeHtml(marketplaceHref)}">Configura distribuzione</a><button class="button-secondary" type="button" data-close-private-success>Mantieni privato</button></div></section></div>`;
  }
  renderEditions() {
    const editions = this.projection?.editions || [];
    if (editions.length <= 1 && !this.newEditionMode) return "";
    return `<nav class="edition-tabs">${editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}" aria-pressed="${!this.newEditionMode && id(this.selectedEdition()?.id) === id(edition.id)}">${escapeHtml(edition.namespace?.name || "Versione")}</button>`).join("")}${this.newEditionMode ? `<span class="status-pill">Nuova bozza</span>` : ""}</nav>`;
  }
  configureChildren() { queueMicrotask(() => this.configureSubjectPresence()); }

  render() {
    const blocked = !this.itemId && this.preflight?.content?.allowed === false;
    const returnHref = this.inCollectionContext() ? this.collectionReturnHref() : this.itemId ? "/workspace" : "/create";
    const returnLabel = this.inCollectionContext() ? "Raccolta" : this.itemId ? "Libreria" : "Crea";
    this.innerHTML = `${this.styles()}<main class="page authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><a data-route href="${escapeHtml(returnHref)}">${icon("arrowLeft", { size: 15 })} ${escapeHtml(returnLabel)}</a><span>/</span><span>Contenuto</span></nav><header class="authoring-header"><span class="eyebrow">Contenuto</span><h1>${this.itemId ? "Modifica contenuto" : "Nuovo contenuto"}</h1><p>Quattro passaggi: Subject, informazioni, versione editoriale e controllo. Presenza fisica e semantica della raccolta restano domini separati.</p></header>${!blocked ? this.renderProgress() : ""}${this.busy ? `<p role="status">Aggiornamento in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.notice)}</p>` : ""}${this.renderPrerequisiteBlocker()}${this.renderEditions()}${blocked ? "" : `${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}`}</main>${this.renderPrivateSuccessDialog()}`;
    this.configureChildren();
  }

  styles() {
    return `<style>
      :host{display:block}.authoring-page{display:grid;gap:1rem;max-width:68rem;margin:auto;padding:2rem 1rem 5rem}.authoring-header{padding:1.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle)}.authoring-header h1,.authoring-header p{margin:.25rem 0}.authoring-header p{color:var(--muted)}
      .authoring-progress ol{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem;margin:0;padding:0;list-style:none}.authoring-progress button{display:flex;width:100%;align-items:center;gap:.5rem;padding:.65rem;border:1px solid var(--border);background:var(--surface);color:inherit}.authoring-progress button>span{display:grid;place-items:center;width:1.7rem;height:1.7rem;border-radius:50%;background:var(--surface-subtle)}.authoring-progress li[data-current="true"] button{background:var(--text);color:var(--surface)}.authoring-progress li[data-current="true"] button>span{background:var(--surface);color:var(--text)}
      .wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem}.step-number{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:50%;background:var(--text);color:var(--surface)}.step-heading h2,.step-heading p{margin:.2rem 0}.step-heading p{color:var(--muted)}
      .editor-form{display:grid;gap:.9rem;max-width:54rem;margin-top:1rem}.step-actions,.button-row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}.step-actions{margin-top:1rem}.subject-summary,.context-note,.selection-summary,.readiness,.issue-panel,.workflow-panel{margin-top:1rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle)}.subject-summary h3,.subject-summary p,.context-note p{margin:.2rem 0}
      .media-card{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:1rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle)}.media-card figure{margin:0;aspect-ratio:4/3;overflow:hidden;border-radius:var(--radius);background:var(--surface)}.media-card img{width:100%;height:100%;object-fit:contain}.media-placeholder{display:grid;place-items:center;min-height:7rem;border:1px dashed var(--border);border-radius:var(--radius)}.media-editor{grid-column:1/-1;display:grid;gap:.65rem;padding-top:.75rem;border-top:1px solid var(--border)}.upload-button{position:relative;overflow:hidden}.upload-button input{position:absolute;width:1px;height:1px;opacity:0}
      fieldset{display:grid;gap:.7rem;margin:0;padding:1rem;border:1px solid var(--border);border-radius:var(--radius)}.signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.signal-card{display:grid;gap:.35rem;padding:.7rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}.signal-card small{color:var(--muted)}
      .representation-list{display:grid;gap:.75rem}.representation-card{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)}.representation-card>header,.representation-card.collapsed{display:flex;justify-content:space-between;gap:.8rem;align-items:center}.representation-card.collapsed>div:first-child{display:grid}.representation-card small{color:var(--muted)}.representation-settings{display:grid;grid-template-columns:1fr 1fr .7fr;gap:.7rem}.add-text{justify-self:start}
      .membership-grid{display:grid;gap:.5rem}.membership{display:grid;grid-template-columns:auto 1fr;gap:.55rem}.membership span{display:grid}.membership small{color:var(--muted)}
      .review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin-top:1rem}.review-grid article{display:grid;gap:.25rem;padding:.85rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-subtle)}.review-grid span{color:var(--muted);font-size:.85rem}.review-texts{display:grid;gap:.6rem;margin-top:1rem}.review-texts article{padding:.85rem;border:1px solid var(--border);border-radius:var(--radius)}.review-texts article header{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.review-texts article header span{color:var(--muted)}.review-texts article p{white-space:pre-wrap}
      .edition-tabs{display:flex;gap:.45rem;flex-wrap:wrap}.private-success-overlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:1rem;background:rgba(0,0,0,.55)}.private-success-dialog{display:grid;gap:1rem;width:min(34rem,100%);padding:1.4rem;border-radius:var(--radius);background:var(--surface)}.private-success-icon{display:grid;place-items:center;width:3rem;height:3rem;border-radius:50%;background:var(--surface-subtle)}
      @media(max-width:48rem){.authoring-progress button strong{font-size:.72rem}.representation-settings,.review-grid,.signal-grid{grid-template-columns:1fr}.media-card{grid-template-columns:1fr}.media-card figure{max-width:12rem}}
      @media(max-width:32rem){.authoring-progress button strong{display:none}.step-actions>*{width:100%}.representation-card>header,.representation-card.collapsed{align-items:flex-start;flex-direction:column}}
    </style>`;
  }
}
customElements.define("artaround-item-authoring-view", ItemAuthoringView);
