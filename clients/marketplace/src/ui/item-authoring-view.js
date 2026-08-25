import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
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
function parseTags(value) { return [...new Set(String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean))]; }

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
      knowledgeRequirements: (variant.knowledgeRequirements || []).map((entry) => ({
        subjectId: entry.subject?.id,
        minLevel: entry.minLevel,
        maxLevel: entry.maxLevel,
        weight: entry.weight,
      })).filter((entry) => entry.subjectId),
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

function newDraft() {
  return {
    namespaceId: "",
    label: "",
    author: "",
    license: "",
    text: "",
    tags: "",
    durationTypeDefinitionId: "",
    languageLevelDefinitionId: "",
    locale: "it-IT",
  };
}

export class ItemAuthoringView extends HTMLElement {
  workspace = null;
  preflight = null;
  principal = { type: params().get("principalType") || "user", id: params().get("principalId") || null };
  selectedSubject = null;
  itemId = params().get("itemId") || null;
  venueTargetId = params().get("venueTargetId") || null;
  venueTargetContext = null;
  projection = null;
  namespaceControls = null;
  activeStep = 1;
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
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.bootstrap();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

  availableOperation(code) {
    return (this.projection?.availableOperations || []).find((operation) => operation.code === code) || null;
  }

  workflowOperations() {
    return (this.projection?.availableOperations || []).filter((operation) => isWorkflowOperation(operation.code));
  }

  selectedRevision() { return this.projection?.selected?.revision || null; }
  selectedEdition() { return this.projection?.selected?.edition || null; }
  selectedNamespace() { return this.projection?.selected?.namespace || null; }
  firstVariant() { return this.selectedRevision()?.presentationVariants?.[0] || null; }
  firstRepresentation() { return this.firstVariant()?.representations?.[0] || null; }

  async bootstrap() {
    this.busy = true;
    this.render();
    try {
      await this.reloadAuthoringContext();
      if (this.venueTargetId) {
        this.venueTargetContext = await authoringRepository.venueTargetContext(this.venueTargetId);
        this.selectedSubject = this.venueTargetContext.subject;
      }
      if (this.itemId) {
        await this.reloadProjection();
        this.activeStep = this.selectedRevision() ? 4 : 2;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Impossibile inizializzare l'editor";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async reloadAuthoringContext() {
    const requested = { principalType: this.principal?.type || "user", principalId: this.principal?.id || null };
    const [workspace, preflight] = await Promise.all([
      marketplaceRepository.workspaceContext(requested),
      marketplaceRepository.authoringPreflight(requested),
    ]);
    this.workspace = workspace;
    this.preflight = preflight;
    this.principal = { type: workspace.principal.type, id: workspace.principal.id };
  }

  hydrateDraftFromProjection() {
    if (this.newEditionMode) return;
    const revision = this.selectedRevision();
    if (!revision) return;
    const first = this.firstRepresentation();
    this.draft = {
      namespaceId: id(this.selectedNamespace()?.id),
      label: revision.label || "",
      author: revision.authorCredits?.[0] || "",
      license: revision.license || "",
      text: first?.text || "",
      tags: (revision.tags || []).join(", "),
      durationTypeDefinitionId: first?.duration?.definitionId || "",
      languageLevelDefinitionId: first?.languageComplexity?.definitionId || "",
      locale: first?.locale || "it-IT",
    };
  }

  async reloadProjection(editionId = null) {
    if (!this.itemId) return;
    this.projection = await authoringRepository.projection(this.itemId, { editionId });
    this.selectedSubject = this.projection.subject;
    const owner = this.projection.lineage?.owner;
    if (owner && (!this.principal || owner.type !== this.principal.type || id(owner.id) !== id(this.principal.id))) {
      this.principal = { type: owner.type, id: owner.id };
      await this.reloadAuthoringContext();
      this.namespaceControls = null;
    }
    this.hydrateDraftFromProjection();
  }

  usableNamespaceChoices({ excludeUsed = false } = {}) {
    const used = new Set(
      excludeUsed
        ? (this.projection?.editions || []).map((edition) => id(edition.namespace?.id)).filter(Boolean)
        : [],
    );
    return (this.preflight?.content?.usableNamespaces || [])
      .filter((entry) => !used.has(id(entry.id)))
      .map((entry) => ({ id: id(entry.id), name: entry.name, ownership: entry.source }));
  }

  async prepareNewEdition() {
    if (!this.preflight?.content?.allowed) {
      throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
    }
    this.newEditionMode = true;
    this.namespaceControls = null;
    this.draft = newDraft();
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (choices.length === 1) await this.selectNamespace(choices[0].id);
    this.activeStep = 2;
  }

  async selectNamespace(namespaceId) {
    this.draft.namespaceId = String(namespaceId || "");
    this.namespaceControls = null;
    if (!this.draft.namespaceId) return;
    this.namespaceControls = await authoringRepository.namespaceControls(this.draft.namespaceId, this.principal);
    this.draft.durationTypeDefinitionId = "";
    this.draft.languageLevelDefinitionId = "";
  }

  updateDraftField(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    if (!target.name || !Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
  }

  onInput = (event) => {
    this.updateDraftField(event.target);
  };

  onChange = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    this.updateDraftField(target);

    const namespaceSelect = target.closest("select[data-namespace-select]");
    if (namespaceSelect) {
      this.busy = true;
      this.error = null;
      this.render();
      try { await this.selectNamespace(namespaceSelect.value); }
      catch (error) { this.error = error instanceof Error ? error.message : "Regole editoriali non disponibili"; }
      finally { this.busy = false; this.render(); }
      return;
    }

    const membership = target.closest("input[data-content-space-id]");
    if (!membership) return;
    membership.disabled = true;
    this.error = null;
    try {
      await authoringRepository.setContentSpaceMembership({
        contentSpaceId: membership.dataset.contentSpaceId,
        itemId: this.itemId,
        member: membership.checked,
      });
      const projected = (this.projection?.workspaceMemberships || []).find((entry) => id(entry.contentSpaceId) === membership.dataset.contentSpaceId);
      if (projected) projected.member = membership.checked;
      this.notice = "Spazio editoriale aggiornato.";
    } catch (error) {
      membership.checked = !membership.checked;
      this.error = error instanceof Error ? error.message : "Spazio editoriale non aggiornato";
    } finally {
      membership.disabled = false;
      this.render();
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);

    if (form.matches("[data-principal-form]")) {
      const [type, principalId] = String(data.get("principal") || "").split(":");
      if (!type || !principalId || this.itemId) return;
      this.busy = true;
      this.error = null;
      this.render();
      try { await this.changePrincipal(type, principalId); }
      catch (error) { this.error = error instanceof Error ? error.message : "Contesto di lavoro non disponibile"; }
      finally { this.busy = false; this.render(); }
      return;
    }

    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      if (form.matches("[data-create-item]")) {
        if (!this.preflight?.content?.allowed) throw new Error(this.preflight?.content?.blockers?.[0]?.message || "Le regole editoriali richieste non sono disponibili");
        if (!this.selectedSubject) throw new Error("Scegli prima di cosa deve parlare il contenuto");
        const item = await authoringRepository.createItem({
          primarySubjectId: this.selectedSubject.id || this.selectedSubject._id,
          ownerType: this.principal.type,
          ownerId: this.principal.id,
        });
        this.itemId = item._id || item.id;
        const url = new URL(window.location.href);
        url.searchParams.set("itemId", this.itemId);
        url.searchParams.set("principalType", this.principal.type);
        url.searchParams.set("principalId", id(this.principal.id));
        window.history.replaceState({}, "", url);
        await this.reloadProjection();
        await this.prepareNewEdition();
        this.notice = "Soggetto confermato. Ora scrivi il contenuto.";
      } else if (form.matches("[data-content-draft]")) {
        for (const key of ["label", "author", "license", "text", "tags"]) this.draft[key] = String(data.get(key) || "").trim();
        if (this.newEditionMode && (!this.draft.namespaceId || !this.namespaceControls)) throw new Error("Scegli prima le regole editoriali da usare");
        this.activeStep = 3;
      } else if (form.matches("[data-personalization-draft]")) {
        for (const key of ["durationTypeDefinitionId", "languageLevelDefinitionId", "locale"]) this.draft[key] = String(data.get(key) || "").trim();
        if (this.newEditionMode) await this.createEditionFromDraft();
        else await this.updateEditionFromDraft();
      } else if (form.matches("[data-add-representation]")) {
        await this.addRepresentation(data);
      } else if (form.matches("[data-update-representation]")) {
        await this.updateRepresentation(data);
      } else if (form.matches("[data-workflow-form]")) {
        const operationCode = String(data.get("operationCode") || "");
        const operation = this.availableOperation(operationCode);
        if (!operation || !isWorkflowOperation(operationCode)) throw new Error("Operazione editoriale non disponibile");
        const message = operation.requiresMessage ? String(data.get("message") || "").trim() : "";
        if (operation.requiresMessage && !message) throw new Error("Scrivi la motivazione delle modifiche richieste");
        await this.executeWorkflow(operationCode, message);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
    } finally {
      this.busy = false;
      this.render();
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
        relatedSubjectIds: [],
        tags: parseTags(this.draft.tags),
        illustrativeMedia: [],
        selectionSignals: [],
        presentationVariants: [{
          key: "standard",
          label: "Standard",
          semanticFocus: [],
          presentationAspects: [],
          knowledgeRequirements: [],
          representations: [{
            durationTypeDefinitionId: this.draft.durationTypeDefinitionId,
            languageLevelDefinitionId: this.draft.languageLevelDefinitionId,
            locale: this.draft.locale,
            text: this.draft.text,
          }],
        }],
        defaultPresentation: null,
      },
    });
    const variant = created.revision?.presentationVariants?.[0];
    const representation = variant?.representations?.[0];
    if (variant?._id && representation?._id) {
      await authoringRepository.updateEdition(created.edition._id, {
        defaultPresentation: { variantId: variant._id, representationId: representation._id },
      });
    }
    this.newEditionMode = false;
    this.namespaceControls = null;
    await this.reloadProjection(created.edition._id);
    await this.reloadAuthoringContext();
    this.activeStep = 4;
    this.notice = "Bozza salvata. Controlla il riepilogo prima della pubblicazione.";
  }

  async updateEditionFromDraft() {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision();
    const editionId = id(this.selectedEdition()?.id);
    if (!revision || !editionId) throw new Error("Nessuna versione modificabile");
    const payload = projectedRevisionToWrite(revision);
    payload.label = this.draft.label;
    payload.authorCredits = [this.draft.author].filter(Boolean);
    payload.tags = parseTags(this.draft.tags);
    payload.metadata = { license: this.draft.license };
    const first = payload.presentationVariants?.[0]?.representations?.[0];
    if (first) {
      first.durationTypeDefinitionId = this.draft.durationTypeDefinitionId || first.durationTypeDefinitionId;
      first.languageLevelDefinitionId = this.draft.languageLevelDefinitionId || first.languageLevelDefinitionId;
      first.locale = this.draft.locale || first.locale;
      first.text = this.draft.text;
    }
    await authoringRepository.updateEdition(editionId, payload);
    await this.reloadProjection(editionId);
    this.activeStep = 4;
    this.notice = "Modifiche salvate. Il controllo di consistenza va rieseguito prima della pubblicazione.";
  }

  async addRepresentation(data) {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision();
    const editionId = id(this.selectedEdition()?.id);
    if (!revision || !editionId) throw new Error("Nessuna versione modificabile");
    const payload = projectedRevisionToWrite(revision);
    const variant = payload.presentationVariants?.[0];
    if (!variant) throw new Error("La variante di presentazione principale non è disponibile");
    variant.representations = variant.representations || [];
    variant.representations.push({
      durationTypeDefinitionId: String(data.get("durationTypeDefinitionId") || ""),
      languageLevelDefinitionId: String(data.get("languageLevelDefinitionId") || ""),
      locale: String(data.get("locale") || "").trim(),
      text: String(data.get("text") || "").trim(),
    });
    await authoringRepository.updateEdition(editionId, payload);
    await this.reloadProjection(editionId);
    this.activeStep = 3;
    this.notice = "Testo alternativo aggiunto. Riesegui il controllo prima della pubblicazione.";
  }

  async updateRepresentation(data) {
    if (!this.availableOperation("item.edit")) throw new Error("Il contenuto non è modificabile nello stato corrente");
    const revision = this.selectedRevision();
    const editionId = id(this.selectedEdition()?.id);
    const representationId = String(data.get("representationId") || "");
    if (!revision || !editionId || !representationId) throw new Error("Testo alternativo non disponibile");
    const payload = projectedRevisionToWrite(revision);
    const variant = payload.presentationVariants?.find((entry) => (entry.representations || []).some((representation) => id(representation._id) === representationId));
    const representation = variant?.representations?.find((entry) => id(entry._id) === representationId);
    if (!representation) throw new Error("Testo alternativo non trovato");
    representation.durationTypeDefinitionId = String(data.get("durationTypeDefinitionId") || representation.durationTypeDefinitionId);
    representation.languageLevelDefinitionId = String(data.get("languageLevelDefinitionId") || representation.languageLevelDefinitionId);
    representation.locale = String(data.get("locale") || representation.locale).trim();
    representation.text = String(data.get("text") || representation.text).trim();
    await authoringRepository.updateEdition(editionId, payload);
    await this.reloadProjection(editionId);
    this.activeStep = 3;
    this.notice = "Testo alternativo aggiornato. Riesegui il controllo prima della pubblicazione.";
  }

  async executeWorkflow(operationCode, message = "") {
    const editionId = id(this.selectedEdition()?.id);
    if (!editionId) throw new Error("Versione editoriale non disponibile");
    const payload = message ? { message } : {};
    const result = await marketplaceRepository.executeWorkspaceOperation({
      operationCode,
      sourceRef: { resourceType: "item_edition", resourceId: editionId },
      targetPrincipal: { type: this.principal.type, id: this.principal.id },
      payload,
    });
    await this.reloadProjection(editionId);
    this.activeStep = 4;
    if (operationCode === "workflow.check") {
      const issues = result?.result?.issues || [];
      this.notice = issues.length ? `Controllo completato: ${issues.length} problema/i da risolvere.` : "Controllo completato: il contenuto è pronto per il passaggio successivo.";
    } else {
      this.notice = workflowNotice(operationCode);
    }
  }

  onSubjectSelected = (event) => {
    if (this.itemId || !event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.notice = event.detail.source === "reuse_existing"
      ? "Identità già presente: è stato riutilizzato il soggetto ArtAround esistente."
      : "Soggetto selezionato. Puoi continuare.";
    this.render();
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const stepButton = target.closest("button[data-step]");
    if (stepButton) {
      const step = Number(stepButton.dataset.step);
      if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.render(); }
      return;
    }

    const backButton = target.closest("button[data-back-step]");
    if (backButton) {
      const step = Math.max(1, Number(backButton.dataset.backStep) || 1);
      if (this.canOpenStep(step)) { this.activeStep = step; this.render(); }
      return;
    }

    const newEditionButton = target.closest("button[data-new-edition]");
    if (newEditionButton) {
      this.busy = true;
      this.error = null;
      this.render();
      try { await this.prepareNewEdition(); }
      catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aggiungere una nuova versione editoriale"; }
      finally { this.busy = false; this.render(); }
      return;
    }

    const editButton = target.closest("button[data-edit-content]");
    if (editButton) {
      this.newEditionMode = false;
      this.hydrateDraftFromProjection();
      this.activeStep = 2;
      this.render();
      return;
    }

    const editionButton = target.closest("button[data-edition-id]");
    if (editionButton) {
      this.busy = true;
      this.error = null;
      this.render();
      try {
        this.newEditionMode = false;
        this.namespaceControls = null;
        await this.reloadProjection(editionButton.dataset.editionId);
        this.activeStep = 4;
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Impossibile aprire la versione editoriale";
      } finally {
        this.busy = false;
        this.render();
      }
    }
  };

  async changePrincipal(type, principalId) {
    if (this.itemId) return;
    this.principal = { type, id: principalId };
    await this.reloadAuthoringContext();
    this.namespaceControls = null;
    this.draft = newDraft();
    const url = new URL(window.location.href);
    url.searchParams.set("principalType", this.principal.type);
    url.searchParams.set("principalId", id(this.principal.id));
    window.history.replaceState({}, "", url);
  }

  remediationHref() {
    const configurable = this.preflight?.content?.needsConfiguration?.[0];
    if (configurable?.id) return `/namespaces/editor?namespaceId=${encodeURIComponent(configurable.id)}`;
    if (this.principal?.type === "organization" && this.principal?.id) return `/organizations/detail?organizationId=${encodeURIComponent(id(this.principal.id))}#organization-namespaces`;
    return "/profile";
  }

  contentDraftReady() {
    const fieldsReady = [this.draft.label, this.draft.author, this.draft.license, this.draft.text]
      .every((value) => String(value || "").trim());
    const namespaceReady = !this.newEditionMode || Boolean(this.draft.namespaceId && this.namespaceControls);
    return Boolean(fieldsReady && namespaceReady);
  }

  canOpenStep(step) {
    if (step === 1) return true;
    if (step === 2) return Boolean(this.itemId);
    if (step === 3) return Boolean(this.itemId && this.contentDraftReady());
    if (step === 4) return Boolean(this.selectedRevision() && !this.newEditionMode);
    return false;
  }

  renderProgress() {
    const stages = [
      [1, "Di cosa parla"],
      [2, "Contenuto"],
      [3, "Personalizzazione"],
      [4, "Controllo e pubblicazione"],
    ];
    const currentLabel = stages.find(([step]) => step === this.activeStep)?.[1] || stages[0][1];
    return `<nav class="authoring-progress" aria-label="Passaggi di creazione"><div class="authoring-progress__summary"><span>Passaggio ${this.activeStep} di ${stages.length}</span><strong>${escapeHtml(currentLabel)}</strong></div><ol>${stages.map(([step, label]) => {
      const enabled = this.canOpenStep(step);
      const current = this.activeStep === step;
      const complete = step === 1 ? Boolean(this.itemId) : step === 2 ? this.contentDraftReady() : step === 3 ? Boolean(this.selectedRevision() && !this.newEditionMode) : this.selectedRevision()?.status === "published";
      return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${enabled ? "" : "disabled"} aria-current="${current ? "step" : "false"}" aria-label="Passaggio ${step}: ${escapeHtml(label)}"><span>${complete ? icon("check", { size: 14 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`;
    }).join("")}</ol></nav>`;
  }

  renderWorkingContext() {
    const principalOptions = (this.workspace?.availablePrincipals || []).map((entry) => `<option value="${escapeHtml(`${entry.type}:${id(entry.id)}`)}" ${this.principal && entry.type === this.principal.type && id(entry.id) === id(this.principal.id) ? "selected" : ""}>${escapeHtml(entry.name)}${entry.type === "organization" && entry.role ? ` · ${escapeHtml(entry.role)}` : ""}</option>`).join("");
    if (!principalOptions) return "";
    if (this.itemId) {
      const selected = (this.workspace?.availablePrincipals || []).find((entry) => entry.type === this.principal.type && id(entry.id) === id(this.principal.id));
      return `<div class="working-context surface"><span>Stai lavorando per</span><strong>${escapeHtml(selected?.name || this.projection?.lineage?.owner?.name || "Contesto selezionato")}</strong></div>`;
    }
    return `<form data-principal-form class="working-context surface"><label><span>Stai lavorando per</span><select name="principal">${principalOptions}</select></label><button class="button-secondary" type="submit">Cambia</button></form>`;
  }

  renderPrerequisiteBlocker() {
    if (this.itemId || this.preflight?.content?.allowed !== false) return "";
    const blocker = this.preflight?.content?.blockers?.[0];
    return `<section class="panel blocker-panel"><span class="resource-mark">${icon("warning", { size: 22 })}</span><div><span class="eyebrow">Prima di iniziare</span><h2>Prepara le regole editoriali</h2><p>${escapeHtml(blocker?.message || "Manca una configurazione editoriale utilizzabile.")}</p><p class="note">ArtAround non crea un contenuto incompleto quando il prerequisito è già noto.</p><a class="button-link" data-route href="${escapeHtml(this.remediationHref())}">Configura le regole editoriali ${icon("chevron", { size: 15 })}</a></div></section>`;
  }

  renderSubjectSummary() {
    if (!this.selectedSubject) return "";
    const identities = (this.selectedSubject.externalIdentities || []).map((identity) => `${identity.scheme}: ${identity.id}`).join(" · ");
    return `<article class="subject-summary"><span class="eyebrow">Soggetto del contenuto</span><h3>${escapeHtml(this.selectedSubject.preferredLabel)}</h3><p>${escapeHtml(this.selectedSubject.description || "Nessuna descrizione disponibile")}</p>${identities ? `<details class="technical-details"><summary>Identità tecnica</summary><p>${escapeHtml(identities)}</p><p class="note">Internamente questa identità è il Subject condiviso da ArtAround.</p></details>` : ""}</article>`;
  }

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    const venue = this.venueTargetContext;
    const physicalContext = venue ? `<aside class="context-box"><span class="eyebrow">Oggetto della sede</span><strong>${escapeHtml(venue.venueTarget.label)}</strong><p>${escapeHtml(venue.venue.name)}${venue.venueTarget.description ? ` · ${escapeHtml(venue.venueTarget.description)}` : ""}</p><p class="note">L'oggetto serve a precompilare il soggetto. Il contenuto resta editoriale e non incorpora la posizione fisica.</p>${(venue.recognitionMedia || []).length ? `<details class="technical-details"><summary>Riconoscimento fisico</summary><p>${venue.recognitionMedia.length} immagine/i restano nella configurazione della sede, separate dal contenuto editoriale.</p></details>` : ""}</aside>` : "";
    if (this.itemId) {
      return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Soggetto confermato</h2><p>Il soggetto identifica in modo univoco ciò di cui parla il contenuto.</p></div></header>${physicalContext}${this.renderSubjectSummary()}<div class="step-actions"><button type="button" data-step="2">Continua al contenuto ${icon("chevron", { size: 15 })}</button></div></section>`;
    }
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Di cosa parla</span><h2>Trova l'opera, la persona o il concetto</h2><p>Cerca prima un'identità già esistente; creane una nuova solo se non trovi quella corretta.</p></div></header>${physicalContext}${this.renderSubjectSummary()}<artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker>${this.selectedSubject ? `<form data-create-item class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>Usa questo soggetto e continua ${icon("chevron", { size: 15 })}</button></form>` : ""}</section>`;
  }

  renderNamespaceSelector() {
    const choices = this.usableNamespaceChoices({ excludeUsed: true });
    if (!choices.length) {
      return `<div class="empty-state compact"><h3>Nessun'altra regola editoriale disponibile</h3><p>Ogni insieme di regole può essere usato una sola volta per questo contenuto.</p><a class="button-link secondary" data-route href="${escapeHtml(this.remediationHref())}">Gestisci le regole editoriali</a></div>`;
    }
    const options = [`<option value="">Scegli le regole editoriali</option>`, ...choices.map((choice) => `<option value="${escapeHtml(choice.id)}" ${choice.id === this.draft.namespaceId ? "selected" : ""}>${escapeHtml(choice.name)}${choice.ownership === "licensed" ? " · disponibili tramite licenza" : ""}</option>`)].join("");
    return `<label>Regole editoriali<select name="namespaceId" data-namespace-select required>${options}</select><small>Definiscono le opzioni di durata e linguaggio disponibili. Non cambiano il soggetto del contenuto.</small></label>`;
  }

  renderStepTwo() {
    if (this.activeStep !== 2 || !this.itemId) return "";
    const revision = this.selectedRevision();
    const editing = Boolean(revision && !this.newEditionMode);
    const namespaceName = editing ? this.selectedNamespace()?.name : this.namespaceControls?.namespace?.name;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Contenuto</span><h2>Scrivi il contenuto essenziale</h2><p>Titolo, testo, autore e licenza sono le informazioni necessarie per una bozza pubblicabile.</p></div></header>${editing ? `<div class="selection-summary"><span>Regole editoriali</span><strong>${escapeHtml(namespaceName || "Non disponibili")}</strong></div>` : this.renderNamespaceSelector()}${this.newEditionMode && this.draft.namespaceId && !this.namespaceControls ? `<p role="status">Caricamento delle opzioni editoriali…</p>` : ""}${editing || this.namespaceControls ? `<form data-content-draft class="editor-form"><label>Titolo del contenuto<input name="label" required value="${escapeHtml(this.draft.label)}" placeholder="Un titolo chiaro e riconoscibile"></label><label>Testo<textarea name="text" rows="10" required placeholder="Scrivi ciò che il visitatore leggerà o ascolterà">${escapeHtml(this.draft.text)}</textarea></label><div class="two-columns"><label>Autore<input name="author" required value="${escapeHtml(this.draft.author)}" placeholder="Nome dell'autore o redazione"></label><label>Licenza<input name="license" required value="${escapeHtml(this.draft.license)}" placeholder="es. CC BY 4.0"></label></div><details class="technical-details"><summary>Metadati facoltativi</summary><label>Tag<input name="tags" value="${escapeHtml(this.draft.tags)}" placeholder="es. rinascimento, prospettiva, Firenze"><small>Separa i tag con una virgola.</small></label></details><div class="step-actions"><button class="button-secondary" type="button" data-back-step="1">Indietro</button><button type="submit" ${this.busy ? "disabled" : ""}>Continua alla personalizzazione ${icon("chevron", { size: 15 })}</button></div></form>` : ""}<details class="technical-details"><summary>Per utenti esperti: struttura editoriale</summary><p>Ogni insieme di regole corrisponde internamente a un Namespace; la bozza verrà salvata come ItemEdition e ItemRevision solo al passaggio successivo.</p></details></section>`;
  }

  personalizationControls() {
    if (this.newEditionMode) return this.namespaceControls?.controls || null;
    return this.selectedNamespace()?.revision || null;
  }

  renderMemberships() {
    const rows = (this.projection?.workspaceMemberships || []).map((entry) => `<label class="membership"><input type="checkbox" data-content-space-id="${escapeHtml(id(entry.contentSpaceId))}" ${entry.member ? "checked" : ""}> <span><strong>${escapeHtml(entry.name)}</strong><small>Rende il contenuto disponibile in questo spazio editoriale senza cambiarne il proprietario.</small></span></label>`).join("");
    return rows ? `<fieldset class="membership-fieldset"><legend>Spazi editoriali</legend><p class="note">Facoltativo. Puoi usare lo stesso contenuto in più raccolte di lavoro.</p><div class="membership-grid">${rows}</div></fieldset>` : `<div class="empty-state compact"><p>Nessuno spazio editoriale disponibile per questo contesto.</p></div>`;
  }

  renderTechnicalPresentation() {
    const revision = this.selectedRevision();
    const variant = this.firstVariant();
    const representation = this.firstRepresentation();
    if (this.newEditionMode) {
      return `<details class="technical-details"><summary>Dettagli tecnici</summary><dl><div><dt>Namespace</dt><dd>${escapeHtml(this.namespaceControls?.namespace?.id || this.draft.namespaceId || "-")}</dd></div><div><dt>NamespaceRevision</dt><dd>${escapeHtml(this.namespaceControls?.revision?.id || "-")}</dd></div></dl><p>Al salvataggio ArtAround crea una PresentationVariant standard e una Representation con le opzioni scelte.</p></details>`;
    }
    if (!revision) return "";
    return `<details class="technical-details"><summary>Dettagli tecnici</summary><dl><div><dt>Item</dt><dd>${escapeHtml(this.projection?.lineage?.id || "-")}</dd></div><div><dt>ItemEdition</dt><dd>${escapeHtml(this.selectedEdition()?.id || "-")}</dd></div><div><dt>ItemRevision</dt><dd>${escapeHtml(revision.id || "-")}</dd></div><div><dt>Namespace</dt><dd>${escapeHtml(this.selectedNamespace()?.id || "-")}</dd></div><div><dt>NamespaceRevision</dt><dd>${escapeHtml(this.selectedNamespace()?.revision?.id || "-")}</dd></div><div><dt>PresentationVariant</dt><dd>${escapeHtml(variant?.id || "-")}</dd></div><div><dt>Representation</dt><dd>${escapeHtml(representation?.id || "-")}</dd></div></dl><p>${revision.presentationVariants?.length || 0} variant/i di presentazione · ${revision.presentationVariants?.reduce((total, entry) => total + (entry.representations?.length || 0), 0) || 0} representation complessive. Le strutture non modificate vengono preservate dal salvataggio.</p></details>`;
  }

  renderAdditionalRepresentations(controls) {
    if (this.newEditionMode || !this.selectedRevision()) {
      return `<details class="technical-details"><summary>Altri testi e livelli</summary><p>Salva prima la bozza principale. Potrai poi aggiungere altri testi con durata, livello linguistico o lingua differenti mantenendo lo stesso contenuto editoriale.</p></details>`;
    }
    const representations = this.firstVariant()?.representations || [];
    const extra = representations.slice(1);
    const canEdit = Boolean(this.availableOperation("item.edit"));
    const durationOptions = (selected = "") => (controls.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)} · ${entry.targetSeconds}s</option>`).join("");
    const languageOptions = (selected = "") => (controls.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("");
    const existing = extra.map((representation, index) => `<details class="representation-card"><summary><strong>Testo alternativo ${index + 1}</strong><span>${escapeHtml(representation.duration?.label || "Durata")} · ${escapeHtml(representation.languageComplexity?.label || "Linguaggio")} · ${escapeHtml(representation.locale || "-")}</span></summary>${canEdit ? `<form data-update-representation class="editor-form compact-form"><input type="hidden" name="representationId" value="${escapeHtml(id(representation.id))}"><div class="two-columns"><label>Durata<select name="durationTypeDefinitionId" required>${durationOptions(representation.duration?.definitionId)}</select></label><label>Complessità linguistica<select name="languageLevelDefinitionId" required>${languageOptions(representation.languageComplexity?.definitionId)}</select></label></div><label>Lingua e locale<input name="locale" required value="${escapeHtml(representation.locale || "it-IT")}"></label><label>Testo<textarea name="text" rows="7" required>${escapeHtml(representation.text || "")}</textarea></label><button class="button-secondary" type="submit" ${this.busy ? "disabled" : ""}>Salva testo alternativo</button></form>` : `<p>${escapeHtml(representation.text || "")}</p>`}</details>`).join("");
    const add = canEdit ? `<details class="technical-details"><summary>${icon("plus", { size: 15 })} Aggiungi un altro testo</summary><p class="note">Usa una combinazione diversa di durata, complessità o lingua. Il controllo di consistenza segnalerà eventuali duplicati.</p><form data-add-representation class="editor-form compact-form"><div class="two-columns"><label>Durata<select name="durationTypeDefinitionId" required><option value="">Scegli la durata</option>${durationOptions()}</select></label><label>Complessità linguistica<select name="languageLevelDefinitionId" required><option value="">Scegli il livello</option>${languageOptions()}</select></label></div><label>Lingua e locale<input name="locale" required value="it-IT"></label><label>Testo<textarea name="text" rows="7" required placeholder="Scrivi il testo alternativo"></textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Aggiungi testo</button></form></details>` : "";
    return `<section class="alternate-texts"><header><span class="eyebrow">Testi multipli</span><h3>Altri testi e livelli</h3><p>Facoltativo. Aggiungi versioni alternative per durata, linguaggio o lingua senza creare un nuovo soggetto.</p></header>${existing || `<p class="note">Nessun testo alternativo.</p>`}${add}</section>`;
  }

  renderStepThree() {
    if (this.activeStep !== 3 || !this.itemId) return "";
    const controls = this.personalizationControls();
    const first = this.firstRepresentation();
    if (!controls) return `<section class="wizard-step panel"><p role="alert">Le opzioni di personalizzazione non sono disponibili.</p></section>`;
    const durationOptions = [`<option value="">Scegli la durata</option>`, ...(controls.durationTypes || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${this.draft.durationTypeDefinitionId === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)} · ${entry.targetSeconds}s</option>`)].join("");
    const languageOptions = [`<option value="">Scegli il livello</option>`, ...(controls.languageLevels || []).map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${this.draft.languageLevelDefinitionId === entry.definitionId ? "selected" : ""}>${escapeHtml(entry.label)}</option>`)].join("");
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Personalizzazione</span><h2>Adatta il contenuto al pubblico</h2><p>Scegli durata, complessità linguistica e lingua. Le opzioni provengono dalle regole editoriali selezionate.</p></div></header><form data-personalization-draft class="editor-form"><div class="two-columns"><label>Durata<select name="durationTypeDefinitionId" required>${durationOptions}</select></label><label>Complessità linguistica<select name="languageLevelDefinitionId" required>${languageOptions}</select></label></div><label>Lingua e locale<input name="locale" required value="${escapeHtml(this.draft.locale || first?.locale || "it-IT")}" placeholder="it-IT"></label><div class="step-actions"><button class="button-secondary" type="button" data-back-step="2">Indietro</button><button type="submit" ${this.busy ? "disabled" : ""}>${this.newEditionMode ? `Salva bozza ${icon("check", { size: 15 })}` : `Salva modifiche ${icon("check", { size: 15 })}`}</button></div></form>${this.renderAdditionalRepresentations(controls)}${this.renderMemberships()}${this.renderTechnicalPresentation()}</section>`;
  }

  reviewSummary() {
    const revision = this.selectedRevision();
    const first = this.firstRepresentation();
    const memberships = (this.projection?.workspaceMemberships || []).filter((entry) => entry.member);
    if (!revision) return "";
    const wordCount = String(first?.text || "").trim() ? String(first.text).trim().split(/\s+/).length : 0;
    return `<div class="review-grid"><article><span>Di cosa parla</span><strong>${escapeHtml(this.selectedSubject?.preferredLabel || "-")}</strong></article><article><span>Titolo</span><strong>${escapeHtml(revision.label || "-")}</strong></article><article><span>Durata</span><strong>${escapeHtml(first?.duration?.label || "-")}</strong></article><article><span>Linguaggio</span><strong>${escapeHtml(first?.languageComplexity?.label || "-")}</strong></article><article><span>Lingua</span><strong>${escapeHtml(first?.locale || "-")}</strong></article><article><span>Testo</span><strong>${wordCount} parole</strong></article><article><span>Autore</span><strong>${escapeHtml(revision.authorCredits?.[0] || "-")}</strong></article><article><span>Licenza</span><strong>${escapeHtml(revision.license || "-")}</strong></article><article><span>Tag</span><strong>${revision.tags?.length ? escapeHtml(revision.tags.join(", ")) : "Nessuno"}</strong></article><article><span>Spazi editoriali</span><strong>${memberships.length ? escapeHtml(memberships.map((entry) => entry.name).join(", ")) : "Nessuno"}</strong></article></div>`;
  }

  renderWorkflowOperation(operation) {
    const code = operation.code;
    if (operation.requiresMessage) {
      return `<form data-workflow-form class="workflow-message-form"><input type="hidden" name="operationCode" value="${escapeHtml(code)}"><label>Motivazione<textarea name="message" rows="3" required placeholder="Spiega quali modifiche sono necessarie"></textarea></label><button class="button-secondary" type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
    }
    const secondary = ["workflow.withdraw_review"].includes(code) ? "button-secondary" : "";
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(code)}"><button class="${secondary}" type="submit" ${this.busy ? "disabled" : ""}>${code === "workflow.check" ? icon("check", { size: 15 }) : ""}${escapeHtml(workflowLabel(operation))}</button></form>`;
  }

  renderStepFour() {
    if (this.activeStep !== 4 || !this.selectedRevision() || this.newEditionMode) return "";
    const revision = this.selectedRevision();
    const integrity = revision.integrity?.status || "needs_review";
    const issues = revision.integrity?.issues || [];
    const operations = this.workflowOperations();
    const published = revision.status === "published";
    const editAllowed = Boolean(this.availableOperation("item.edit"));
    const unusedNamespaces = this.usableNamespaceChoices({ excludeUsed: true });
    const statePanel = published
      ? `<div class="readiness success">${icon("check", { size: 20 })}<div><strong>Versione pubblicata</strong><p>Questa revisione è uno snapshot editoriale immutabile. La pubblicazione nel Catalogo è un passaggio commerciale separato.</p></div></div>`
      : integrity === "valid"
        ? `<div class="readiness success">${icon("check", { size: 20 })}<div><strong>Controllo superato</strong><p>Il contenuto è coerente con le regole editoriali e può passare alla pubblicazione o alla revisione organizzativa.</p></div></div>`
        : `<div class="readiness warning">${icon("warning", { size: 20 })}<div><strong>Serve un controllo</strong><p>Controlla la consistenza dopo ogni modifica. Eventuali problemi verranno mostrati qui prima della pubblicazione.</p></div></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Controllo e pubblicazione</span><h2>Verifica prima di pubblicare</h2><p>Rivedi il riepilogo e usa solo le azioni che il backend rende disponibili nello stato corrente.</p></div></header>${this.reviewSummary()}${statePanel}${issues.length ? `<div class="issue-panel"><strong>Problemi da risolvere</strong><ul>${issues.map((issue) => `<li>${escapeHtml(issue.message || issue.code)}</li>`).join("")}</ul>${editAllowed ? `<button class="button-secondary" type="button" data-edit-content>Correggi il contenuto</button>` : ""}</div>` : ""}<div class="workflow-panel"><div><h3>Azioni disponibili</h3><p class="note">La pubblicazione editoriale non crea automaticamente una scheda nel Marketplace.</p></div><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("") || `<p>Nessuna azione editoriale disponibile nello stato <strong>${escapeHtml(revision.status)}</strong>.</p>`}</div></div><div class="step-actions">${editAllowed ? `<button class="button-secondary" type="button" data-edit-content>${icon("edit", { size: 15 })} Modifica contenuto</button>` : ""}${this.availableOperation("item.create_edition") && this.preflight?.content?.allowed && unusedNamespaces.length ? `<button class="button-secondary" type="button" data-new-edition>${icon("plus", { size: 15 })} Aggiungi versione editoriale</button>` : ""}</div>${this.renderTechnicalPresentation()}</section>`;
  }

  renderEditions() {
    const editions = this.projection?.editions || [];
    if (editions.length <= 1 && !this.newEditionMode) return "";
    return `<nav class="edition-tabs" aria-label="Versioni editoriali del contenuto"><span>Versioni editoriali</span>${editions.map((edition) => `<button type="button" data-edition-id="${escapeHtml(id(edition.id))}" aria-pressed="${!this.newEditionMode && id(this.selectedEdition()?.id) === id(edition.id)}">${escapeHtml(edition.namespace?.name || "Versione")}</button>`).join("")}${this.newEditionMode ? `<span class="status">Nuova bozza</span>` : ""}</nav>`;
  }

  render() {
    const blocked = !this.itemId && this.preflight?.content?.allowed === false;
    this.innerHTML = `<style>
      :host{display:block}.authoring-page{display:grid;gap:1rem;max-width:68rem;margin:auto;padding:2rem 1rem 5rem}.authoring-progress{padding:.25rem 0}.authoring-progress__summary{display:none}.authoring-progress ol{display:grid;grid-template-columns:repeat(4,minmax(9rem,1fr));gap:.55rem;min-width:42rem;margin:0;padding:0;list-style:none}.authoring-progress button{display:flex;width:100%;align-items:center;gap:.5rem;padding:.65rem .75rem;border:1px solid #ccd6d1;border-radius:.7rem;background:white;color:#476159;text-align:left}.authoring-progress button>span{display:grid;place-items:center;flex:0 0 1.7rem;height:1.7rem;border-radius:999px;background:#edf2ef;font-weight:850}.authoring-progress li[data-current="true"] button{border-color:#2f7561;box-shadow:0 0 0 2px #d8ebe4}.authoring-progress li[data-current="true"] button>span,.authoring-progress li[data-complete="true"] button>span{background:#dcefe7;color:#176143}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem;align-items:flex-start}.step-heading h2{margin:.15rem 0}.step-heading p{margin:.25rem 0}.step-number{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:999px;background:#173e35;color:white;font-weight:850}.editor-form{display:grid;gap:.9rem;max-width:48rem;margin-top:1.2rem}.editor-form label,.membership-fieldset label,.working-context label{display:grid;gap:.35rem}.editor-form small,.membership small{color:#60706a;font-weight:500}.editor-form input,.editor-form select,.editor-form textarea,.working-context select{width:100%;box-sizing:border-box}.two-columns{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.step-actions,.workflow-actions{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.step-actions form,.workflow-actions form{margin:0}.subject-summary,.context-box,.selection-summary,.readiness,.issue-panel,.workflow-panel{margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#f8faf8}.subject-summary h3{margin:.2rem 0}.selection-summary{display:flex;justify-content:space-between;gap:1rem;align-items:center}.selection-summary span{color:#60706a}.membership-fieldset{margin-top:1.2rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem}.membership-fieldset legend{padding:0 .35rem;font-weight:850}.membership-grid{display:grid;gap:.55rem}.membership{grid-template-columns:auto 1fr;align-items:start;padding:.65rem;border-radius:.65rem;background:#f6f8f6}.review-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;margin-top:1rem}.review-grid article{display:grid;gap:.2rem;padding:.8rem;border:1px solid #d9e0dc;border-radius:.7rem;background:#fff}.review-grid span{font-size:.75rem;color:#60706a}.readiness{display:flex;gap:.7rem;align-items:flex-start}.readiness.success{border-color:#b9d9c9;background:#eef8f2}.readiness.warning{border-color:#e4c28a;background:#fff8e8}.issue-panel{border-color:#dfb9ae;background:#fff5f2}.issue-panel ul{margin:.65rem 0}.workflow-panel{display:grid;grid-template-columns:minmax(12rem,.75fr) minmax(0,1.25fr);gap:1rem;align-items:start}.workflow-panel h3{margin:.1rem 0}.workflow-message-form{display:grid;gap:.55rem;width:min(100%,32rem)}.workflow-message-form label{display:grid;gap:.35rem}.technical-details{margin-top:1rem;padding:.75rem;border:1px dashed #91a39b;border-radius:.7rem;background:#fbfcfb}.technical-details summary{cursor:pointer;font-weight:800}.alternate-texts{display:grid;gap:.65rem;margin-top:1.2rem;padding-top:1rem;border-top:1px solid #d8dfdb}.alternate-texts h3{margin:.15rem 0}.representation-card{padding:.75rem;border:1px solid #d8dfdb;border-radius:.7rem;background:#fff}.representation-card summary{display:flex;justify-content:space-between;gap:.75rem;cursor:pointer}.representation-card summary span{color:#60706a;font-size:.78rem}.compact-form{margin-top:.75rem}.technical-details dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem}.technical-details dl>div{min-width:0}.technical-details dt{font-size:.72rem;color:#60706a}.technical-details dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:.78rem}.edition-tabs{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.7rem;border:1px solid #d5ddd8;border-radius:.7rem;background:#fff}.edition-tabs>span:first-child{font-size:.78rem;font-weight:850;color:#60706a}.edition-tabs button[aria-pressed="true"]{background:#173e35;color:#fff}.blocker-panel{display:grid;grid-template-columns:auto 1fr;gap:.8rem;padding:1.2rem}.blocker-panel h2{margin:.2rem 0}.compact{padding:1rem}.compact h3{margin:.1rem 0}.note{color:#60706a;font-size:.85rem}@media(max-width:48rem){.authoring-progress ol{grid-template-columns:repeat(4,minmax(0,1fr));min-width:0}.authoring-progress button{height:100%;flex-direction:column;justify-content:center;text-align:center}.authoring-progress button strong{font-size:.72rem}.two-columns,.review-grid,.workflow-panel{grid-template-columns:1fr}.wizard-step{padding:1rem}.step-heading{gap:.65rem}.selection-summary{align-items:flex-start;flex-direction:column}.authoring-page{padding-top:1rem}}@media(max-width:32rem){.authoring-progress__summary{display:grid;gap:.1rem;margin-bottom:.55rem}.authoring-progress__summary span{color:#60706a;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.authoring-progress__summary strong{color:#173e35}.authoring-progress button{min-height:2.8rem;padding:.5rem}.authoring-progress button strong{display:none}.review-grid{grid-template-columns:1fr}.step-actions>*{width:100%}.step-actions button,.step-actions .button-link{width:100%;justify-content:center}.working-context{align-items:stretch}}
    </style><main class="page authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/create">${icon("arrowLeft", { size: 15 })} Crea</a><span>/</span><span>Contenuto</span></nav><header class="page-header"><div><span class="eyebrow">Crea contenuto</span><h1>${this.itemId ? "Contenuto" : "Nuovo contenuto"}</h1><p>Quattro passaggi: identifica il soggetto, scrivi il testo, personalizzalo e controllalo prima della pubblicazione.</p></div></header>${this.renderWorkingContext()}${!blocked ? this.renderProgress() : ""}${this.busy ? `<p role="status">Aggiornamento in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.notice)}</p>` : ""}${this.renderPrerequisiteBlocker()}${this.renderEditions()}${blocked ? "" : `${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}`}</main>`;
  }
}

customElements.define("artaround-item-authoring-view", ItemAuthoringView);
