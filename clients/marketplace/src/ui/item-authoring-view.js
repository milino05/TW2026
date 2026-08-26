import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
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

function projectedRevisionToWrite(revision) {
  return {
    label: revision.label,
    relatedSubjectIds: (revision.relatedSubjects || []).map((entry) => entry.id).filter(Boolean),
    tags: revision.tags || [],
    authorCredits: revision.authorCredits || [],
    metadata: { license: revision.license || null },
    illustrativeMedia: (revision.illustrativeMedia || []).map((entry) => ({ _id: entry.id, url: entry.url, altText: entry.altText || null })),
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

function workflowNotice(code) {
  const messages = {
    "workflow.check": "Controllo completato.",
    "workflow.request_review": "Contenuto inviato in revisione.",
    "workflow.withdraw_review": "Contenuto ritirato dalla revisione.",
    "workflow.request_changes": "Richiesta di modifiche inviata.",
    "workflow.publish": "Contenuto pubblicato.",
  };
  return messages[code] || "Operazione editoriale completata.";
}
function workflowLabel(operation) {
  const labels = {
    "workflow.check": "Controlla se è tutto pronto",
    "workflow.request_review": "Invia in revisione",
    "workflow.withdraw_review": "Ritira dalla revisione",
    "workflow.request_changes": "Richiedi modifiche",
    "workflow.publish": operation?.label === "Approva e pubblica" ? "Approva e pubblica" : "Pubblica",
  };
  return labels[operation?.code] || operation?.label || "Continua";
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
function newDraft(author = "") {
  return { namespaceId: "", label: "", author: String(author || "").trim(), license: "", representations: [newRepresentation()] };
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
  activeStep = 1;
  activeRepresentationIndex = 0;
  newEditionMode = false;
  draft = newDraft();
  busy = false;
  error = null;
  notice = null;

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
  workflowOperations() { return (this.projection?.availableOperations || []).filter((operation) => isWorkflowOperation(operation.code)); }
  selectedRevision() { return this.projection?.selected?.revision || null; }
  selectedEdition() { return this.projection?.selected?.edition || null; }
  selectedNamespace() { return this.projection?.selected?.namespace || null; }
  firstVariant() { return this.selectedRevision()?.presentationVariants?.[0] || null; }
  firstRepresentation() { return this.firstVariant()?.representations?.[0] || null; }
  defaultAuthor() { return String(this.workspace?.principal?.name || this.context?.name || "").trim(); }

  async bootstrap() {
    this.busy = true; this.error = null; this.render();
    try {
      await this.reloadAuthoringContext();
      if (this.venueTargetId) {
        this.venueTargetContext = await authoringRepository.venueTargetContext(this.venueTargetId);
        this.selectedSubject = this.venueTargetContext.subject;
      }
      if (this.itemId) {
        await this.reloadProjection();
        this.activeStep = this.selectedRevision() ? 3 : 2;
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
      representations: representations.length ? representations : [newRepresentation()],
    };
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
    return (this.preflight?.content?.usableNamespaces || []).filter((entry) => !used.has(id(entry.id))).map((entry) => ({ id: id(entry.id), name: entry.name, ownership: entry.source }));
  }

  async prepareNewEdition() {
    if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
    this.newEditionMode = true; this.namespaceControls = null; this.draft = newDraft(this.defaultAuthor()); this.activeRepresentationIndex = 0;
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (choices.length === 1) await this.selectNamespace(choices[0].id);
    this.activeStep = 2;
  }

  async selectNamespace(namespaceId) {
    this.draft.namespaceId = String(namespaceId || ""); this.namespaceControls = null;
    if (!this.draft.namespaceId) return;
    this.namespaceControls = await authoringRepository.namespaceControls(this.draft.namespaceId, this.principal);
    const durationIds = new Set((this.namespaceControls?.controls?.durationTypes || []).map((entry) => entry.definitionId));
    const languageIds = new Set((this.namespaceControls?.controls?.languageLevels || []).map((entry) => entry.definitionId));
    for (const representation of this.draft.representations) {
      if (!durationIds.has(representation.durationTypeDefinitionId)) representation.durationTypeDefinitionId = "";
      if (!languageIds.has(representation.languageLevelDefinitionId)) representation.languageLevelDefinitionId = "";
    }
  }

  updateDraftField(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
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
    const namespaceSelect = target.closest("select[data-namespace-select]");
    if (namespaceSelect) {
      this.busy = true; this.error = null; this.render();
      try { await this.selectNamespace(namespaceSelect.value); }
      catch (error) { this.error = error instanceof Error ? error.message : "Regole editoriali non disponibili"; }
      finally { this.busy = false; this.render(); }
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
      if (form.matches("[data-create-item]")) {
        if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
        if (!this.selectedSubject) throw new Error("Scegli prima di cosa deve parlare il contenuto");
        const item = await authoringRepository.createItem({ primarySubjectId: this.selectedSubject.id || this.selectedSubject._id, ownerType: this.principal.type, ownerId: this.principal.id });
        this.itemId = item._id || item.id;
        const url = new URL(window.location.href); url.search = ""; url.searchParams.set("itemId", this.itemId); window.history.replaceState({}, "", url);
        await this.reloadProjection(); await this.prepareNewEdition();
        this.notice = "Soggetto confermato. Ora scrivi il contenuto.";
      } else if (form.matches("[data-content-draft]")) {
        for (const field of form.querySelectorAll("input, textarea, select")) this.updateDraftField(field);
        for (const key of ["label", "license"]) this.draft[key] = String(this.draft[key] || "").trim();
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
        const operationCode = String(data.get("operationCode") || ""); const operation = this.availableOperation(operationCode);
        if (!operation || !isWorkflowOperation(operationCode)) throw new Error("Operazione editoriale non disponibile");
        const message = operation.requiresMessage ? String(data.get("message") || "").trim() : "";
        if (operation.requiresMessage && !message) throw new Error("Scrivi la motivazione delle modifiche richieste");
        await this.executeWorkflow(operationCode, message);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; }
    finally { this.busy = false; this.render(); }
  };

  async createEditionFromDraft() {
    const controls = this.namespaceControls;
    if (!controls || id(controls.namespace.id) !== this.draft.namespaceId) throw new Error("Le regole editoriali selezionate non sono state caricate");
    const created = await authoringRepository.createEdition(this.itemId, {
      namespaceId: this.draft.namespaceId,
      authoredAgainstNamespaceRevisionId: controls.revision.id,
      revision: {
        label: this.draft.label, authorCredits: [this.draft.author].filter(Boolean), metadata: { license: this.draft.license }, relatedSubjectIds: [], tags: [], illustrativeMedia: [], selectionSignals: [],
        presentationVariants: [{ key: "standard", label: "Standard", semanticFocus: [], presentationAspects: [], knowledgeRequirements: [], representations: this.draft.representations.map((entry) => ({ durationTypeDefinitionId: entry.durationTypeDefinitionId, languageLevelDefinitionId: entry.languageLevelDefinitionId, locale: entry.locale, text: entry.text })) }],
        defaultPresentation: null,
      },
    });
    const variant = created.revision?.presentationVariants?.[0]; const representation = variant?.representations?.[0];
    if (variant?._id && representation?._id) await authoringRepository.updateEdition(created.edition._id, { defaultPresentation: { variantId: variant._id, representationId: representation._id } });
    this.newEditionMode = false; this.namespaceControls = null; await this.reloadProjection(created.edition._id); await this.reloadAuthoringContext(); this.activeStep = 3;
    this.notice = "Bozza salvata. Controlla il riepilogo prima della pubblicazione.";
  }

  async updateEditionFromDraft() {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision(); const editionId = id(this.selectedEdition()?.id); if (!revision || !editionId) throw new Error("Nessuna versione modificabile");
    const payload = projectedRevisionToWrite(revision);
    payload.label = this.draft.label; payload.authorCredits = [this.draft.author].filter(Boolean); payload.metadata = { license: this.draft.license };
    const variant = payload.presentationVariants?.[0]; if (!variant) throw new Error("La struttura dei testi non è disponibile");
    variant.representations = this.draft.representations.map((entry) => ({
      ...(entry.id ? { _id: entry.id } : {}),
      durationTypeDefinitionId: entry.durationTypeDefinitionId,
      languageLevelDefinitionId: entry.languageLevelDefinitionId,
      locale: entry.locale,
      text: entry.text,
    }));
    const result = await authoringRepository.updateEdition(editionId, payload);
    await this.ensureDefaultRepresentation(editionId, result.revision);
    await this.reloadProjection(editionId); this.activeStep = 3;
    this.notice = "Modifiche salvate. Il controllo di consistenza va rieseguito prima della pubblicazione.";
  }

  async ensureDefaultRepresentation(editionId, revision) {
    const variant = revision?.presentationVariants?.[0]; const representation = variant?.representations?.[0];
    const variantId = id(variant); const representationId = id(representation);
    if (!variantId || !representationId) return;
    const current = revision.defaultPresentation;
    const currentVariant = (revision.presentationVariants || []).find((entry) => id(entry._id || entry.id) === id(current?.variantId));
    const currentStillExists = currentVariant?.representations?.some((entry) => id(entry._id || entry.id) === id(current?.representationId));
    if (currentStillExists) return;
    await authoringRepository.updateEdition(editionId, { defaultPresentation: { variantId, representationId } });
  }

  async executeWorkflow(operationCode, message = "") {
    const editionId = id(this.selectedEdition()?.id); if (!editionId) throw new Error("Versione editoriale non disponibile");
    const result = await marketplaceRepository.executeWorkspaceOperation({ operationCode, sourceRef: { resourceType: "item_edition", resourceId: editionId }, targetPrincipal: { type: this.principal.type, id: this.principal.id }, payload: message ? { message } : {} });
    await this.reloadProjection(editionId); this.activeStep = 3;
    if (operationCode === "workflow.check") { const issues = result?.result?.issues || []; this.notice = issues.length ? `Controllo completato: ${issues.length} problema/i da risolvere.` : "Controllo completato: il contenuto è pronto per il passaggio successivo."; }
    else this.notice = workflowNotice(operationCode);
  }

  onSubjectSelected = (event) => {
    if (this.itemId || !event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.notice = event.detail.source === "reuse_existing" ? "Identità già presente: è stato riutilizzato il soggetto ArtAround esistente." : "Soggetto selezionato. Puoi continuare.";
    this.render();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const addTextButton = target.closest("button[data-add-text]");
    if (addTextButton) { this.draft.representations.push(newRepresentation()); this.activeRepresentationIndex = this.draft.representations.length - 1; this.error = null; this.render(); requestAnimationFrame(() => this.querySelector(`[data-representation-index="${this.activeRepresentationIndex}"] textarea`)?.focus()); return; }
    const removeTextButton = target.closest("button[data-remove-text]");
    if (removeTextButton) { const index = Number(removeTextButton.dataset.removeText); if (this.draft.representations.length > 1 && this.draft.representations[index]) { this.draft.representations.splice(index, 1); if (this.activeRepresentationIndex === index) this.activeRepresentationIndex = Math.min(index, this.draft.representations.length - 1); else if (this.activeRepresentationIndex > index) this.activeRepresentationIndex -= 1; this.notice = "Testo rimosso dalla bozza. Salva il contenuto per confermare la modifica."; this.render(); } return; }
    const collapsedText = target.closest("[data-collapsed-text]");
    if (collapsedText) { const index = Number(collapsedText.dataset.collapsedText); if (this.draft.representations[index]) { this.activeRepresentationIndex = index; this.error = null; this.render(); requestAnimationFrame(() => this.querySelector(`[data-representation-index="${index}"]`)?.focus({ preventScroll: true })); } return; }
    const stepButton = target.closest("button[data-step]"); if (stepButton) { const step = Number(stepButton.dataset.step); if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.render(); } return; }
    const backButton = target.closest("button[data-back-step]"); if (backButton) { const step = Math.max(1, Number(backButton.dataset.backStep) || 1); if (this.canOpenStep(step)) { this.activeStep = step; this.render(); } return; }
    const newEditionButton = target.closest("button[data-new-edition]");
    if (newEditionButton) { this.busy = true; this.error = null; this.render(); try { await this.prepareNewEdition(); } catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aggiungere una nuova versione editoriale"; } finally { this.busy = false; this.render(); } return; }
    const editButton = target.closest("button[data-edit-content]"); if (editButton) { this.newEditionMode = false; this.hydrateDraftFromProjection(); this.activeRepresentationIndex = 0; this.activeStep = 2; this.render(); return; }
    const editionButton = target.closest("button[data-edition-id]");
    if (editionButton) { this.busy = true; this.error = null; this.render(); try { this.newEditionMode = false; this.namespaceControls = null; await this.reloadProjection(editionButton.dataset.editionId); this.activeStep = 3; } catch (error) { this.error = error instanceof Error ? error.message : "Impossibile aprire la versione editoriale"; } finally { this.busy = false; this.render(); } }
  };

  remediationHref() {
    const configurable = this.preflight?.content?.needsConfiguration?.[0];
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.context?.type === "organization" && this.context?.id) return `/organizations/detail?organizationId=${encodeURIComponent(id(this.context.id))}&section=rules`;
    return "/profile#account-rules";
  }

  contentDraftReady() {
    const fieldsReady = [this.draft.label, this.draft.author, this.draft.license]
      .every((value) => String(value || "").trim());
    const rulesReady = !this.newEditionMode || Boolean(this.draft.namespaceId && this.namespaceControls);
    const textsReady = this.draft.representations.length > 0 && this.draft.representations.every((entry) => [entry.durationTypeDefinitionId, entry.languageLevelDefinitionId, entry.locale, entry.text].every((value) => String(value || "").trim()));
    return Boolean(fieldsReady && rulesReady && textsReady);
  }
  canOpenStep(step) {
    if (step === 1) return true;
    if (step === 2) return Boolean(this.itemId);
    if (step === 3) return Boolean(this.selectedRevision() && !this.newEditionMode);
    return false;
  }

  renderProgress() {
    const stages = [[1, "Di cosa parla"], [2, "Testi e impostazioni"], [3, "Controllo e pubblicazione"]];
    const currentLabel = stages.find(([step]) => step === this.activeStep)?.[1] || stages[0][1];
    return `<nav class="authoring-progress" aria-label="Passaggi di creazione"><div class="authoring-progress__summary"><span>Passaggio ${this.activeStep} di ${stages.length}</span><strong>${escapeHtml(currentLabel)}</strong></div><ol>${stages.map(([step, label]) => { const enabled = this.canOpenStep(step); const current = this.activeStep === step; const complete = step === 1 ? Boolean(this.itemId) : step === 2 ? Boolean(this.selectedRevision() && !this.newEditionMode) : this.selectedRevision()?.status === "published"; return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${enabled ? "" : "disabled"} aria-current="${current ? "step" : "false"}" aria-label="Passaggio ${step}: ${escapeHtml(label)}"><span>${complete ? icon("check", { size: 14 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`; }).join("")}</ol></nav>`;
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

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    const venue = this.venueTargetContext;
    const physicalContext = venue ? `<aside class="context-box"><span class="eyebrow">Oggetto della sede</span><strong>${escapeHtml(venue.venueTarget.label)}</strong><p>${escapeHtml(venue.venue.name)}${venue.venueTarget.description ? ` · ${escapeHtml(venue.venueTarget.description)}` : ""}</p><p class="note">L'oggetto serve a precompilare il soggetto. Il contenuto resta editoriale e non incorpora la posizione fisica.</p>${(venue.recognitionMedia || []).length ? `<details class="technical-details"><summary>Riconoscimento fisico</summary><p>${venue.recognitionMedia.length} immagine/i restano nella configurazione della sede, separate dal contenuto editoriale.</p></details>` : ""}</aside>` : "";
    if (this.itemId) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Soggetto confermato</h2><p>Il soggetto identifica in modo univoco ciò di cui parla il contenuto.</p></div></header>${physicalContext}${this.renderSubjectSummary()}<div class="step-actions"><button type="button" data-step="2">Continua al contenuto ${icon("chevron", { size: 15 })}</button></div></section>`;
    const subjectSelection = this.selectedSubject
      ? `${this.renderSubjectSummary()}<form data-create-item class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>${icon("check", { size: 16 })} Soggetto selezionato · Continua ${icon("chevron", { size: 15 })}</button></form>`
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
    const durationOptions = (selected = "") => [
      `<option value="">Scegli la durata</option>`,
      ...(controls.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)} · ${entry.targetSeconds}s</option>`),
    ].join("");
    const languageOptions = (selected = "") => [
      `<option value="">Scegli il livello</option>`,
      ...(controls.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`),
    ].join("");
    this.activeRepresentationIndex = Math.min(Math.max(0, this.activeRepresentationIndex), this.draft.representations.length - 1);
    return `<div class="representation-list">${this.draft.representations.map((representation, index) => {
      const active = index === this.activeRepresentationIndex;
      const title = index === 0 ? "Prima versione del testo" : "Versione aggiuntiva";
      const duration = (controls.durationTypes || []).find((entry) => entry.definitionId === representation.durationTypeDefinitionId);
      const language = (controls.languageLevels || []).find((entry) => entry.definitionId === representation.languageLevelDefinitionId);
      const durationLabel = duration ? `${duration.label}${Number.isFinite(Number(duration.targetSeconds)) ? ` · ${duration.targetSeconds}s` : ""}` : "Da scegliere";
      const languageLabel = language?.label || "Da scegliere";
      const localeLabel = representation.locale || "Da indicare";
      const removeButton = this.draft.representations.length > 1 ? `<button class="button-secondary remove-text" type="button" data-remove-text="${index}" aria-label="Rimuovi il testo ${index + 1}">${icon("trash", { size: 15 })} Rimuovi</button>` : "";
      if (!active) return `<article class="representation-editor representation-editor--collapsed" data-representation-index="${index}" data-collapsed-text="${index}"><header><div><span class="eyebrow">${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</span><h3>${title}</h3></div><div class="representation-compact-actions"><button class="button-secondary select-text" type="button" data-select-text="${index}" aria-expanded="false">${icon("edit", { size: 15 })} Modifica</button>${removeButton}</div></header><dl class="representation-summary"><div><dt>Durata</dt><dd>${escapeHtml(durationLabel)}</dd></div><div><dt>Livello di linguaggio</dt><dd>${escapeHtml(languageLabel)}</dd></div><div><dt>Lingua</dt><dd>${escapeHtml(localeLabel)}</dd></div></dl></article>`;
      return `<article class="representation-editor" data-representation-index="${index}" data-selected="true" tabindex="-1"><header><div><span class="eyebrow">${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</span><h3>${title}</h3></div>${removeButton}</header><div class="representation-settings"><label>Durata<select name="durationTypeDefinitionId" data-representation-index="${index}" required>${durationOptions(representation.durationTypeDefinitionId)}</select></label><label>Livello di linguaggio<select name="languageLevelDefinitionId" data-representation-index="${index}" required>${languageOptions(representation.languageLevelDefinitionId)}</select></label><label>Lingua<input name="locale" data-representation-index="${index}" required value="${escapeHtml(representation.locale)}" placeholder="es. it-IT"></label></div><label>Testo<textarea name="text" data-representation-index="${index}" rows="8" required>${escapeHtml(representation.text)}</textarea></label></article>`;
    }).join("")}</div>`;
  }

  renderStepTwo() {
    if (this.activeStep !== 2 || !this.itemId) return "";
    const controls = this.personalizationControls();
    const namespaceName = this.newEditionMode ? this.namespaceControls?.namespace?.name : this.selectedNamespace()?.name;
    const namespaceChoice = this.newEditionMode
      ? this.renderNamespaceSelector()
      : `<div class="selection-summary"><span>Regole editoriali</span><strong>${escapeHtml(namespaceName || "Non disponibili")}</strong><small>Queste regole determinano le durate e i livelli di linguaggio disponibili.</small></div>`;
    const heading = `<header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Testi e impostazioni</span><h2>Configura e scrivi il contenuto</h2><p>Scegli le regole editoriali e, per ogni testo, indica durata, livello di linguaggio e lingua.</p></div></header>`;
    if (!controls) return `<section class="wizard-step panel">${heading}<div class="rules-choice">${namespaceChoice}</div><p class="note">Scegli le regole editoriali per vedere le durate e i livelli disponibili.</p><div class="step-actions"><button class="button-secondary" type="button" data-back-step="1">Indietro</button></div></section>`;
    const creditedTo = this.draft.author || this.defaultAuthor();
    return `<section class="wizard-step panel">${heading}<div class="rules-choice">${namespaceChoice}</div><form data-content-draft class="editor-form"><label>Titolo del contenuto<input name="label" required value="${escapeHtml(this.draft.label)}"></label><label>Licenza<input name="license" required value="${escapeHtml(this.draft.license)}"></label><p class="note author-credit">Autore assegnato automaticamente: <strong>${escapeHtml(creditedTo)}</strong>, proprietario di questa area di lavoro.</p>${this.renderRepresentationEditors(controls)}<button class="button-secondary add-text" type="button" data-add-text>${icon("plus", { size: 15 })} Aggiungi un altro testo</button><div class="step-actions"><button class="button-secondary" type="button" data-back-step="1">Indietro</button><button type="submit">${this.newEditionMode ? "Salva e vai al controllo" : "Salva modifiche"} ${icon("chevron", { size: 15 })}</button></div></form>${this.renderMemberships()}${this.renderTechnicalPresentation()}</section>`;
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
    if (!representations.length) return "";
    return `<section class="review-texts"><header><span class="eyebrow">Testi</span><h3>Durata e livello di linguaggio</h3></header><div>${representations.map((representation, index) => `<article><header><strong>${index === 0 ? "Testo principale" : `Testo ${index + 1}`}</strong><span>${escapeHtml(representation.duration?.label || "Durata non indicata")} · ${escapeHtml(representation.languageComplexity?.label || "Livello non indicato")} · ${escapeHtml(representation.locale || "Lingua non indicata")}</span></header><p>${escapeHtml(representation.text || "-")}</p></article>`).join("")}</div></section>`;
  }
  renderWorkflowOperation(operation) {
    if (operation.requiresMessage) return `<form data-workflow-form class="workflow-message-form"><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><label>Motivazione<textarea name="message" rows="3" required></textarea></label><button class="button-secondary" type="submit">${escapeHtml(workflowLabel(operation))}</button></form>`;
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit">${operation.code === "workflow.check" ? icon("check", { size: 15 }) : ""}${escapeHtml(workflowLabel(operation))}</button></form>`;
  }
  renderStepThree() {
    if (this.activeStep !== 3 || !this.selectedRevision() || this.newEditionMode) return "";
    const revision = this.selectedRevision(); const integrity = revision.integrity?.status || "needs_review"; const issues = revision.integrity?.issues || []; const operations = this.workflowOperations(); const published = revision.status === "published"; const editAllowed = Boolean(this.availableOperation("item.edit"));
    const statePanel = published ? `<div class="readiness success"><strong>Versione pubblicata</strong><p>La pubblicazione nel Catalogo è un passaggio commerciale separato.</p></div>` : integrity === "valid" ? `<div class="readiness success"><strong>Controllo superato</strong></div>` : `<div class="readiness warning"><strong>Serve un controllo</strong></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Controllo e pubblicazione</span><h2>Verifica prima di pubblicare</h2></div></header>${this.reviewSummary()}${this.renderReviewTexts()}${statePanel}${issues.length ? `<div class="issue-panel"><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul></div>` : ""}<div class="workflow-panel"><h3>Azioni disponibili</h3><p class="note">La pubblicazione editoriale non crea automaticamente una scheda nel Marketplace.</p><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("")}</div></div><div class="step-actions">${editAllowed ? `<button class="button-secondary" type="button" data-edit-content>${icon("edit", { size: 15 })} Modifica contenuto</button>` : ""}${this.availableOperation("item.create_edition") && this.preflight?.content?.allowed && this.usableNamespaceChoices({ excludeUsed: true }).length ? `<button class="button-secondary" type="button" data-new-edition>${icon("plus", { size: 15 })} Aggiungi versione editoriale</button>` : ""}</div>${this.renderTechnicalPresentation()}</section>`;
  }
  renderEditions() {
    const editions = this.projection?.editions || []; if (editions.length <= 1 && !this.newEditionMode) return "";
    return `<nav class="edition-tabs" aria-label="Versioni editoriali del contenuto">${editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}" aria-pressed="${!this.newEditionMode && id(this.selectedEdition()?.id) === id(edition.id)}">${escapeHtml(edition.namespace?.name || "Versione")}</button>`).join("")}${this.newEditionMode ? `<span class="status">Nuova bozza</span>` : ""}</nav>`;
  }

  render() {
    const blocked = !this.itemId && this.preflight?.content?.allowed === false;
    this.innerHTML = `${this.styles()}${this.representationStyles()}<main class="page authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><a data-route href="${this.itemId ? "/workspace" : "/create"}">${icon("arrowLeft", { size: 15 })} ${this.itemId ? "Libreria" : "Crea"}</a><span>/</span><span>Contenuto</span></nav><header class="page-header"><div><span class="eyebrow">Crea contenuto</span><h1>${this.itemId ? "Contenuto" : "Nuovo contenuto"}</h1><p>Tre passaggi: identifica il soggetto, configura e scrivi i testi, quindi controlla il risultato prima della pubblicazione.</p></div></header>${!blocked ? this.renderProgress() : ""}${this.busy ? `<p role="status">Aggiornamento in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.notice)}</p>` : ""}${this.renderPrerequisiteBlocker()}${this.renderEditions()}${blocked ? "" : `${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}`}</main>`;
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
      .representation-compact-actions{display:flex;align-items:center;justify-content:flex-end;gap:.5rem;flex-wrap:wrap}
      .representation-compact-actions button{min-height:2.3rem;padding:.45rem .65rem}
      .representation-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;margin:0}
      .representation-summary>div{display:grid;min-width:0;gap:.1rem;padding:.55rem .65rem;border-radius:.55rem;background:#fff}
      .representation-summary dt{color:#60706a;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.04em}
      .representation-summary dd{overflow:hidden;margin:0;color:#173e35;font-weight:750;text-overflow:ellipsis;white-space:nowrap}
      @media(max-width:32rem){.representation-summary{grid-template-columns:1fr 1fr}.representation-summary>div:last-child{grid-column:1/-1}.representation-compact-actions{justify-content:flex-start}.representation-editor--collapsed>header{display:grid}}
    </style>`;
  }

  styles() {
    return `<style>:host{display:block}.authoring-page{display:grid;gap:1rem;max-width:68rem;margin:auto;padding:2rem 1rem 5rem}.authoring-progress ol{display:grid;grid-template-columns:repeat(3,minmax(9rem,1fr));gap:.55rem;min-width:32rem;margin:0;padding:0;list-style:none}.authoring-progress__summary{display:none}.authoring-progress button{display:flex;width:100%;align-items:center;gap:.5rem;padding:.65rem;border:1px solid #ccd6d1;border-radius:.7rem;background:#fff;color:#173e35}.authoring-progress button:hover:not(:disabled){background:#edf2ef;color:#173e35}.authoring-progress li[data-current=true] button{border-color:#173e35;background:#173e35;color:#fff}.authoring-progress li[data-current=true] button:hover:not(:disabled){background:#245448;color:#fff}.authoring-progress li[data-complete=true]:not([data-current=true]) button{border-color:#91a39b;background:#f1f6f3;color:#173e35}.authoring-progress button>span{display:grid;place-items:center;flex:0 0 1.7rem;height:1.7rem;border-radius:999px;background:#edf2ef;color:#173e35}.authoring-progress li[data-current=true] button>span{background:#fff;color:#173e35}.authoring-progress li[data-complete=true]:not([data-current=true]) button>span{background:#173e35;color:#fff}.authoring-progress button:disabled{color:#536760;opacity:.72}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem}.step-number{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:999px;background:#173e35;color:white}.editor-form{display:grid;gap:.9rem;max-width:52rem;margin-top:1rem}.rules-choice{max-width:52rem;margin-top:1rem}.selection-summary{display:grid;gap:.3rem}.selection-summary small{color:#60706a}.representation-list{display:grid;gap:1rem}.representation-editor{display:grid;gap:.9rem;padding:1rem;border:1px solid #ccd6d1;border-radius:.8rem;background:#fbfcfb}.representation-editor>header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.representation-editor h3{margin:.2rem 0 0}.representation-settings{display:grid;grid-template-columns:1fr 1fr minmax(8rem,.65fr);gap:.8rem}.add-text{justify-self:start}.step-actions,.workflow-actions{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.subject-summary,.context-box,.selection-summary,.readiness,.issue-panel,.workflow-panel{margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#f8faf8}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-top:1rem}.review-grid article{display:grid;gap:.35rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.75rem;background:#f8faf8}.review-grid article span{color:#60706a;font-size:.9rem}.review-texts{display:grid;gap:.75rem;margin-top:1rem}.review-texts>header h3{margin:.2rem 0}.review-texts>div{display:grid;gap:.75rem}.review-texts article{display:grid;gap:.65rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.75rem}.review-texts article header{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.review-texts article header span{color:#60706a}.review-texts article p{margin:0;white-space:pre-wrap}.membership-fieldset,.technical-details{margin-top:1rem;padding:.75rem;border:1px dashed #91a39b;border-radius:.7rem}.membership-grid{display:grid;gap:.65rem}.membership{display:grid;grid-template-columns:auto 1fr;gap:.5rem}.membership span{display:grid;gap:.2rem}.edition-tabs{display:flex;gap:.5rem;flex-wrap:wrap}.note{color:#60706a}@media(max-width:48rem){.authoring-progress ol{grid-template-columns:repeat(3,minmax(0,1fr));min-width:0}.authoring-progress button strong{font-size:.72rem}.representation-settings,.review-grid{grid-template-columns:1fr}}@media(max-width:32rem){.authoring-progress__summary{display:grid;gap:.1rem}.authoring-progress button strong{display:none}.step-actions>*{width:100%}.representation-editor>header{display:grid}.remove-text{justify-self:start}}</style>`;
  }
}
customElements.define("artaround-item-authoring-view", ItemAuthoringView);
