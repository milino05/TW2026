import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { semanticRepository } from "../infrastructure/http/semantic-repository.js";
import { userFacingIssueMessage } from "../application/user-facing-errors.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";

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

function workflowLabel(operation) {
  return operation?.code === "workflow.check" ? "Controlla se è tutto pronto" : operation?.label || "Continua";
}
function connectionOriginLabel(origin) {
  return {
    human: "Inserito manualmente",
    ai_assisted: "Suggerito con assistenza automatica",
    ai_generated: "Generato automaticamente",
    imported: "Importato",
    forked: "Ereditato da una copia",
  }[origin] || "Inserito manualmente";
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
function newDraft(author = "", illustrativeMedia = []) {
  return {
    namespaceId: "",
    label: "",
    author: String(author || "").trim(),
    license: "",
    illustrativeMedia: illustrativeMedia.map((entry) => writableMedia(entry, { includeId: false })).filter(Boolean).slice(0, 1),
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
      .map((entry) => writableMedia(entry, { includeId: false }))
      .filter(Boolean)
      .slice(0, 1),
    representations: (Array.isArray(source.representations) ? source.representations : [])
      .map((entry) => newRepresentation(entry)),
  };
}

export class ItemAuthoringView extends HTMLElement {
  context = readOperatingContext();
  workspace = null;
  preflight = null;
  principal = null;
  selectedSubject = null;
  itemId = params().get("itemId") || null;
  venueTargetId = params().get("venueTargetId") || null;
  venueTargetContext = null;
  projection = null;
  namespaceControls = null;
  connectionsProjection = null;
  connectionEditorOpen = false;
  connectionScopeKey = "";
  connectionRelationTypeId = "";
  connectionTargetQuery = "";
  connectionTargets = [];
  selectedConnectionTarget = null;
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
  selectedConnectionRelation() {
    return (this.connectionsProjection?.relationTypes || []).find((entry) => entry.definitionId === this.connectionRelationTypeId) || null;
  }
  workingDraftStorageKey() {
    const principalType = String(this.principal?.type || "");
    const principalId = id(this.principal?.id);
    if (!this.itemId || !principalType || !principalId) return "";
    return `artaround:item-authoring-draft:v1:${encodeURIComponent(principalType)}:${encodeURIComponent(principalId)}:${encodeURIComponent(this.itemId)}`;
  }
  persistWorkingDraft() {
    if (!this.itemId || ![2, 3].includes(this.activeStep)) return;
    const key = this.workingDraftStorageKey(); if (!key) return;
    const isNewWorkingDraft = this.newEditionMode || !this.selectedRevision();
    try {
      window.sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        activeStep: this.activeStep,
        mode: isNewWorkingDraft ? "new" : "edit",
        editionId: isNewWorkingDraft ? null : id(this.selectedEdition()?.id),
        revisionId: isNewWorkingDraft ? null : id(this.selectedRevision()?.id),
        activeRepresentationIndex: Number.isInteger(this.activeRepresentationIndex) ? this.activeRepresentationIndex : null,
        mediaEditorOpen: Boolean(this.mediaEditorOpen),
        draft: normalizedWorkingDraft(this.draft, this.defaultAuthor()),
      }));
    } catch {
      // Il salvataggio locale è un aiuto al refresh e non deve bloccare l'editor.
    }
  }
  readWorkingDraft() {
    const key = this.workingDraftStorageKey(); if (!key) return null;
    try {
      const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
      return value?.version === 1 && ["new", "edit"].includes(value.mode) ? value : null;
    } catch { return null; }
  }
  clearWorkingDraft() {
    const key = this.workingDraftStorageKey(); if (!key) return;
    try { window.sessionStorage.removeItem(key); } catch { /* Ignora storage non disponibile. */ }
  }
  async restoreWorkingDraft() {
    const stored = this.readWorkingDraft(); if (!stored) return false;
    if (stored.mode === "edit") {
      const revision = this.selectedRevision();
      const sameEdition = id(this.selectedEdition()?.id) === String(stored.editionId || "");
      const sameRevision = id(revision?.id) === String(stored.revisionId || "");
      if (!revision || !sameEdition || !sameRevision) { this.clearWorkingDraft(); return false; }
      this.newEditionMode = false;
      this.namespaceControls = null;
      this.draft = normalizedWorkingDraft(stored.draft, this.defaultAuthor());
    } else {
      const choices = this.usableNamespaceChoices({ excludeUsed: true });
      this.newEditionMode = true;
      this.namespaceControls = null;
      this.draft = normalizedWorkingDraft(stored.draft, this.defaultAuthor());
      const selectedNamespaceId = this.draft.namespaceId;
      const namespaceStillAvailable = choices.some((entry) => entry.id === selectedNamespaceId);
      this.activeStep = 2;
      if (namespaceStillAvailable) await this.selectNamespace(selectedNamespaceId);
      else {
        this.draft.namespaceId = "";
        if (choices.length === 1) await this.selectNamespace(choices[0].id);
      }
    }
    const restoredIndex = Number(stored.activeRepresentationIndex);
    this.activeRepresentationIndex = Number.isInteger(restoredIndex) && this.draft.representations[restoredIndex] ? restoredIndex : null;
    this.mediaEditorOpen = Boolean(stored.mediaEditorOpen && this.currentMedia());
    this.mediaSuggestionAttempted = Boolean(this.currentMedia());
    this.activeStep = Number(stored.activeStep) === 3 && this.generalDetailsReady() ? 3 : 2;
    this.notice = "Bozza ripristinata dopo l'aggiornamento della pagina.";
    this.persistWorkingDraft();
    return true;
  }
  wikidataIdentity() {
    const identities = this.selectedSubject?.externalIdentities || [];
    return identities.find((entry) => entry.scheme === "wikidata" && entry.role === "canonical")
      || identities.find((entry) => entry.scheme === "wikidata")
      || null;
  }

  async loadSuggestedMedia({ force = false } = {}) {
    if (this.currentMedia() || (this.mediaSuggestionAttempted && !force)) return;
    const identity = this.wikidataIdentity();
    if (!identity) {
      this.mediaSuggestionAttempted = true;
      this.mediaNotice = "Questo soggetto non è collegato a Wikidata: puoi comunque aggiungere un'immagine.";
      this.persistWorkingDraft();
      return;
    }
    this.mediaBusy = true; this.mediaNotice = null; this.render();
    try {
      const resolution = await semanticRepository.resolveExternal({
        scheme: "wikidata",
        id: identity.id,
        locale: "it",
        includeMedia: true,
      });
      const candidate = resolution.mediaCandidates?.[0] || null;
      if (candidate) {
        this.draft.illustrativeMedia = [writableMedia(candidate, { includeId: false })];
        this.mediaEditorOpen = false;
        this.mediaNotice = "Immagine proposta automaticamente da Wikidata e Wikimedia Commons.";
      } else if (resolution.mediaStatus === "unavailable") {
        this.mediaNotice = "L'immagine non è disponibile in questo momento. Puoi riprovare o aggiungerne una.";
      } else {
        this.mediaNotice = "Wikidata non propone immagini per questo soggetto. Puoi aggiungerne una.";
      }
    } catch {
      this.mediaNotice = "Non è stato possibile cercare un'immagine. La creazione del contenuto può continuare.";
    } finally {
      this.mediaSuggestionAttempted = true;
      this.mediaBusy = false;
      this.persistWorkingDraft();
      this.render();
    }
  }

  async uploadMediaFile(file) {
    if (!file) return;
    const optimized = await optimizedMediaFile(file);
    const dataBase64 = await fileAsBase64(optimized);
    const uploaded = await authoringRepository.uploadItemMedia({
      fileName: file.name,
      mimeType: optimized.type || file.type,
      dataBase64,
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
      if (this.venueTargetId) {
        this.venueTargetContext = await authoringRepository.venueTargetContext(this.venueTargetId);
        this.selectedSubject = this.venueTargetContext.subject;
        await this.loadSuggestedMedia();
      }
      if (this.itemId) {
        await this.reloadProjection();
        await this.loadSuggestedMedia();
        const restored = await this.restoreWorkingDraft();
        if (!restored) {
          if (this.selectedRevision()) this.activeStep = 5;
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
    if (!this.draft.author) this.draft.author = this.defaultAuthor();
  }

  hydrateDraftFromProjection() {
    if (this.newEditionMode) return;
    const revision = this.selectedRevision(); if (!revision) return;
    const representations = (this.firstVariant()?.representations || []).map((entry) => newRepresentation({
      id: entry.id,
      durationTypeDefinitionId: entry.duration?.definitionId,
      languageLevelDefinitionId: entry.languageComplexity?.definitionId,
      locale: entry.locale,
      text: entry.text,
    }));
    this.draft = {
      namespaceId: id(this.selectedNamespace()?.id),
      label: revision.label || "",
      author: revision.authorCredits?.[0] || this.defaultAuthor(),
      license: revision.license || "",
      illustrativeMedia: (revision.illustrativeMedia || []).map((entry) => writableMedia(entry)).filter(Boolean).slice(0, 1),
      representations,
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
    if (this.selectedEdition()?.id && this.selectedRevision()) await this.reloadConnections();
    else this.connectionsProjection = null;
  }

  async reloadConnections() {
    const editionId = id(this.selectedEdition()?.id);
    if (!this.itemId || !editionId) { this.connectionsProjection = null; return; }
    this.connectionsProjection = await authoringRepository.itemConnections(this.itemId, editionId);
    const scopes = this.connectionsProjection?.scopes || [];
    if (!scopes.some((entry) => entry.key === this.connectionScopeKey)) {
      this.connectionScopeKey = this.connectionsProjection?.defaultScopeKey || "";
    }
  }

  usableNamespaceChoices({ excludeUsed = false } = {}) {
    const used = new Set(excludeUsed ? (this.projection?.editions || []).map((edition) => id(edition.namespace?.id)).filter(Boolean) : []);
    return (this.preflight?.content?.usableNamespaces || []).filter((entry) => !used.has(id(entry.id))).map((entry) => ({ id: id(entry.id), name: entry.name, ownership: entry.source }));
  }

  async prepareNewEdition() {
    if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
    const illustrativeMedia = this.draft.illustrativeMedia || [];
    this.newEditionMode = true; this.namespaceControls = null; this.connectionsProjection = null; this.draft = newDraft(this.defaultAuthor(), illustrativeMedia); this.activeRepresentationIndex = null; this.activeStep = 2;
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (choices.length === 1) await this.selectNamespace(choices[0].id);
    this.persistWorkingDraft();
  }

  async selectNamespace(namespaceId) {
    this.draft.namespaceId = String(namespaceId || ""); this.namespaceControls = null;
    if (!this.draft.namespaceId) { this.persistWorkingDraft(); return; }
    this.namespaceControls = await authoringRepository.namespaceControls(this.draft.namespaceId, this.principal);
    const durationIds = new Set((this.namespaceControls?.controls?.durationTypes || []).map((entry) => entry.definitionId));
    const languageIds = new Set((this.namespaceControls?.controls?.languageLevels || []).map((entry) => entry.definitionId));
    for (const representation of this.draft.representations) {
      if (!durationIds.has(representation.durationTypeDefinitionId)) representation.durationTypeDefinitionId = "";
      if (!languageIds.has(representation.languageLevelDefinitionId)) representation.languageLevelDefinitionId = "";
    }
    this.persistWorkingDraft();
  }

  updateDraftField(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    const mediaField = target.dataset.mediaField;
    if (mediaField) {
      const media = this.currentMedia();
      if (!media || !["url", "altText"].includes(mediaField)) return;
      if (mediaField === "url" && media.url !== target.value) {
        media.originalUrl = null;
        media.mimeType = null;
        media.width = null;
        media.height = null;
        media.source = { provider: "author_url", retrievedAt: new Date().toISOString() };
        media.rights = null;
      }
      media[mediaField] = target.value;
      return;
    }
    if (!target.name) return;
    const representationIndex = target.dataset.representationIndex;
    if (representationIndex !== undefined) {
      const representation = this.draft.representations[Number(representationIndex)];
      if (representation && Object.prototype.hasOwnProperty.call(representation, target.name)) representation[target.name] = target.value;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(this.draft, target.name)) this.draft[target.name] = target.value;
  }

  onInput = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) event.target.setCustomValidity("");
    this.updateDraftField(event.target);
    this.persistWorkingDraft();
  };

  onInvalid = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    target.setCustomValidity(target instanceof HTMLSelectElement ? "Seleziona un'opzione prima di continuare." : "Compila questo campo prima di continuare.");
  };

  onChange = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) target.setCustomValidity("");
    this.updateDraftField(target);
    this.persistWorkingDraft();
    const mediaUpload = target.closest("input[data-media-upload]");
    if (mediaUpload instanceof HTMLInputElement && mediaUpload.files?.[0]) {
      const file = mediaUpload.files[0];
      this.mediaBusy = true; this.error = null; this.mediaNotice = "Caricamento dell'immagine in corso…"; this.render();
      try { await this.uploadMediaFile(file); }
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
    const connectionScope = target.closest("select[data-connection-scope]");
    if (connectionScope) {
      this.connectionScopeKey = connectionScope.value;
      this.error = null;
      this.render();
      return;
    }
    const connectionRelation = target.closest("select[data-connection-relation]");
    if (connectionRelation) {
      this.connectionRelationTypeId = connectionRelation.value;
      this.error = null;
      this.render();
      return;
    }
    const membership = target.closest("input[data-content-space-id]");
    if (!membership) return;
    membership.disabled = true; this.error = null;
    try {
      await authoringRepository.setContentSpaceMembership({ contentSpaceId: membership.dataset.contentSpaceId, itemId: this.itemId, member: membership.checked });
      const projected = (this.projection?.workspaceMemberships || []).find((entry) => id(entry.contentSpaceId) === membership.dataset.contentSpaceId);
      if (projected) projected.member = membership.checked;
      this.notice = "Spazio editoriale aggiornato.";
    } catch (error) { membership.checked = !membership.checked; this.error = error instanceof Error ? error.message : "Spazio editoriale non aggiornato"; }
    finally { membership.disabled = false; this.render(); }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form) return;
    event.preventDefault(); const data = new FormData(form);
    this.busy = true; this.error = null; this.notice = null; this.render();
    try {
      if (form.matches("[data-connection-search]")) {
        const query = String(data.get("connectionTargetQuery") || "").trim();
        this.connectionTargetQuery = query;
        const result = await authoringRepository.searchItemConnectionTargets(this.itemId, {
          editionId: id(this.selectedEdition()?.id),
          q: query,
          limit: 20,
        });
        this.connectionTargets = result.results || [];
        if (!this.connectionTargets.some((entry) => id(entry.id) === id(this.selectedConnectionTarget?.id))) this.selectedConnectionTarget = null;
      } else if (form.matches("[data-connection-form]")) {
        if (!this.selectedConnectionTarget) throw new Error("Cerca e seleziona il contenuto da collegare.");
        this.connectionsProjection = await authoringRepository.createItemConnection(this.itemId, {
          editionId: id(this.selectedEdition()?.id),
          scopeKey: String(data.get("scopeKey") || ""),
          relationTypeDefinitionId: String(data.get("relationTypeDefinitionId") || ""),
          targetItemId: id(this.selectedConnectionTarget.id),
          sourceSubjectClassDefinitionId: String(data.get("sourceSubjectClassDefinitionId") || "") || null,
          targetSubjectClassDefinitionId: String(data.get("targetSubjectClassDefinitionId") || "") || null,
          weight: Number(data.get("weight") || 5),
          provenanceOrigin: String(data.get("provenanceOrigin") || "human"),
          note: String(data.get("note") || "").trim(),
        });
        this.connectionScopeKey = this.connectionsProjection?.defaultScopeKey || "";
        this.connectionEditorOpen = false;
        this.connectionRelationTypeId = "";
        this.connectionTargetQuery = "";
        this.connectionTargets = [];
        this.selectedConnectionTarget = null;
        this.notice = "Collegamento aggiunto.";
        this.activeStep = 4;
      } else if (form.matches("[data-create-item]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
        if (!this.selectedSubject) throw new Error("Scegli prima di cosa deve parlare il contenuto");
        const item = await authoringRepository.createItem({ primarySubjectId: this.selectedSubject.id || this.selectedSubject._id, ownerType: this.principal.type, ownerId: this.principal.id });
        this.itemId = item._id || item.id;
        const url = new URL(window.location.href); url.search = ""; url.searchParams.set("itemId", this.itemId); window.history.replaceState({}, "", url);
        await this.reloadProjection(); await this.prepareNewEdition();
        this.notice = "Soggetto confermato. Ora completa le informazioni generali.";
      } else if (form.matches("[data-content-details]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        this.normalizeAndValidateGeneralDetails();
        this.activeStep = 3;
        this.persistWorkingDraft();
        this.notice = "Informazioni generali completate. Ora scegli le regole editoriali e aggiungi i testi.";
      } else if (form.matches("[data-content-draft]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        this.normalizeAndValidateGeneralDetails();
        for (const representation of this.draft.representations) {
          representation.locale = String(representation.locale || "").trim();
          representation.text = String(representation.text || "").trim();
        }
        this.persistWorkingDraft();
        const incompleteTextIndex = this.draft.representations.findIndex((entry) => [entry.durationTypeDefinitionId, entry.languageLevelDefinitionId, entry.locale, entry.text].some((value) => !String(value || "").trim()));
        if (incompleteTextIndex >= 0) {
          this.activeRepresentationIndex = incompleteTextIndex;
          throw new Error(`Completa durata, livello di linguaggio, lingua e testo per ${incompleteTextIndex === 0 ? "il testo principale" : `il testo ${incompleteTextIndex + 1}`}.`);
        }
        if (this.newEditionMode) await this.createEditionFromDraft(); else await this.updateEditionFromDraft();
      } else if (form.matches("[data-workflow-form]")) {
        const operationCode = String(data.get("operationCode") || ""); const operation = this.availableOperation(operationCode);
        if (!operation || !isWorkflowOperation(operationCode)) throw new Error("Operazione editoriale non disponibile");
        const message = operation.requiresMessage ? String(data.get("message") || "").trim() : "";
        if (operation.requiresMessage && !message) throw new Error("Scrivi la motivazione delle modifiche richieste");
        await this.executeWorkflow(operationCode, message);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally {
      this.busy = false;
      this.render();
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
        label: this.draft.label, authorCredits: [this.draft.author].filter(Boolean), metadata: { license: this.draft.license }, relatedSubjectIds: [], tags: [], illustrativeMedia: this.draft.illustrativeMedia.map((entry) => writableMedia(entry, { includeId: false })).filter(Boolean), selectionSignals: [],
        presentationVariants: [{ key: "standard", label: "Standard", semanticFocus: [], presentationAspects: [], knowledgeRequirements: [], representations: this.draft.representations.map((entry) => ({ durationTypeDefinitionId: entry.durationTypeDefinitionId, languageLevelDefinitionId: entry.languageLevelDefinitionId, locale: entry.locale, text: entry.text })) }],
        defaultPresentation: null,
      },
    });
    const variant = created.revision?.presentationVariants?.[0]; const representation = variant?.representations?.[0];
    if (variant?._id && representation?._id) await authoringRepository.updateEdition(created.edition._id, { defaultPresentation: { variantId: variant._id, representationId: representation._id } });
    this.clearWorkingDraft();
    this.newEditionMode = false; this.namespaceControls = null; await this.reloadProjection(created.edition._id); await this.reloadAuthoringContext(); this.activeStep = 4;
    this.notice = "Bozza salvata. Ora puoi aggiungere collegamenti facoltativi.";
  }

  async updateEditionFromDraft() {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision(); const editionId = id(this.selectedEdition()?.id); if (!revision || !editionId) throw new Error("Nessuna versione modificabile");
    const payload = projectedRevisionToWrite(revision);
    payload.label = this.draft.label; payload.authorCredits = [this.draft.author].filter(Boolean); payload.metadata = { license: this.draft.license };
    payload.illustrativeMedia = this.draft.illustrativeMedia.map((entry) => writableMedia(entry)).filter(Boolean);
    const variant = payload.presentationVariants?.[0]; if (!variant) throw new Error("La struttura dei testi non è disponibile");
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
    await this.reloadProjection(editionId); this.activeStep = 4;
    this.notice = "Modifiche salvate. Ora puoi controllare i collegamenti.";
  }

  async ensureDefaultRepresentation(editionId, revision) {
    const variant = revision?.presentationVariants?.[0]; const representation = variant?.representations?.[0];
    const variantId = id(variant); const representationId = id(representation);
    if (!variantId || !representationId) {
      if (revision?.defaultPresentation) await authoringRepository.updateEdition(editionId, { defaultPresentation: null });
      return;
    }
    const current = revision.defaultPresentation;
    const currentVariant = (revision.presentationVariants || []).find((entry) => id(entry._id || entry.id) === id(current?.variantId));
    const currentStillExists = currentVariant?.representations?.some((entry) => id(entry._id || entry.id) === id(current?.representationId));
    if (currentStillExists) return;
    await authoringRepository.updateEdition(editionId, { defaultPresentation: { variantId, representationId } });
  }

  async executeWorkflow(operationCode, message = "") {
    if (operationCode !== "workflow.check") throw new Error("In questa schermata è disponibile soltanto il controllo finale");
    const editionId = id(this.selectedEdition()?.id); if (!editionId) throw new Error("Versione editoriale non disponibile");
    const result = await marketplaceRepository.executeWorkspaceOperation({ operationCode, sourceRef: { resourceType: "item_edition", resourceId: editionId }, targetPrincipal: { type: this.principal.type, id: this.principal.id }, payload: message ? { message } : {} });
    await this.reloadProjection(editionId); this.activeStep = 5;
    const issues = result?.result?.issues || [];
    this.privateSuccessOpen = Boolean(result?.result?.finalized && !issues.length);
    this.notice = issues.length ? `Controllo completato: ${issues.length} problema/i da risolvere.` : null;
  }

  onSubjectSelected = async (event) => {
    if (this.itemId || !event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.notice = event.detail.source === "reuse_existing" ? "Identità già presente: è stato riutilizzato il soggetto ArtAround esistente." : "Soggetto selezionato. Puoi continuare.";
    this.render();
    await this.loadSuggestedMedia();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const addConnection = target.closest("button[data-add-connection]");
    if (addConnection) {
      this.connectionEditorOpen = true;
      this.connectionScopeKey ||= this.connectionsProjection?.defaultScopeKey || "";
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-connection-relation]")?.focus({ preventScroll: true }));
      return;
    }
    const cancelConnection = target.closest("button[data-cancel-connection]");
    if (cancelConnection) {
      this.connectionEditorOpen = false;
      this.connectionRelationTypeId = "";
      this.connectionTargetQuery = "";
      this.connectionTargets = [];
      this.selectedConnectionTarget = null;
      this.error = null;
      this.render();
      return;
    }
    const selectConnectionTarget = target.closest("button[data-connection-target-id]");
    if (selectConnectionTarget) {
      this.selectedConnectionTarget = this.connectionTargets.find((entry) => id(entry.id) === selectConnectionTarget.dataset.connectionTargetId) || null;
      this.error = null;
      this.render();
      return;
    }
    const removeConnection = target.closest("button[data-remove-connection]");
    if (removeConnection) {
      this.busy = true; this.error = null; this.notice = null; this.render();
      try {
        this.connectionsProjection = await authoringRepository.removeItemConnection(this.itemId, {
          editionId: id(this.selectedEdition()?.id),
          connectionId: removeConnection.dataset.removeConnection,
          contextId: removeConnection.dataset.contextId,
        });
        this.connectionScopeKey = this.connectionsProjection?.defaultScopeKey || "";
        this.notice = "Collegamento rimosso.";
      } catch (error) { this.error = error instanceof Error ? error.message : "Non è stato possibile rimuovere il collegamento"; }
      finally { this.busy = false; this.render(); }
      return;
    }
    const representationChoice = target.closest("button[data-representation-choice]");
    if (representationChoice) {
      const index = Number(representationChoice.dataset.representationIndex);
      const field = representationChoice.dataset.representationChoice;
      const representation = this.draft.representations[index];
      if (representation && ["durationTypeDefinitionId", "languageLevelDefinitionId"].includes(field)) {
        representation[field] = representationChoice.dataset.value || "";
        this.error = null;
        this.persistWorkingDraft();
        this.render();
        requestAnimationFrame(() => this.querySelector(`details[data-representation-choice-menu="${field}"][data-representation-index="${index}"] summary`)?.focus({ preventScroll: true }));
      }
      return;
    }
    const closePrivateSuccess = target.closest("button[data-close-private-success]");
    if (closePrivateSuccess) { this.privateSuccessOpen = false; this.render(); return; }
    const changeMediaButton = target.closest("button[data-change-media]");
    if (changeMediaButton) {
      if (!this.currentMedia()) this.draft.illustrativeMedia = [{ url: "", altText: this.selectedSubject?.preferredLabel || "", source: { provider: "author_url", retrievedAt: new Date().toISOString() }, rights: null }];
      this.mediaEditorOpen = true; this.error = null; this.persistWorkingDraft(); this.render();
      requestAnimationFrame(() => this.querySelector("[data-media-field='url']")?.focus());
      return;
    }
    const closeMediaButton = target.closest("button[data-close-media-editor]");
    if (closeMediaButton) { this.mediaEditorOpen = false; this.persistWorkingDraft(); this.render(); return; }
    const removeMediaButton = target.closest("button[data-remove-media]");
    if (removeMediaButton) {
      this.draft.illustrativeMedia = [];
      this.mediaEditorOpen = false;
      this.mediaSuggestionAttempted = true;
      this.mediaNotice = "Immagine rimossa dalla bozza.";
      this.persistWorkingDraft();
      this.render();
      return;
    }
    const suggestMediaButton = target.closest("button[data-suggest-media]");
    if (suggestMediaButton) { this.draft.illustrativeMedia = []; await this.loadSuggestedMedia({ force: true }); return; }
    const addTextButton = target.closest("button[data-add-text]");
    if (addTextButton) { this.draft.representations.push(newRepresentation()); this.error = null; this.notice = "Testo aggiunto. Selezionalo quando vuoi compilarlo."; this.persistWorkingDraft(); this.render(); return; }
    const removeTextButton = target.closest("button[data-remove-text]");
    if (removeTextButton) { const index = Number(removeTextButton.dataset.removeText); if (this.draft.representations[index]) { this.draft.representations.splice(index, 1); if (this.activeRepresentationIndex === index) this.activeRepresentationIndex = null; else if (Number.isInteger(this.activeRepresentationIndex) && this.activeRepresentationIndex > index) this.activeRepresentationIndex -= 1; this.notice = "Testo rimosso dalla bozza. Salva il contenuto per confermare la modifica."; this.persistWorkingDraft(); this.render(); } return; }
    const collapsedText = target.closest("[data-collapsed-text]");
    if (collapsedText) { const index = Number(collapsedText.dataset.collapsedText); if (this.draft.representations[index]) { this.activeRepresentationIndex = index; this.error = null; this.persistWorkingDraft(); this.render(); requestAnimationFrame(() => this.querySelector(`[data-representation-index="${index}"]`)?.focus({ preventScroll: true })); } return; }
    const stepButton = target.closest("button[data-step]"); if (stepButton) { const step = Number(stepButton.dataset.step); if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.persistWorkingDraft(); this.render(); } return; }
    const backButton = target.closest("button[data-back-step]"); if (backButton) { const step = Math.max(1, Number(backButton.dataset.backStep) || 1); if (this.canOpenStep(step)) { this.activeStep = step; this.persistWorkingDraft(); this.render(); } return; }
    const newEditionButton = target.closest("button[data-new-edition]");
    if (newEditionButton) { this.busy = true; this.error = null; this.render(); try { await this.prepareNewEdition(); } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aggiungere una nuova versione editoriale"; } finally { this.busy = false; this.render(); } return; }
    const editButton = target.closest("button[data-edit-content]"); if (editButton) { this.newEditionMode = false; this.hydrateDraftFromProjection(); this.activeRepresentationIndex = null; this.activeStep = 2; this.persistWorkingDraft(); this.render(); return; }
    const editionButton = target.closest("button[data-edition-id]");
    if (editionButton) { this.busy = true; this.error = null; this.render(); try { this.newEditionMode = false; this.namespaceControls = null; await this.reloadProjection(editionButton.dataset.editionId); this.activeStep = 5; } catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aprire la versione editoriale"; } finally { this.busy = false; this.render(); } }
  };

  remediationHref() {
    const configurable = this.preflight?.content?.needsConfiguration?.[0];
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.context?.type === "organization" && this.context?.id) return `/organizations/detail?organizationId=${encodeURIComponent(id(this.context.id))}&section=rules`;
    return "/profile#account-rules";
  }

  normalizeAndValidateGeneralDetails() {
    this.draft.label = String(this.draft.label || "").trim();
    this.draft.author = String(this.draft.author || this.defaultAuthor()).trim();
    this.draft.license = String(this.draft.license || "").trim();
    if (!this.draft.label || !this.draft.license) throw new Error("Completa titolo e licenza prima di continuare.");
    const media = this.currentMedia();
    if (!media) return;
    media.url = String(media.url || "").trim();
    media.altText = String(media.altText || "").trim();
    if (!media.url || !media.altText) {
      this.activeStep = 2;
      this.mediaEditorOpen = true;
      throw new Error("Completa l'indirizzo e la descrizione dell'immagine oppure rimuovila.");
    }
  }
  generalDetailsReady() {
    const fieldsReady = [this.draft.label, this.draft.license]
      .every((value) => String(value || "").trim());
    const media = this.currentMedia();
    const mediaReady = !media || [media.url, media.altText].every((value) => String(value || "").trim());
    return Boolean(fieldsReady && mediaReady);
  }
  contentDraftReady() {
    const rulesReady = !this.newEditionMode || Boolean(this.draft.namespaceId && this.namespaceControls);
    const textsReady = this.draft.representations.every((entry) => [entry.durationTypeDefinitionId, entry.languageLevelDefinitionId, entry.locale, entry.text].every((value) => String(value || "").trim()));
    return Boolean(this.generalDetailsReady() && rulesReady && textsReady);
  }
  canOpenStep(step) {
    if (step === 1) return true;
    if (step === 2) return Boolean(this.itemId);
    if (step === 3) return Boolean(this.itemId && this.generalDetailsReady());
    if (step === 4) return Boolean(this.selectedRevision() && !this.newEditionMode);
    if (step === 5) return Boolean(this.selectedRevision() && !this.newEditionMode);
    return false;
  }

  renderProgress() {
    const stages = [[1, "Di cosa parla"], [2, "Informazioni generali"], [3, "Regole e testi"], [4, "Collegamenti"], [5, "Controllo finale"]];
    const currentLabel = stages.find(([step]) => step === this.activeStep)?.[1] || stages[0][1];
    return `<nav class="authoring-progress" aria-label="Passaggi di creazione"><div class="authoring-progress__summary"><span>Passaggio ${this.activeStep} di ${stages.length}</span><strong>${escapeHtml(currentLabel)}</strong></div><ol>${stages.map(([step, label]) => { const enabled = this.canOpenStep(step); const current = this.activeStep === step; const complete = step === 1 ? Boolean(this.itemId) : step === 2 ? this.generalDetailsReady() : [3, 4].includes(step) ? Boolean(this.selectedRevision() && !this.newEditionMode) : this.selectedRevision()?.status === "published"; return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${enabled ? "" : "disabled"} aria-current="${current ? "step" : "false"}" aria-label="Passaggio ${step}: ${escapeHtml(label)}"><span>${complete ? icon("check", { size: 14 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`; }).join("")}</ol></nav>`;
  }

  renderPrerequisiteBlocker() {
    if (this.itemId || this.preflight?.content?.allowed !== false) return "";
    const blocker = this.preflight?.content?.blockers?.[0];
    return `<section class="panel blocker-panel"><span class="resource-mark">${icon("warning", { size: 22 })}</span><div><span class="eyebrow">Prima di iniziare</span><h2>Prepara le regole editoriali</h2><p>${escapeHtml(blocker?.message || "Manca una configurazione editoriale utilizzabile.")}</p><a class="button-link" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole editoriali ${icon("chevron", { size: 15 })}</a></div></section>`;
  }
  renderSubjectSummary() {
    if (!this.selectedSubject) return "";
    const identities = (this.selectedSubject.externalIdentities || []).map((identity) => `${identity.scheme}: ${identity.id}`).join(" · ");
    return `<article class="subject-summary"><span class="eyebrow">Soggetto del contenuto</span><h3>${escapeHtml(this.selectedSubject.preferredLabel)}</h3><p>${escapeHtml(this.selectedSubject.description || "Nessuna descrizione disponibile")}</p>${identities ? `<details class="technical-details"><summary>Identità tecnica</summary><p>${escapeHtml(identities)}</p></details>` : ""}</article>`;
  }

  mediaSourceLabel(media) {
    const labels = {
      wikimedia_commons: "Proposta da Wikidata · immagine Wikimedia Commons",
      author_upload: "Caricata dal dispositivo",
      author_url: "Aggiunta tramite indirizzo web",
    };
    return labels[media?.source?.provider] || "Immagine del contenuto";
  }

  renderMediaEditor(media) {
    if (!this.mediaEditorOpen) return "";
    return `<div class="item-media-editor"><label>Indirizzo dell'immagine<input name="mediaUrl" data-media-field="url" inputmode="url" required value="${escapeHtml(media?.url || "")}" placeholder="https://..."></label><label>Descrizione dell'immagine<input name="mediaAltText" data-media-field="altText" required value="${escapeHtml(media?.altText || "")}" placeholder="Descrivi ciò che aiuta a riconoscere il soggetto"><small>Questa descrizione viene letta dalle tecnologie assistive.</small></label><div class="media-upload-row"><label class="button-secondary media-upload">${icon("image", { size: 15 })} Carica dal dispositivo<input type="file" data-media-upload accept="image/jpeg,image/png,image/webp,image/avif"></label><small>JPEG, PNG, WebP o AVIF · i file grandi vengono ottimizzati automaticamente</small><button class="button-secondary" type="button" data-close-media-editor>Chiudi modifica</button></div></div>`;
  }

  renderMediaCard({ compact = false } = {}) {
    const media = this.currentMedia();
    const hasMedia = Boolean(String(media?.url || "").trim());
    const canSuggest = Boolean(this.wikidataIdentity());
    if (this.mediaBusy) return `<section class="item-media-card ${compact ? "item-media-card--compact" : ""}" aria-busy="true"><div class="media-placeholder">${icon("image", { size: 24 })}</div><div><span class="eyebrow">Immagine del contenuto · facoltativa</span><h3>Ricerca dell'immagine in corso…</h3><p>Puoi continuare anche se Wikidata non propone alcuna immagine.</p></div></section>`;
    if (!hasMedia) {
      return `<section class="item-media-card item-media-card--empty ${compact ? "item-media-card--compact" : ""}"><div class="media-placeholder">${icon("image", { size: 24 })}</div><div class="item-media-copy"><span class="eyebrow">Immagine del contenuto · facoltativa</span><h3>Nessuna immagine selezionata</h3><p>${escapeHtml(this.mediaNotice || "Puoi aggiungere un'immagine che aiuti a riconoscere il soggetto durante la visita.")}</p><div class="item-media-actions"><button class="button-secondary" type="button" data-change-media>${icon("plus", { size: 15 })} Aggiungi immagine</button>${canSuggest ? `<button class="button-secondary" type="button" data-suggest-media>Proponi da Wikidata</button>` : ""}</div>${this.renderMediaEditor(media)}</div></section>`;
    }
    const sourceUrl = safeExternalHref(media.source?.pageUrl);
    const licenseUrl = safeExternalHref(media.rights?.licenseUrl);
    const attribution = media.rights?.attribution || media.rights?.creator;
    const rights = [attribution, media.rights?.licenseName].filter(Boolean).join(" · ");
    return `<section class="item-media-card ${compact ? "item-media-card--compact" : ""}"><figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || "")}" loading="lazy"></figure><div class="item-media-copy"><span class="eyebrow">Immagine del contenuto · facoltativa</span><h3>${escapeHtml(this.mediaSourceLabel(media))}</h3><p>${escapeHtml(media.altText || "Descrizione da completare")}</p>${rights ? `<p class="media-rights">${escapeHtml(rights)}</p>` : ""}<div class="media-links">${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Apri la fonte</a>` : ""}${licenseUrl ? `<a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noreferrer">Vedi la licenza</a>` : ""}</div><div class="item-media-actions"><button class="button-secondary" type="button" data-change-media>${icon("edit", { size: 15 })} Cambia</button><button class="button-secondary" type="button" data-remove-media>${icon("trash", { size: 15 })} Rimuovi</button></div>${this.mediaNotice ? `<p class="media-notice">${escapeHtml(this.mediaNotice)}</p>` : ""}${this.renderMediaEditor(media)}</div></section>`;
  }

  renderReviewMedia() {
    const media = this.selectedRevision()?.illustrativeMedia?.[0];
    if (!media?.url) return `<section class="review-media review-media--empty"><span class="eyebrow">Immagine</span><strong>Nessuna immagine associata</strong><p>Il contenuto resterà utilizzabile anche senza immagine.</p></section>`;
    const rights = [media.rights?.attribution || media.rights?.creator, media.rights?.licenseName].filter(Boolean).join(" · ");
    return `<section class="review-media"><figure><img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || "")}" loading="lazy"></figure><div><span class="eyebrow">Immagine mostrata durante la visita</span><strong>${escapeHtml(media.altText || "Descrizione non disponibile")}</strong><p>${escapeHtml(this.mediaSourceLabel(media))}${rights ? ` · ${escapeHtml(rights)}` : ""}</p></div></section>`;
  }

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    const venue = this.venueTargetContext;
    const physicalContext = venue ? `<aside class="context-box"><span class="eyebrow">Oggetto della sede</span><strong>${escapeHtml(venue.venueTarget.label)}</strong><p>${escapeHtml(venue.venue.name)}${venue.venueTarget.description ? ` · ${escapeHtml(venue.venueTarget.description)}` : ""}</p><p class="note">L'oggetto serve a precompilare il soggetto. Il contenuto resta editoriale e non incorpora la posizione fisica.</p>${(venue.recognitionMedia || []).length ? `<details class="technical-details"><summary>Riconoscimento fisico</summary><p>${venue.recognitionMedia.length} immagine/i restano nella configurazione della sede, separate dal contenuto editoriale.</p></details>` : ""}</aside>` : "";
    if (this.itemId) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Soggetto confermato</h2><p>Il soggetto identifica in modo univoco ciò di cui parla il contenuto.</p></div></header>${physicalContext}${this.renderSubjectSummary()}<div class="step-actions"><button type="button" data-step="2">Continua alle informazioni ${icon("chevron", { size: 15 })}</button></div></section>`;
    const subjectSelection = this.selectedSubject
      ? `<form data-create-item class="subject-confirmation">${this.renderSubjectSummary()}<div class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>${icon("check", { size: 16 })} Soggetto selezionato · Continua ${icon("chevron", { size: 15 })}</button></div></form>`
      : `<artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Trova l'opera, la persona o il concetto</h2><p>Cerca prima un'identità già esistente; creane una nuova solo se non trovi quella corretta.</p></div></header>${physicalContext}${subjectSelection}</section>`;
  }

  renderNamespaceSelector() {
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (!choices.length) return `<div class="empty-state compact"><h3>Nessun'altra regola editoriale disponibile</h3><a class="button-link secondary" data-route href="${escapeHtml(this.remediationHref())}">Gestisci le regole editoriali</a></div>`;
    const options = [`<option value="">Scegli le regole editoriali</option>`, ...choices.map((choice) => `<option value="${escapeHtml(choice.id)}" ${choice.id === this.draft.namespaceId ? "selected" : ""}>${escapeHtml(choice.name)}${choice.ownership === "licensed" ? " · disponibili tramite licenza" : ""}</option>`)].join("");
    return `<label>Regole editoriali<select name="namespaceId" data-namespace-select required>${options}</select><small>Definiscono durata e linguaggio disponibili.</small></label>`;
  }

  personalizationControls() { return this.newEditionMode ? this.namespaceControls?.controls || null : this.selectedNamespace()?.revision || null; }
  renderRepresentationEditors(controls) {
    const choiceMenu = ({ index, field, label, selected, placeholder, options }) => {
      const labelId = `representation-${index}-${field}-label`;
      const selectedOption = options.find((entry) => entry.value === selected);
      return `<div class="representation-choice"><span class="representation-choice__label" id="${labelId}">${escapeHtml(label)}</span><input type="hidden" name="${field}" data-representation-index="${index}" value="${escapeHtml(selected)}"><details name="representation-choice" data-representation-choice-menu="${field}" data-representation-index="${index}"><summary aria-labelledby="${labelId}"><span>${escapeHtml(selectedOption?.label || placeholder)}</span></summary><div class="representation-choice__options" role="listbox" aria-labelledby="${labelId}">${options.map((entry) => `<button class="representation-choice__option" type="button" role="option" aria-selected="${entry.value === selected}" data-representation-choice="${field}" data-representation-index="${index}" data-value="${escapeHtml(entry.value)}"><span>${escapeHtml(entry.label)}</span>${entry.value === selected ? icon("check", { size: 15 }) : ""}</button>`).join("")}</div></details></div>`;
    };
    const durationOptions = (controls.durationTypes || []).map((entry) => ({ value: entry.definitionId, label: `${entry.label} · ${entry.targetSeconds}s` }));
    const languageOptions = (controls.languageLevels || []).map((entry) => ({ value: entry.definitionId, label: entry.label }));
    if (!Number.isInteger(this.activeRepresentationIndex) || this.activeRepresentationIndex < 0 || this.activeRepresentationIndex >= this.draft.representations.length) this.activeRepresentationIndex = null;
    if (!this.draft.representations.length) return `<div class="text-empty-state" role="status"><span class="text-empty-state__icon">${icon("edit", { size: 22 })}</span><div><h3>Non hai ancora aggiunto nessun testo</h3><p>Puoi salvare la bozza anche così. Per superare il controllo dovrai aggiungere almeno un testo completo.</p></div></div>`;
    return `<div class="representation-list">${this.draft.representations.map((representation, index) => {
      const active = index === this.activeRepresentationIndex;
      const title = index === 0 ? "Prima versione del testo" : "Versione aggiuntiva";
      const duration = (controls.durationTypes || []).find((entry) => entry.definitionId === representation.durationTypeDefinitionId);
      const language = (controls.languageLevels || []).find((entry) => entry.definitionId === representation.languageLevelDefinitionId);
      const durationLabel = duration ? `${duration.label}${Number.isFinite(Number(duration.targetSeconds)) ? ` · ${duration.targetSeconds}s` : ""}` : "Da scegliere";
      const languageLabel = language?.label || "Da scegliere";
      const localeLabel = representation.locale || "Da indicare";
      const removeButton = `<button class="button-secondary remove-text" type="button" data-remove-text="${index}" aria-label="Rimuovi il testo ${index + 1}">${icon("trash", { size: 15 })} Rimuovi</button>`;
      if (!active) return `<article class="representation-editor representation-editor--collapsed" data-representation-index="${index}" data-collapsed-text="${index}"><header><div><span class="eyebrow">${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</span><h3>${title}</h3></div><div class="representation-compact-actions"><button class="button-secondary select-text" type="button" data-select-text="${index}" aria-expanded="false">${icon("edit", { size: 15 })} Modifica</button>${removeButton}</div></header><dl class="representation-summary"><div><dt>Durata</dt><dd>${escapeHtml(durationLabel)}</dd></div><div><dt>Livello di linguaggio</dt><dd>${escapeHtml(languageLabel)}</dd></div><div><dt>Lingua</dt><dd>${escapeHtml(localeLabel)}</dd></div></dl></article>`;
      return `<article class="representation-editor" data-representation-index="${index}" data-selected="true" tabindex="-1"><header><div><span class="eyebrow">${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</span><h3>${title}</h3></div>${removeButton}</header><div class="representation-settings">${choiceMenu({ index, field: "durationTypeDefinitionId", label: "Durata", selected: representation.durationTypeDefinitionId, placeholder: "Scegli la durata", options: durationOptions })}${choiceMenu({ index, field: "languageLevelDefinitionId", label: "Livello di linguaggio", selected: representation.languageLevelDefinitionId, placeholder: "Scegli il livello", options: languageOptions })}<label>Lingua<input name="locale" data-representation-index="${index}" required value="${escapeHtml(representation.locale)}" placeholder="es. it-IT"></label></div><label>Testo<textarea name="text" data-representation-index="${index}" rows="8" required>${escapeHtml(representation.text)}</textarea></label></article>`;
    }).join("")}</div>`;
  }

  renderStepTwo() {
    if (this.activeStep !== 2 || !this.itemId) return "";
    const creditedTo = this.draft.author || this.defaultAuthor();
    const heading = `<header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Informazioni generali</span><h2>Presenta il contenuto</h2><p>Queste informazioni non dipendono dalle regole editoriali e saranno comuni a tutti i testi.</p></div></header>`;
    return `<section class="wizard-step panel">${heading}<form data-content-details class="editor-form"><label>Titolo del contenuto<input name="label" required value="${escapeHtml(this.draft.label)}"></label><label>Licenza<input name="license" required value="${escapeHtml(this.draft.license)}"></label><p class="note author-credit">Autore assegnato automaticamente: <strong>${escapeHtml(creditedTo)}</strong>, proprietario di questa area di lavoro.</p>${this.renderMediaCard({ compact: true })}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="1">Indietro</button><button type="submit">Continua a regole e testi ${icon("chevron", { size: 15 })}</button></div></form></section>`;
  }

  renderStepThree() {
    if (this.activeStep !== 3 || !this.itemId || !this.generalDetailsReady()) return "";
    const controls = this.personalizationControls();
    const namespaceName = this.newEditionMode ? this.namespaceControls?.namespace?.name : this.selectedNamespace()?.name;
    const namespaceChoice = this.newEditionMode
      ? this.renderNamespaceSelector()
      : `<div class="selection-summary"><span>Regole editoriali</span><strong>${escapeHtml(namespaceName || "Non disponibili")}</strong><small>Queste regole determinano le durate e i livelli di linguaggio disponibili.</small></div>`;
    const heading = `<header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Regole editoriali e testi</span><h2>Configura e scrivi i testi</h2><p>Le regole editoriali determinano le durate e i livelli di linguaggio disponibili. Puoi salvare la bozza senza testi; per superare il controllo ne servirà almeno uno completo.</p></div></header>`;
    if (!controls) return `<section class="wizard-step panel">${heading}<div class="rules-choice">${namespaceChoice}</div><p class="note">Scegli le regole editoriali per vedere le durate e i livelli disponibili.</p><div class="step-actions"><button class="button-secondary" type="button" data-back-step="2">Indietro</button></div></section>`;
    const addTextLabel = this.draft.representations.length ? "Aggiungi un altro testo" : "Aggiungi un testo";
    return `<section class="wizard-step panel">${heading}<div class="rules-choice">${namespaceChoice}</div><form data-content-draft class="editor-form">${this.renderRepresentationEditors(controls)}<button class="button-secondary add-text" type="button" data-add-text>${icon("plus", { size: 15 })} ${addTextLabel}</button><div class="step-actions"><button class="button-secondary" type="button" data-back-step="2">Indietro</button><button type="submit">${this.newEditionMode ? "Salva bozza e vai ai collegamenti" : "Salva modifiche e vai ai collegamenti"} ${icon("chevron", { size: 15 })}</button></div></form>${this.renderMemberships()}${this.renderTechnicalPresentation()}</section>`;
  }

  renderConnectionTargetSearch() {
    const results = this.connectionTargets || [];
    const selectedId = id(this.selectedConnectionTarget?.id);
    const resultList = this.connectionTargetQuery.length >= 2
      ? results.length
        ? `<div class="connection-target-results">${results.map((entry) => `<article data-selected="${id(entry.id) === selectedId}">${entry.image?.url ? `<img src="${escapeHtml(entry.image.url)}" alt="" loading="lazy">` : `<span class="connection-target-placeholder">${icon("catalog", { size: 20 })}</span>`}<div><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.subject?.label || "Soggetto non indicato")}</small></div><button class="button-secondary" type="button" data-connection-target-id="${escapeHtml(id(entry.id))}">${id(entry.id) === selectedId ? `${icon("check", { size: 15 })} Selezionato` : "Seleziona"}</button></article>`).join("")}</div>`
        : `<p class="connection-search-empty">Nessun altro contenuto con queste regole corrisponde alla ricerca.</p>`
      : `<p class="note">Scrivi almeno due caratteri: i contenuti disponibili compariranno solo dopo la ricerca.</p>`;
    return `<section class="connection-target-picker"><div><span class="eyebrow">Contenuto da collegare</span><h3>Scegli il contenuto di arrivo</h3><p>Il contenuto che stai modificando rimane automaticamente quello di partenza.</p></div><form data-connection-search class="connection-search"><label class="sr-only" for="connection-target-query">Cerca un contenuto</label><input id="connection-target-query" name="connectionTargetQuery" required minlength="2" value="${escapeHtml(this.connectionTargetQuery)}" placeholder="Cerca per titolo o soggetto…"><button class="button-secondary" type="submit">${icon("search", { size: 15 })} Cerca</button></form>${resultList}</section>`;
  }

  renderConnectionEditor() {
    if (!this.connectionEditorOpen) return "";
    const scopes = this.connectionsProjection?.scopes || [];
    const relations = this.connectionsProjection?.relationTypes || [];
    const relation = this.selectedConnectionRelation();
    if (!relations.length) return `<section class="connection-editor"><div class="empty-state compact"><h3>Queste regole editoriali non definiscono relazioni</h3><p>Aggiungi almeno una relazione alle regole editoriali prima di creare un collegamento.</p></div><button class="button-secondary" type="button" data-cancel-connection>Annulla</button></section>`;
    const scopeField = scopes.length > 1
      ? `<label>Ambito editoriale<select name="scopeKey" data-connection-scope required><option value="">Scegli dove usare il collegamento</option>${scopes.map((entry) => `<option value="${escapeHtml(entry.key)}" ${entry.key === this.connectionScopeKey ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}</select><small>Separa collegamenti che appartengono a raccolte editoriali diverse.</small></label>`
      : `<input type="hidden" name="scopeKey" value="${escapeHtml(this.connectionScopeKey || scopes[0]?.key || "")}">${scopes[0] ? `<div class="selection-summary"><span>Ambito editoriale</span><strong>${escapeHtml(scopes[0].label)}</strong><small>${escapeHtml(scopes[0].description || "")}</small></div>` : ""}`;
    const relationOptions = [`<option value="">Scegli il tipo di collegamento</option>`, ...relations.map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${entry.definitionId === this.connectionRelationTypeId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`)].join("");
    const classField = (name, label, values) => values?.length > 1
      ? `<label>${escapeHtml(label)}<select name="${name}" required><option value="">Scegli il tipo</option>${values.map((entry) => `<option value="${escapeHtml(entry.definitionId)}">${escapeHtml(entry.label)}</option>`).join("")}</select></label>`
      : "";
    const relationHelp = relation ? `<aside class="connection-relation-help"><strong>${escapeHtml(relation.label)}</strong><p>${escapeHtml(relation.description || "Collega semanticamente i soggetti dei due contenuti.")}</p><small>${relation.directionality === "symmetric" ? "Il collegamento vale in entrambe le direzioni." : "Il collegamento va dal contenuto corrente a quello selezionato."}</small></aside>` : "";
    const selectedTarget = this.selectedConnectionTarget ? `<article class="selected-connection-target"><span>${icon("check", { size: 16 })}</span><div><strong>${escapeHtml(this.selectedConnectionTarget.title)}</strong><small>${escapeHtml(this.selectedConnectionTarget.subject?.label || "")}</small></div></article>` : "";
    return `<section class="connection-editor"><header><span class="eyebrow">Nuovo collegamento</span><h3>Descrivi come sono collegati</h3></header>${this.renderConnectionTargetSearch()}${selectedTarget}<form data-connection-form class="editor-form">${scopeField}<label>Tipo di collegamento<select name="relationTypeDefinitionId" data-connection-relation required>${relationOptions}</select><small>Le possibilità arrivano direttamente dalle regole editoriali scelte.</small></label>${relationHelp}<div class="connection-class-grid">${classField("sourceSubjectClassDefinitionId", "Tipo del contenuto di partenza", relation?.domain)}${classField("targetSubjectClassDefinitionId", "Tipo del contenuto collegato", relation?.range)}</div><details class="connection-advanced"><summary>Importanza, provenienza e nota</summary><div><label>Importanza<input name="weight" type="number" min="0" max="10" step="1" value="5"><small>Da 0 a 10: indica quanto questo legame deve pesare nell’esplorazione.</small></label><label>Provenienza<select name="provenanceOrigin"><option value="human">Inserito manualmente</option><option value="ai_assisted">Suggerito con assistenza automatica</option><option value="ai_generated">Generato automaticamente</option><option value="imported">Importato</option><option value="forked">Ereditato da una copia</option></select></label><label>Nota facoltativa<textarea name="note" rows="3" maxlength="1000" placeholder="Aggiungi il contesto utile a comprendere il collegamento"></textarea></label></div></details><div class="step-actions"><button class="button-secondary" type="button" data-cancel-connection>Annulla</button><button type="submit" ${this.selectedConnectionTarget && relation && (this.connectionScopeKey || scopes.length === 1) ? "" : "disabled"}>${icon("plus", { size: 15 })} Conferma</button></div></form></section>`;
  }

  renderConnections({ review = false } = {}) {
    const connections = this.connectionsProjection?.connections || [];
    if (!connections.length) return `<div class="connection-empty-state" role="status"><span>${icon("link", { size: 24 })}</span><div><h3>Non hai ancora aggiunto nessun collegamento</h3><p>I collegamenti sono facoltativi. Potrai aggiungerli anche in seguito.</p></div></div>`;
    return `<div class="connection-list">${connections.map((connection) => `<article><div class="connection-direction"><span>${icon("link", { size: 18 })}</span><small>Dal contenuto corrente</small></div><div class="connection-copy"><span class="eyebrow">${escapeHtml(connection.relationType?.label || "Collegamento")}</span><h3>${escapeHtml(connection.targetContent?.title || connection.targetSubject?.label || "Contenuto collegato")}</h3><p>${escapeHtml(connection.targetContent?.subject?.label || connection.targetSubject?.label || "")}</p><div class="connection-meta"><span>Importanza ${escapeHtml(connection.weight)}</span><span>${escapeHtml(connectionOriginLabel(connection.provenance?.origin))}</span><span>${escapeHtml(connection.scopeLabel || "Ambito editoriale")}</span></div>${connection.note ? `<p class="connection-note">${escapeHtml(connection.note)}</p>` : ""}</div>${review ? "" : `<button class="button-secondary" type="button" data-remove-connection="${escapeHtml(id(connection.id))}" data-context-id="${escapeHtml(id(connection.contextId))}">${icon("trash", { size: 15 })} Rimuovi</button>`}</article>`).join("")}</div>`;
  }

  renderStepFour() {
    if (this.activeStep !== 4 || !this.selectedRevision() || this.newEditionMode) return "";
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Collegamenti</span><h2>Collega questo contenuto ad altri contenuti</h2><p>Scegli una relazione prevista dalle regole editoriali. ArtAround registrerà il rapporto tra i soggetti rappresentati dai contenuti; questo passaggio è facoltativo.</p></div></header>${this.renderConnections()}${this.renderConnectionEditor()}${this.connectionEditorOpen ? "" : `<button class="button-secondary add-connection" type="button" data-add-connection>${icon("plus", { size: 15 })} Aggiungi collegamento</button>`}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="3">Indietro</button><button type="button" data-step="5">Continua al controllo ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderMemberships() {
    const rows = (this.projection?.workspaceMemberships || []).map((entry) => `<label class="membership"><input type="checkbox" data-content-space-id="${escapeHtml(id(entry.contentSpaceId))}" ${entry.member ? "checked" : ""}><span><strong>${escapeHtml(entry.name)}</strong><small>Rende il contenuto disponibile in questo spazio editoriale senza cambiarne il proprietario.</small></span></label>`).join("");
    return rows ? `<fieldset class="membership-fieldset"><legend>Spazi editoriali</legend><div class="membership-grid">${rows}</div></fieldset>` : "";
  }
  renderTechnicalPresentation() {
    const revision = this.selectedRevision(); const variant = this.firstVariant(); const representation = this.firstRepresentation();
    if (this.newEditionMode) return `<details class="technical-details"><summary>Identificativi tecnici</summary><p>Regole editoriali: ${escapeHtml(this.draft.namespaceId || "-")} · versione delle regole: ${escapeHtml(this.namespaceControls?.revision?.id || "-")}.</p></details>`;
    if (!revision) return "";
    return `<details class="technical-details"><summary>Identificativi tecnici</summary><p>Versione editoriale: ${escapeHtml(this.selectedEdition()?.id || "-")} · revisione: ${escapeHtml(revision.id || "-")} · regole: ${escapeHtml(this.selectedNamespace()?.revision?.id || "-")} · gruppo di testi: ${escapeHtml(variant?.id || "-")} · testo principale: ${escapeHtml(representation?.id || "-")}</p></details>`;
  }

  reviewSummary() {
    const revision = this.selectedRevision(); const representations = this.firstVariant()?.representations || []; if (!revision) return "";
    return `<div class="review-grid"><article><span>Di cosa parla</span><strong>${escapeHtml(this.selectedSubject?.preferredLabel || "-")}</strong></article><article><span>Titolo</span><strong>${escapeHtml(revision.label || "-")}</strong></article><article><span>Regole editoriali</span><strong>${escapeHtml(this.selectedNamespace()?.name || "-")}</strong></article><article><span>Testi configurati</span><strong>${representations.length}</strong></article><article><span>Creato da</span><strong>${escapeHtml(revision.authorCredits?.[0] || "-")}</strong></article><article><span>Licenza</span><strong>${escapeHtml(revision.license || "-")}</strong></article></div>`;
  }
  renderReviewTexts() {
    const representations = this.firstVariant()?.representations || [];
    if (!representations.length) return `<section class="review-texts review-texts--empty"><span class="eyebrow">Testi</span><h3>Non hai ancora aggiunto nessun testo</h3><p>La bozza è stata salvata, ma il controllo richiederà almeno un testo completo.</p></section>`;
    return `<section class="review-texts"><header><span class="eyebrow">Testi</span><h3>Durata e livello di linguaggio</h3></header><div>${representations.map((representation, index) => `<article><header><strong>${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</strong><span>${escapeHtml(representation.duration?.label || "Durata non indicata")} · ${escapeHtml(representation.languageComplexity?.label || "Livello non indicato")} · ${escapeHtml(representation.locale || "Lingua non indicata")}</span></header><p>${escapeHtml(representation.text || "-")}</p></article>`).join("")}</div></section>`;
  }
  renderWorkflowOperation(operation) {
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit">${operation.code === "workflow.check" ? icon("check", { size: 15 }) : ""}${escapeHtml(workflowLabel(operation))}</button></form>`;
  }
  renderStepFive() {
    if (this.activeStep !== 5 || !this.selectedRevision() || this.newEditionMode) return "";
    const revision = this.selectedRevision(); const integrity = revision.integrity?.status || "needs_review"; const issues = revision.integrity?.issues || []; const operations = this.workflowOperations(); const published = revision.status === "published"; const editAllowed = Boolean(this.availableOperation("item.edit"));
    const statePanel = published ? `<div class="readiness success"><strong>Contenuto privato e corretto</strong><p>Ha superato i controlli e non è visibile nel Marketplace.</p></div>` : integrity === "valid" ? `<div class="readiness success"><strong>Controllo superato</strong></div>` : `<div class="readiness warning"><strong>Serve un controllo</strong><p>Verificheremo testi, impostazioni e riferimenti prima di rendere il contenuto privato.</p></div>`;
    const controls = operations.length ? `<div class="workflow-panel"><h3>Controllo finale</h3><p class="note">Se non ci sono problemi, il contenuto verrà salvato come privato nella tua Libreria.</p><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("")}</div></div>` : "";
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">5</span><div><span class="eyebrow">Controllo finale</span><h2>Verifica che sia tutto pronto</h2><p>Il controllo non rende il contenuto visibile agli altri utenti.</p></div></header>${this.reviewSummary()}${this.renderReviewMedia()}${this.renderReviewTexts()}<section class="review-connections"><header><span class="eyebrow">Collegamenti</span><h3>Contenuti collegati</h3></header>${this.renderConnections({ review: true })}</section>${statePanel}${issues.length ? `<div class="issue-panel"><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul></div>` : ""}${controls}<div class="step-actions"><button class="button-secondary" type="button" data-back-step="4">Indietro ai collegamenti</button>${editAllowed ? `<button class="button-secondary" type="button" data-edit-content>${icon("edit", { size: 15 })} Modifica contenuto</button>` : ""}${this.availableOperation("item.create_edition") && this.preflight?.content?.allowed && this.usableNamespaceChoices({ excludeUsed: true }).length ? `<button class="button-secondary" type="button" data-new-edition>${icon("plus", { size: 15 })} Aggiungi versione editoriale</button>` : ""}</div>${this.renderTechnicalPresentation()}</section>`;
  }

  renderPrivateSuccessDialog() {
    if (!this.privateSuccessOpen) return "";
    const editionId = id(this.selectedEdition()?.id);
    const marketplaceHref = `/workspace/resource?ownership=owned&resourceType=item_edition&resourceId=${encodeURIComponent(editionId)}`;
    return `<div class="private-success-overlay"><section class="private-success-dialog" role="dialog" aria-modal="true" aria-labelledby="private-success-title" tabindex="-1"><span class="private-success-icon">${icon("check", { size: 28 })}</span><div><span class="eyebrow">Controlli superati</span><h2 id="private-success-title">Il contenuto è corretto e ora è privato</h2><p>L’item ha superato tutti i controlli. Resta nella tua Libreria e non è ancora visibile agli altri utenti.</p><p>Quando vuoi, puoi configurare un’offerta e pubblicarlo nel Marketplace, oppure mantenerlo privato.</p></div><div class="private-success-actions"><a class="button-link" data-route href="${escapeHtml(marketplaceHref)}">Configura offerta e pubblica ${icon("chevron", { size: 15 })}</a><button class="button-secondary" type="button" data-close-private-success>Mantieni privato</button></div></section></div>`;
  }
  renderEditions() {
    const editions = this.projection?.editions || []; if (editions.length <= 1 && !this.newEditionMode) return "";
    return `<nav class="edition-tabs" aria-label="Versioni editoriali del contenuto">${editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}" aria-pressed="${!this.newEditionMode && id(this.selectedEdition()?.id) === id(edition.id)}">${escapeHtml(edition.namespace?.name || "Versione")}</button>`).join("")}${this.newEditionMode ? `<span class="status">Nuova bozza</span>` : ""}</nav>`;
  }

  render() {
    const blocked = !this.itemId && this.preflight?.content?.allowed === false;
    this.innerHTML = `${this.styles()}${this.representationStyles()}<main class="page authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><a data-route href="${this.itemId ? "/workspace" : "/create"}">${icon("arrowLeft", { size: 15 })} ${this.itemId ? "Libreria" : "Crea"}</a><span>/</span><span>Contenuto</span></nav><header class="page-header"><div><span class="eyebrow">Crea contenuto</span><h1>${this.itemId ? "Contenuto" : "Nuovo contenuto"}</h1><p>Cinque passaggi: identifica il soggetto, completa le informazioni generali, scegli regole e testi, aggiungi eventuali collegamenti e infine esegui il controllo. Il contenuto resterà privato finché non sceglierai di portarlo nel Marketplace.</p></div></header>${!blocked ? this.renderProgress() : ""}${this.busy ? `<p role="status">Aggiornamento in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.notice)}</p>` : ""}${this.renderPrerequisiteBlocker()}${this.renderEditions()}${blocked ? "" : `${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}${this.renderStepFive()}`}</main>${this.renderPrivateSuccessDialog()}`;
  }

  representationStyles() {
    return `<style>
      .authoring-page{grid-template-columns:minmax(0,1fr)}
      .authoring-page>*,.wizard-step,.editor-form,.representation-list,.representation-editor{min-width:0}
      .representation-editor[data-selected="true"]{border-color:#91a39b;box-shadow:0 0 0 2px rgba(23,62,53,.08)}
      .representation-editor:focus{outline:3px solid rgba(233,168,68,.3);outline-offset:2px}
      .representation-editor--collapsed{gap:.65rem;padding:.8rem 1rem;cursor:pointer;background:#f8faf8;transition:border-color .16s ease,background .16s ease,box-shadow .16s ease}
      .representation-editor--collapsed:hover{border-color:#91a39b;background:#f1f6f3;box-shadow:0 .35rem 1rem rgba(16,40,33,.06)}
      .representation-editor--collapsed>header{align-items:center}
      .representation-choice{position:relative;display:grid;gap:.38rem;min-width:0;color:#173e35}
      .representation-choice__label{font-size:.86rem;font-weight:650}
      .representation-choice details{position:relative;border-radius:.55rem}
      .representation-choice details[open]>summary{margin-bottom:0;border-color:#173e35;box-shadow:0 0 0 3px rgba(233,168,68,.3)}
      .representation-choice summary{display:flex;min-height:2.7rem;align-items:center;justify-content:space-between;gap:.6rem;border:1px solid #91a39b;border-radius:.55rem;padding:.62rem .72rem;background:#fff;list-style:none;font-weight:500;cursor:pointer}
      .representation-choice summary::-webkit-details-marker{display:none}.representation-choice summary::marker{content:""}.representation-choice summary::after{content:"⌄";font-size:1rem;font-weight:800;line-height:1;transition:transform .15s ease}.representation-choice details[open]>summary::after{transform:rotate(180deg)}
      .representation-choice__options{position:absolute;z-index:40;top:calc(100% + .35rem);right:0;left:0;display:grid;gap:.2rem;padding:.3rem;border:1px solid #c4d0ca;border-radius:.6rem;background:#fff;box-shadow:0 .8rem 2rem rgba(16,40,33,.16)}
      .representation-choice__option{display:flex;width:100%;min-height:2.45rem;align-items:center;justify-content:space-between;gap:.5rem;border:0;padding:.55rem .65rem;background:#fff;color:#173e35;text-align:left;box-shadow:none;transform:none}
      .representation-choice__option:hover:not(:disabled),.representation-choice__option[aria-selected="true"]{background:#eef4f1;color:#173e35;box-shadow:none;transform:none}
      .representation-compact-actions{display:flex;align-items:center;justify-content:flex-end;gap:.5rem;flex-wrap:wrap}
      .representation-compact-actions button{min-height:2.3rem;padding:.45rem .65rem}
      .representation-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;margin:0}
      .representation-summary>div{display:grid;min-width:0;gap:.1rem;padding:.55rem .65rem;border-radius:.55rem;background:#fff}
      .representation-summary dt{color:#60706a;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.04em}
      .representation-summary dd{overflow:hidden;margin:0;color:#173e35;font-weight:750;text-overflow:ellipsis;white-space:nowrap}
      .text-empty-state{display:flex;align-items:flex-start;gap:.8rem;padding:1rem;border:1px dashed #91a39b;border-radius:.8rem;background:#f8faf8;color:#476159}
      .text-empty-state__icon{display:grid;place-items:center;flex:0 0 2.5rem;height:2.5rem;border-radius:.65rem;background:#e6eeea;color:#173e35}
      .text-empty-state h3,.text-empty-state p{margin:0}.text-empty-state p{margin-top:.25rem;color:#60706a}
      .subject-confirmation{display:grid;gap:1rem}
      .item-media-card{display:grid;grid-template-columns:minmax(11rem,15rem) minmax(0,1fr);gap:1rem;align-items:start;margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.85rem;background:#f8faf8}
      .item-media-card figure{overflow:hidden;margin:0;border:1px solid #d4ddd8;border-radius:.7rem;background:#e8eeeb;aspect-ratio:4/3}
      .item-media-card figure img{display:block;width:100%;height:100%;object-fit:contain}
      .item-media-copy{display:grid;gap:.38rem;min-width:0}
      .item-media-copy h3,.item-media-copy p{margin:0}
      .item-media-card--compact{grid-template-columns:7rem minmax(0,1fr);margin-top:.25rem}
      .media-placeholder{display:grid;place-items:center;min-height:8rem;border:1px dashed #91a39b;border-radius:.7rem;color:#476159;background:#eef3f0}
      .item-media-actions,.media-links,.media-upload-row{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}
      .item-media-actions{margin-top:.35rem}
      .media-links a{color:#285f50;font-size:.78rem;font-weight:750}
      .media-rights,.media-notice{color:#60706a;font-size:.78rem}
      .item-media-editor{display:grid;gap:.7rem;margin-top:.55rem;padding-top:.75rem;border-top:1px solid #d4ddd8}
      .item-media-editor label:not(.media-upload){display:grid;gap:.3rem}
      .item-media-editor small{color:#60706a;font-size:.75rem}
      .media-upload{position:relative;overflow:hidden;display:inline-flex!important;align-items:center;gap:.4rem;cursor:pointer}
      .media-upload input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
      .review-media{display:grid;grid-template-columns:9rem minmax(0,1fr);gap:1rem;align-items:center;margin-top:1rem;padding:1rem;border:1px solid #d9e0dc;border-radius:.75rem;background:#fff}
      .review-media figure{overflow:hidden;margin:0;border-radius:.6rem;background:#e8eeeb;aspect-ratio:4/3}
      .review-media img{display:block;width:100%;height:100%;object-fit:contain}
      .review-media>div{display:grid;gap:.3rem}.review-media strong,.review-media p{margin:0}.review-media--empty{display:grid;grid-template-columns:1fr;gap:.25rem;color:#60706a}
      .review-texts--empty{padding:1rem;border:1px dashed #91a39b;border-radius:.75rem;background:#f8faf8;color:#60706a}.review-texts--empty h3,.review-texts--empty p{margin:0}
      .connection-empty-state{display:flex;align-items:flex-start;gap:.85rem;margin-top:1rem;padding:1rem;border:1px dashed #91a39b;border-radius:.8rem;background:#f8faf8;color:#476159}.connection-empty-state>span{display:grid;place-items:center;flex:0 0 2.6rem;height:2.6rem;border-radius:.7rem;background:#e6eeea;color:#173e35}.connection-empty-state h3,.connection-empty-state p{margin:0}.connection-empty-state p{margin-top:.25rem;color:#60706a}
      .add-connection{margin-top:1rem}.connection-editor{display:grid;gap:1rem;margin-top:1rem;padding:1rem;border:1px solid #b9c9c1;border-radius:.85rem;background:#f8faf8}.connection-editor>header h3,.connection-editor>header span,.connection-target-picker h3,.connection-target-picker p{margin:0}.connection-target-picker{display:grid;gap:.75rem;padding-bottom:1rem;border-bottom:1px solid #d4ddd8}.connection-target-picker>div{display:grid;gap:.25rem}.connection-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.6rem}.connection-target-results{display:grid;gap:.5rem}.connection-target-results article{display:grid;grid-template-columns:3rem minmax(0,1fr) auto;gap:.7rem;align-items:center;padding:.65rem;border:1px solid #d4ddd8;border-radius:.7rem;background:#fff}.connection-target-results article[data-selected="true"]{border-color:#568173;box-shadow:0 0 0 2px rgba(23,62,53,.08)}.connection-target-results img,.connection-target-placeholder{width:3rem;height:3rem;border-radius:.55rem;background:#e6eeea;object-fit:cover}.connection-target-placeholder{display:grid;place-items:center}.connection-target-results article>div,.selected-connection-target>div{display:grid;min-width:0;gap:.15rem}.connection-target-results small,.selected-connection-target small{overflow:hidden;color:#60706a;text-overflow:ellipsis;white-space:nowrap}.connection-search-empty{padding:.75rem;border-radius:.65rem;background:#fff;color:#60706a}.selected-connection-target{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.6rem;align-items:center;padding:.75rem;border-radius:.7rem;background:#e7f3ed}.selected-connection-target>span{display:grid;place-items:center;width:2rem;height:2rem;border-radius:999px;background:#173e35;color:#fff}
      .connection-relation-help{display:grid;gap:.25rem;padding:.8rem;border-left:3px solid #568173;border-radius:.2rem .65rem .65rem .2rem;background:#edf4f0}.connection-relation-help p,.connection-relation-help small{margin:0;color:#60706a}.connection-class-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.connection-class-grid:empty{display:none}.connection-advanced{padding:.75rem;border:1px dashed #91a39b;border-radius:.7rem}.connection-advanced>div{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.75rem}.connection-advanced label:last-child{grid-column:1/-1}
      .connection-list{display:grid;gap:.7rem;margin-top:1rem}.connection-list>article{display:grid;grid-template-columns:8rem minmax(0,1fr) auto;gap:.85rem;align-items:start;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#fff}.connection-direction{display:grid;justify-items:start;gap:.35rem;color:#476159}.connection-direction>span{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.65rem;background:#e6eeea;color:#173e35}.connection-copy{display:grid;min-width:0;gap:.25rem}.connection-copy h3,.connection-copy p{margin:0}.connection-copy>p{color:#60706a}.connection-meta{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.25rem}.connection-meta span{padding:.25rem .5rem;border-radius:999px;background:#edf2ef;color:#476159;font-size:.72rem;font-weight:700}.connection-note{margin-top:.4rem!important;padding:.55rem .65rem;border-radius:.55rem;background:#f7f9f8;color:#476159!important}.review-connections{display:grid;gap:.15rem;margin-top:1rem}.review-connections>header h3{margin:.15rem 0}.review-connections .connection-list{margin-top:.6rem}
      html:has(.private-success-overlay),body:has(.private-success-overlay){overflow:hidden}
      .private-success-overlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:1rem;overflow:auto;background:rgba(14,35,30,.68);backdrop-filter:blur(2px)}
      .private-success-dialog{display:grid;width:min(34rem,100%);gap:1rem;padding:1.4rem;border:1px solid #cdd8d2;border-radius:1rem;background:#fff;box-shadow:0 1.5rem 4rem rgba(6,25,20,.3);color:#173e35}
      .private-success-dialog:focus{outline:3px solid rgba(233,168,68,.55);outline-offset:3px}.private-success-dialog h2,.private-success-dialog p{margin:0}.private-success-dialog>div{display:grid;gap:.65rem}
      .private-success-icon{display:grid;place-items:center;width:3.2rem;height:3.2rem;border-radius:999px;background:#dceee5;color:#173e35}
      .private-success-actions{display:flex!important;grid-template-columns:1fr 1fr;gap:.65rem}.private-success-actions>*{justify-content:center}
      @media(max-width:48rem){.connection-list>article{grid-template-columns:1fr}.connection-direction{grid-template-columns:auto 1fr;align-items:center}.connection-target-results article{grid-template-columns:2.7rem minmax(0,1fr)}.connection-target-results article>button{grid-column:1/-1}.connection-class-grid,.connection-advanced>div{grid-template-columns:1fr}.connection-advanced label:last-child{grid-column:auto}}
      @media(max-width:40rem){.item-media-card,.item-media-card--compact,.review-media,.connection-search{grid-template-columns:1fr}.item-media-card--compact figure{max-width:10rem}.media-upload-row{align-items:stretch;flex-direction:column}}
      @media(max-width:32rem){.representation-summary{grid-template-columns:1fr 1fr}.representation-summary>div:last-child{grid-column:1/-1}.representation-compact-actions{justify-content:flex-start}.representation-editor--collapsed>header{display:grid}.private-success-actions{align-items:stretch;flex-direction:column}.private-success-actions>*{width:100%}}
    </style>`;
  }

  styles() {
    return `<style>:host{display:block}.authoring-page{display:grid;gap:1rem;max-width:68rem;margin:auto;padding:2rem 1rem 5rem}.authoring-progress ol{display:grid;grid-template-columns:repeat(5,minmax(7rem,1fr));gap:.55rem;min-width:35rem;margin:0;padding:0;list-style:none}.authoring-progress__summary{display:none}.authoring-progress button{display:flex;width:100%;align-items:center;gap:.5rem;padding:.65rem;border:1px solid #ccd6d1;border-radius:.7rem;background:#fff;color:#173e35}.authoring-progress button:hover:not(:disabled){background:#edf2ef;color:#173e35}.authoring-progress li[data-current=true] button{border-color:#173e35;background:#173e35;color:#fff}.authoring-progress li[data-current=true] button:hover:not(:disabled){background:#245448;color:#fff}.authoring-progress li[data-complete=true]:not([data-current=true]) button{border-color:#91a39b;background:#f1f6f3;color:#173e35}.authoring-progress button>span{display:grid;place-items:center;flex:0 0 1.7rem;height:1.7rem;border-radius:999px;background:#edf2ef;color:#173e35}.authoring-progress li[data-current=true] button>span{background:#fff;color:#173e35}.authoring-progress li[data-complete=true]:not([data-current=true]) button>span{background:#173e35;color:#fff}.authoring-progress button:disabled{color:#536760;opacity:.72}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem}.step-number{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:999px;background:#173e35;color:white}.editor-form{display:grid;gap:.9rem;max-width:52rem;margin-top:1rem}.rules-choice{max-width:52rem;margin-top:1rem}.selection-summary{display:grid;gap:.3rem}.selection-summary small{color:#60706a}.representation-list{display:grid;gap:1rem}.representation-editor{display:grid;gap:.9rem;padding:1rem;border:1px solid #ccd6d1;border-radius:.8rem;background:#fbfcfb}.representation-editor>header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.representation-editor h3{margin:.2rem 0 0}.representation-settings{display:grid;grid-template-columns:1fr 1fr minmax(8rem,.65fr);gap:.8rem}.add-text{justify-self:start}.step-actions,.workflow-actions{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.subject-summary,.context-box,.selection-summary,.readiness,.issue-panel,.workflow-panel{margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#f8faf8}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-top:1rem}.review-grid article{display:grid;gap:.35rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.75rem;background:#f8faf8}.review-grid article span{color:#60706a;font-size:.9rem}.review-texts{display:grid;gap:.75rem;margin-top:1rem}.review-texts>header h3{margin:.2rem 0}.review-texts>div{display:grid;gap:.75rem}.review-texts article{display:grid;gap:.65rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.75rem}.review-texts article header{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.review-texts article header span{color:#60706a}.review-texts article p{margin:0;white-space:pre-wrap}.membership-fieldset,.technical-details{margin-top:1rem;padding:.75rem;border:1px dashed #91a39b;border-radius:.7rem}.membership-grid{display:grid;gap:.65rem}.membership{display:grid;grid-template-columns:auto 1fr;gap:.5rem}.membership span{display:grid;gap:.2rem}.edition-tabs{display:flex;gap:.5rem;flex-wrap:wrap}.note{color:#60706a}@media(max-width:48rem){.authoring-progress ol{grid-template-columns:repeat(5,minmax(0,1fr));min-width:0}.authoring-progress button strong{font-size:.62rem}.representation-settings,.review-grid{grid-template-columns:1fr}}@media(max-width:32rem){.authoring-progress__summary{display:grid;gap:.1rem}.authoring-progress button strong{display:none}.step-actions>*{width:100%}.representation-editor>header{display:grid}.remove-text{justify-self:start}}</style>`;
  }
}
customElements.define("artaround-item-authoring-view", ItemAuthoringView);
