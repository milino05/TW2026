import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { visitSequenceRepository } from "../infrastructure/http/visit-sequence-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { userFacingIssueMessage } from "../application/user-facing-errors.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?.id || value?._id || value || ""); }
function asNullableNumber(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}
function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    visitId: params.get("visitId"),
    step: Math.max(1, Math.min(5, Number(params.get("step")) || 1)),
  };
}
function roleLabel(role) {
  return ({ core: "Essenziale", recommended: "Consigliato", optional: "Facoltativo" })[role] || "Consigliato";
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
function workflowNotice(code) {
  return ({
    "workflow.check": "Controllo completato.",
    "workflow.request_review": "Visita inviata in revisione.",
    "workflow.withdraw_review": "Visita ritirata dalla revisione.",
    "workflow.request_changes": "Richiesta di modifiche inviata.",
    "workflow.publish": "Visita pubblicata editorialmente.",
  })[code] || "Operazione editoriale completata.";
}
function minutes(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value / 60)) : null;
}

export class ArtAroundVisitAuthoringView extends HTMLElement {
  context = readOperatingContext();
  projection = null;
  content = null;
  venueTargets = null;
  busy = false;
  error = null;
  message = null;
  query = "";
  page = 1;
  contentAccess = "all";
  selectedSourceKey = "all";
  selectedContentVenueId = null;
  selectedVenueId = null;
  activeStep = 1;
  pendingOccurrence = null;
  dragState = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("change", this.onChange);
    this.addEventListener("dragstart", this.onDragStart);
    this.addEventListener("dragover", this.onDragOver);
    this.addEventListener("drop", this.onDrop);
    this.addEventListener("dragend", this.onDragEnd);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("dragstart", this.onDragStart);
    this.removeEventListener("dragover", this.onDragOver);
    this.removeEventListener("drop", this.onDrop);
    this.removeEventListener("dragend", this.onDragEnd);
  }

  get visitId() { return currentParams().visitId; }
  get revision() { return this.projection?.visit?.revision || null; }
  get principal() { return this.projection?.principal || null; }
  get editable() { return Boolean(this.availableOperation("visit.edit")); }

  availableOperation(code) {
    return (this.projection?.availableOperations || []).find((operation) => operation.code === code) || null;
  }
  workflowOperations() {
    return (this.projection?.availableOperations || []).filter((operation) => String(operation.code || "").startsWith("workflow."));
  }
  venueChoices() {
    return (this.projection?.venueSelector?.organizations || []).flatMap((organization) =>
      (organization.venues || []).map((venue) => ({ ...venue, organizationName: organization.name }))
    );
  }
  stopById(anchorId) {
    return (this.revision?.stops || []).find((stop) => id(stop.id) === id(anchorId)) || null;
  }
  entriesForAnchor(anchorId) {
    const entries = this.revision?.entries || [];
    return entries.filter((entry) => id(entry.deliveryAnchorId) === id(anchorId));
  }
  contextualEntries() {
    return (this.revision?.entries || []).filter((entry) => !entry.deliveryAnchorId);
  }

  async load() {
    const selected = operatingPrincipal(this.context);
    if (!selected) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const params = currentParams();
      this.projection = await authoringRepository.visitProjection({ ...params, ...selected });
      if (this.projection?.principal && (this.projection.principal.type !== selected.principalType || id(this.projection.principal.id) !== id(selected.principalId))) {
        throw new Error("Questa visita appartiene a un'altra area di lavoro. Cambia area prima di modificarla.");
      }
      const venues = this.venueChoices();
      if (!venues.some((venue) => id(venue.id) === id(this.selectedVenueId))) {
        this.selectedVenueId = id(this.revision?.stops?.[0]?.venue?.id || venues[0]?.id || "") || null;
      }
      await Promise.all([this.loadVenueTargets(false), this.loadContent(false)]);
      if (this.visitId) {
        const requested = currentParams().step;
        this.activeStep = this.canOpenStep(requested) ? requested : (this.revision?.status === "published" ? 5 : 1);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Editor visita non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async reloadProjection() {
    const selected = operatingPrincipal(this.context);
    if (!selected) throw new Error("Area di lavoro non selezionata");
    this.projection = await authoringRepository.visitProjection({ visitId: this.visitId });
    if (this.projection?.principal && (this.projection.principal.type !== selected.principalType || id(this.projection.principal.id) !== id(selected.principalId))) {
      throw new Error("Questa visita appartiene a un'altra area di lavoro.");
    }
  }

  async loadVenueTargets(render = true) {
    if (!this.selectedVenueId) {
      this.venueTargets = null;
      if (render) this.render();
      return;
    }
    try {
      this.venueTargets = await authoringRepository.venueTargets(this.selectedVenueId);
    } catch (error) {
      this.venueTargets = null;
      if (render) this.error = error instanceof Error ? error.message : "Entità della sede non disponibili";
    }
    if (render) this.render();
  }

  async loadContent(render = true) {
    if (!this.principal || !this.visitId) {
      this.content = null;
      if (render) this.render();
      return;
    }
    try {
      this.content = await authoringRepository.searchVisitContentCandidates(this.visitId, {
        q: this.query,
        access: this.contentAccess,
        source: this.selectedSourceKey,
        venueId: this.selectedContentVenueId,
        page: this.page,
        limit: 20,
      });
    } catch (error) {
      this.content = null;
      if (render) this.error = error instanceof Error ? error.message : "Contenuti disponibili non caricabili";
    }
    if (render) this.render();
  }

  serializeRouteHints() {
    return (this.revision?.logistics?.routeHints || []).map((hint) => ({
      _id: hint.id,
      fromAnchorId: hint.fromAnchorId,
      toAnchorId: hint.toAnchorId,
      type: hint.type,
      instructionOverride: hint.instructionOverride || null,
      note: hint.note || null,
      estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
    }));
  }

  async execute(callback, successMessage, { refreshContent = false, refreshVenueTargets = false } = {}) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const result = await callback();
      await this.reloadProjection();
      if (refreshContent) await this.loadContent(false);
      if (refreshVenueTargets) await this.loadVenueTargets(false);
      this.message = typeof successMessage === "function" ? successMessage(result) : successMessage;
      return result;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
      return null;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async addSelectedContent(result, venueTargetId = null) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const payload = {
        contentSource: result.contentSource,
        itemEditionId: result.itemEditionId,
        itemRevisionId: result.itemRevisionId,
        role: "recommended",
        ...(venueTargetId ? { venueTargetId } : {}),
      };
      const response = await authoringRepository.addVisitContent(this.visitId, payload);
      this.pendingOccurrence = null;
      await this.reloadProjection();
      await this.loadContent(false);
      const inference = response?.command?.inference?.status;
      this.message = inference === "inferred"
        ? "Contenuto aggiunto; la collocazione fisica è stata riconosciuta automaticamente."
        : inference === "selected_occurrence"
          ? "Contenuto aggiunto nell'occorrenza scelta."
          : "Contenuto aggiunto alla visita.";
    } catch (error) {
      if (error?.code === "VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED") {
        const candidates = error.details?.find((detail) => detail.code === "VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED")?.context?.candidates || [];
        this.pendingOccurrence = { result, candidates };
        this.message = "Questo contenuto esiste in più punti: scegli l'occorrenza fisica corretta.";
      } else {
        this.error = error instanceof Error ? error.message : "Impossibile aggiungere il contenuto";
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  canOpenStep(step) {
    if (!this.visitId) return step === 1;
    return [1, 2, 3, 4, 5].includes(step);
  }
  stepComplete(step) {
    if (step === 1) return Boolean(this.revision?.title);
    if (step === 2) return (this.revision?.entries || []).length > 0 && (this.revision?.stops || []).length > 0;
    if (step === 3) return Boolean(this.revision?.presentationBaseline);
    if (step === 4) return this.revision?.routeReview?.status === "ready";
    if (step === 5) return this.revision?.status === "published";
    return false;
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);

    if (form.matches("[data-create-visit]")) {
      if (!this.availableOperation("visit.create")) return;
      await this.execute(async () => {
        const response = await authoringRepository.createVisit({
          ownerType: this.principal.type,
          ownerId: this.principal.id,
          title: String(data.get("title") || "").trim(),
          description: String(data.get("description") || "").trim(),
        });
        navigate(`/workspace/visit-authoring?visitId=${encodeURIComponent(response.visit._id)}&step=2`);
      }, "Bozza visita creata");
      return;
    }
    if (form.matches("[data-visit-main]")) {
      await this.execute(() => authoringRepository.updateVisit(this.visitId, {
        title: String(data.get("title") || "").trim(),
        description: String(data.get("description") || "").trim(),
      }), "Informazioni principali salvate");
      return;
    }
    if (form.matches("[data-visit-search]")) {
      this.query = String(data.get("q") || "").trim();
      this.page = 1;
      this.busy = true;
      this.error = null;
      this.render();
      await this.loadContent(false);
      this.busy = false;
      this.render();
      return;
    }
    if (form.matches("[data-visit-settings]")) {
      await this.execute(() => authoringRepository.updateVisit(this.visitId, {
        presentationBaseline: {
          depthPreference: asNullableNumber(data.get("depthPreference")),
          languageComplexityPreference: asNullableNumber(data.get("languageComplexityPreference")),
          locale: String(data.get("locale") || "").trim() || null,
        },
      }), "Impostazioni della visita salvate");
      return;
    }
    if (form.matches("[data-visit-logistics]")) {
      const preVisitNotes = String(data.get("preVisitNotes") || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      await this.execute(() => authoringRepository.updateVisit(this.visitId, {
        logistics: { preVisitNotes, routeHints: this.serializeRouteHints() },
      }), "Indicazioni pre-visita salvate");
      return;
    }
    if (form.matches("[data-intervenue-transfer]")) {
      const fromAnchorId = String(data.get("fromAnchorId") || "");
      const toAnchorId = String(data.get("toAnchorId") || "");
      const transferMinutes = Number(data.get("transferMinutes"));
      if (!Number.isFinite(transferMinutes) || transferMinutes <= 0) { this.error = "Indica una durata positiva per il trasferimento."; this.render(); return; }
      await this.execute(() => authoringRepository.setVisitInterVenueTransfer(this.visitId, fromAnchorId, toAnchorId, {
        estimatedTransferSeconds: Math.round(transferMinutes * 60),
        instructionOverride: String(data.get("instructionOverride") || "").trim() || null,
      }), "Trasferimento tra sedi aggiornato");
      return;
    }
    if (form.matches("[data-workflow-form]")) {
      const operationCode = String(data.get("operationCode") || "");
      const operation = this.availableOperation(operationCode);
      if (!operation || !String(operationCode).startsWith("workflow.")) return;
      const text = operation.requiresMessage ? String(data.get("message") || "").trim() : "";
      if (operation.requiresMessage && !text) { this.error = "Scrivi la motivazione delle modifiche richieste"; this.render(); return; }
      await this.execute(async () => marketplaceRepository.executeWorkspaceOperation({
        operationCode,
        sourceRef: { resourceType: "visit", resourceId: this.visitId },
        targetPrincipal: { type: this.principal.type, id: this.principal.id },
        payload: text ? { message: text } : {},
      }), workflowNotice(operationCode));
      this.activeStep = 5;
    }
  };

  onChange = async (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-source-filter]")) {
      this.selectedSourceKey = target.value || "all";
      this.page = 1;
      this.pendingOccurrence = null;
      this.busy = true; this.render(); await this.loadContent(false); this.busy = false; this.render();
      return;
    }
    if (target.matches("[data-content-venue]")) {
      this.selectedContentVenueId = target.value || null;
      this.page = 1;
      this.pendingOccurrence = null;
      this.busy = true; this.render(); await this.loadContent(false); this.busy = false; this.render();
      return;
    }
    if (target.matches("[data-venue]")) {
      this.selectedVenueId = target.value || null;
      this.busy = true; this.render(); await this.loadVenueTargets(false); this.busy = false; this.render();
      return;
    }
    if (target.matches("[data-entry-role]")) {
      await this.execute(() => authoringRepository.setVisitContentRole(this.visitId, target.dataset.entryRole, target.value), "Importanza del contenuto aggiornata");
      return;
    }
    if (target.matches("[data-entry-stop]")) {
      const entryId = target.dataset.entryStop;
      const nextAnchorId = target.value || null;
      const entry = (this.revision?.entries || []).find((candidate) => id(candidate.id) === id(entryId));
      if (!entry || id(entry.deliveryAnchorId) === id(nextAnchorId)) return;
      if (nextAnchorId) {
        await this.execute(() => authoringRepository.attachVisitContentToStop(this.visitId, entryId, nextAnchorId), "Collocazione del contenuto aggiornata");
      } else {
        await this.execute(() => authoringRepository.detachVisitContentFromStop(this.visitId, entryId), "Il contenuto resta contestuale nella visita");
      }
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("button[data-back]")) { navigate("/workspace"); return; }
    const stepButton = target.closest("button[data-step]");
    if (stepButton) {
      const step = Number(stepButton.dataset.step) || 1;
      if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.render(); }
      return;
    }
    const pageButton = target.closest("button[data-content-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.contentPage) || 1);
      this.busy = true; this.render(); await this.loadContent(false); this.busy = false; this.render(); return;
    }
    const accessButton = target.closest("button[data-content-access]");
    if (accessButton) {
      this.contentAccess = accessButton.dataset.contentAccess || "all";
      this.page = 1;
      this.pendingOccurrence = null;
      this.busy = true; this.render(); await this.loadContent(false); this.busy = false; this.render(); return;
    }
    const addButton = target.closest("button[data-add-content]");
    if (addButton) {
      const result = (this.content?.results || []).find((entry) => id(entry.itemRevisionId) === id(addButton.dataset.addContent));
      if (result) await this.addSelectedContent(result);
      return;
    }
    const occurrenceButton = target.closest("button[data-occurrence-target]");
    if (occurrenceButton && this.pendingOccurrence) {
      await this.addSelectedContent(this.pendingOccurrence.result, occurrenceButton.dataset.occurrenceTarget);
      return;
    }
    if (target.closest("button[data-cancel-occurrence]")) { this.pendingOccurrence = null; this.message = null; this.render(); return; }
    const removeContent = target.closest("button[data-remove-content]");
    if (removeContent) { await this.execute(() => authoringRepository.removeVisitContent(this.visitId, removeContent.dataset.removeContent), "Contenuto rimosso dalla visita", { refreshContent: true }); return; }
    const moveContent = target.closest("button[data-move-content]");
    if (moveContent) {
      const entryId = moveContent.dataset.moveContent;
      const anchorKey = moveContent.dataset.anchorKey || "contextual";
      const siblings = anchorKey === "contextual" ? this.contextualEntries() : this.entriesForAnchor(anchorKey);
      const index = siblings.findIndex((entry) => id(entry.id) === id(entryId));
      const toIndex = index + (Number(moveContent.dataset.direction) || 0);
      if (index < 0 || toIndex < 0 || toIndex >= siblings.length) return;
      await this.execute(() => visitSequenceRepository.reorderContent(this.visitId, entryId, toIndex), "Ordine dei contenuti aggiornato");
      return;
    }
    const moveStop = target.closest("button[data-move-stop]");
    if (moveStop) {
      const stops = this.revision?.stops || [];
      const index = stops.findIndex((stop) => id(stop.id) === id(moveStop.dataset.moveStop));
      const toIndex = index + (Number(moveStop.dataset.direction) || 0);
      if (index < 0 || toIndex < 0 || toIndex >= stops.length) return;
      await this.execute(() => authoringRepository.reorderVisitStop(this.visitId, stops[index].id, toIndex), "Ordine delle tappe aggiornato");
      return;
    }
    const removeStop = target.closest("button[data-remove-stop]");
    if (removeStop) { await this.execute(() => authoringRepository.removeVisitStop(this.visitId, removeStop.dataset.removeStop), "Tappa rimossa; i contenuti associati restano contestuali"); return; }
    const addStop = target.closest("button[data-add-stop]");
    if (addStop) { await this.execute(() => authoringRepository.addVisitStop(this.visitId, addStop.dataset.addStop), "Tappa aggiunta alla visita"); return; }
    const fixButton = target.closest("button[data-fix-href]");
    if (fixButton) navigate(fixButton.dataset.fixHref);
  };

  onDragStart = (event) => {
    const source = event.target instanceof Element ? event.target.closest("[data-drag-kind]") : null;
    if (!source || !this.editable || this.busy) return;
    const kind = source.dataset.dragKind;
    if (kind === "stop") {
      this.dragState = { kind, id: source.dataset.stopId, index: Number(source.dataset.stopIndex) };
    } else if (kind === "content") {
      this.dragState = {
        kind,
        id: source.dataset.contentId,
        index: Number(source.dataset.contentIndex),
        anchorKey: source.dataset.anchorKey || "contextual",
      };
    } else return;
    source.dataset.dragging = "true";
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `${kind}:${this.dragState.id}`);
    }
  };

  onDragOver = (event) => {
    if (!this.dragState) return;
    const target = event.target instanceof Element ? event.target.closest(`[data-drag-kind="${this.dragState.kind}"]`) : null;
    if (!target) return;
    if (this.dragState.kind === "content" && target.dataset.anchorKey !== this.dragState.anchorKey) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };

  onDrop = async (event) => {
    if (!this.dragState) return;
    const target = event.target instanceof Element ? event.target.closest(`[data-drag-kind="${this.dragState.kind}"]`) : null;
    if (!target) { this.dragState = null; return; }
    if (this.dragState.kind === "content" && target.dataset.anchorKey !== this.dragState.anchorKey) { this.dragState = null; this.render(); return; }
    event.preventDefault();
    const state = this.dragState;
    this.dragState = null;
    const toIndex = Number(state.kind === "content" ? target.dataset.contentIndex : target.dataset.stopIndex);
    if (!Number.isInteger(toIndex) || toIndex === state.index) { this.render(); return; }
    if (state.kind === "content") {
      await this.execute(() => visitSequenceRepository.reorderContent(this.visitId, state.id, toIndex), "Ordine dei contenuti aggiornato");
    } else {
      await this.execute(() => authoringRepository.reorderVisitStop(this.visitId, state.id, toIndex), "Ordine delle tappe aggiornato");
    }
  };

  onDragEnd = () => { this.dragState = null; this.render(); };

  renderProgress() {
    const stages = [[1, "Informazioni"], [2, "Costruisci la visita"], [3, "Impostazioni"], [4, "Percorso"], [5, "Pubblicazione"]];
    const currentLabel = stages.find(([step]) => step === this.activeStep)?.[1] || stages[0][1];
    return `<nav class="authoring-progress" aria-label="Passaggi di creazione della visita"><div class="authoring-progress__summary"><span>Passaggio ${this.activeStep} di ${stages.length}</span><strong>${escapeHtml(currentLabel)}</strong></div><ol>${stages.map(([step, label]) => {
      const current = this.activeStep === step;
      return `<li data-current="${current}" data-complete="${this.stepComplete(step)}"><button type="button" data-step="${step}" aria-current="${current ? "step" : "false"}" aria-label="Passaggio ${step}: ${escapeHtml(label)}"><span>${this.stepComplete(step) ? icon("check", { size: 14 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`;
    }).join("")}</ol></nav>`;
  }

  renderCreate() {
    return `<main class="page visit-authoring-page"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Nuova visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>Nuova visita</h1><p>Definisci le informazioni essenziali, poi scegli i contenuti e mettili in ordine.</p></div></header><section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><h2>Come si presenta questa visita?</h2></div></header><form data-create-visit class="editor-form"><label>Titolo<input name="title" required maxlength="160"></label><label>Descrizione<textarea name="description" rows="5"></textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Crea la bozza e scegli i contenuti ${icon("chevron", { size: 15 })}</button></form></section>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</main>`;
  }

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    if (!this.editable) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><h2>${escapeHtml(this.revision?.title || "Visita")}</h2><p>${escapeHtml(this.revision?.description || "Nessuna descrizione")}</p></div></header></section>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Informazioni</span><h2>Presenta la visita</h2></div></header><form data-visit-main class="editor-form"><label>Titolo<input name="title" required maxlength="160" value="${escapeHtml(this.revision?.title || "")}"></label><label>Descrizione<textarea name="description" rows="5">${escapeHtml(this.revision?.description || "")}</textarea></label><div class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>Salva</button><button class="button-secondary" type="button" data-step="2">Costruisci la visita</button></div></form></section>`;
  }

  renderOccurrenceChoice() {
    if (!this.pendingOccurrence) return "";
    return `<section class="occurrence-choice" role="status"><div><strong>Scegli dove si trova l’entità</strong><p>Il contenuto corrisponde a più occorrenze fisiche pubblicate.</p></div><div class="occurrence-grid">${(this.pendingOccurrence.candidates || []).map((candidate) => `<button type="button" class="occurrence-card" data-occurrence-target="${escapeHtml(id(candidate.venueTargetId))}"><strong>${escapeHtml(candidate.label)}</strong><small>${escapeHtml(candidate.venue?.name || "Sede")}</small></button>`).join("")}</div><button class="button-secondary" type="button" data-cancel-occurrence>Annulla</button></section>`;
  }

  renderContentSearch() {
    if (!this.editable) return `<p class="note">La revisione non è modificabile.</p>`;
    const sourceOptions = (this.content?.filters?.sources || []).map((source) => `<option value="${escapeHtml(source.key)}" ${source.key === this.selectedSourceKey ? "selected" : ""}>${escapeHtml(source.label)}</option>`).join("");
    const venueOptions = this.venueChoices().map((venue) => `<option value="${escapeHtml(id(venue.id))}" ${id(venue.id) === id(this.selectedContentVenueId) ? "selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.organizationName)}</option>`).join("");
    const existing = new Set((this.revision?.entries || []).map((entry) => id(entry.itemRevisionId)));
    const cards = (this.content?.results || []).map((result) => {
      const alreadyAdded = existing.has(id(result.itemRevisionId));
      const availability = (result.availability || []).slice(0, 2).map((entry) => `<span class="availability-reason">${escapeHtml(entry.label)}</span>`).join("");
      return `<article class="candidate-card"><div class="candidate-copy"><h3>${escapeHtml(result.label)}</h3><p>${escapeHtml((result.authorCredits || []).join(", ") || "Autore non indicato")}</p><div class="availability-list">${availability}</div></div><button type="button" data-add-content="${escapeHtml(id(result.itemRevisionId))}" ${alreadyAdded || this.busy ? "disabled" : ""}>${alreadyAdded ? `${icon("check", { size: 14 })} Aggiunto` : `${icon("plus", { size: 14 })} Aggiungi`}</button></article>`;
    }).join("");
    const page = Number(this.content?.page) || 1;
    const limit = Number(this.content?.limit) || 20;
    const total = Number(this.content?.total) || 0;
    return `<div class="content-browser">${this.renderOccurrenceChoice()}<form data-visit-search class="search-inline"><label>Cerca contenuti<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo, autore o argomento"></label><button type="submit" ${this.busy ? "disabled" : ""}>${icon("search", { size: 14 })} Cerca</button></form><div class="content-access-filter" role="group" aria-label="Disponibilità dei contenuti"><button type="button" class="${this.contentAccess === "all" ? "" : "button-secondary"}" data-content-access="all">Tutti</button><button type="button" class="${this.contentAccess === "owned" ? "" : "button-secondary"}" data-content-access="owned">Creati da me</button><button type="button" class="${this.contentAccess === "acquired" ? "" : "button-secondary"}" data-content-access="acquired">Acquistati</button></div><details class="advanced-panel filters"><summary>Filtri avanzati</summary><div class="content-filter-bar"><label>Sede<select data-content-venue><option value="">Tutte le sedi</option>${venueOptions}</select></label><label>Fonte<select data-source-filter><option value="all">Tutte le fonti</option>${sourceOptions}</select></label></div></details><div class="candidate-heading"><strong>${total} contenuti disponibili</strong><small>Ogni contenuto compare una sola volta.</small></div><div class="candidate-grid">${cards || `<div class="empty-state compact"><h3>Nessun contenuto trovato</h3><p>Prova a cambiare ricerca o filtri.</p></div>`}</div><nav class="pagination"><button type="button" data-content-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>Precedente</button><span>Pagina ${page}</span><button type="button" data-content-page="${page + 1}" ${page * limit >= total || this.busy ? "disabled" : ""}>Successiva</button></nav></div>`;
  }

  renderEntryCard(entry, index, anchorKey, total) {
    const stops = this.revision?.stops || [];
    return `<article class="sequence-entry" draggable="${this.editable && !this.busy}" data-drag-kind="content" data-content-id="${escapeHtml(entry.id)}" data-content-index="${index}" data-anchor-key="${escapeHtml(anchorKey)}"><span class="drag-handle" aria-hidden="true">⋮⋮</span><div class="entry-copy"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml((entry.authorCredits || []).join(", ") || entry.source?.name || "Contenuto")}</small></div>${this.editable ? `<div class="entry-controls"><label>Importanza<select data-entry-role="${escapeHtml(entry.id)}"><option value="core" ${entry.role === "core" ? "selected" : ""}>Essenziale</option><option value="recommended" ${entry.role === "recommended" ? "selected" : ""}>Consigliato</option><option value="optional" ${entry.role === "optional" ? "selected" : ""}>Facoltativo</option></select></label><label>Presenta in<select data-entry-stop="${escapeHtml(entry.id)}"><option value="" ${!entry.deliveryAnchorId ? "selected" : ""}>Contesto generale</option>${stops.map((stop) => `<option value="${escapeHtml(stop.id)}" ${id(stop.id) === id(entry.deliveryAnchorId) ? "selected" : ""}>${escapeHtml(stop.label)} · ${escapeHtml(stop.venue?.name || "Sede")}</option>`).join("")}</select></label><div class="compact-actions"><button class="button-secondary icon-button" type="button" data-move-content="${escapeHtml(entry.id)}" data-anchor-key="${escapeHtml(anchorKey)}" data-direction="-1" aria-label="Sposta contenuto prima" ${index === 0 || this.busy ? "disabled" : ""}>↑</button><button class="button-secondary icon-button" type="button" data-move-content="${escapeHtml(entry.id)}" data-anchor-key="${escapeHtml(anchorKey)}" data-direction="1" aria-label="Sposta contenuto dopo" ${index === total - 1 || this.busy ? "disabled" : ""}>↓</button><button class="button-secondary danger" type="button" data-remove-content="${escapeHtml(entry.id)}">Rimuovi</button></div></div>` : `<span class="chip">${escapeHtml(roleLabel(entry.role))}</span>`}</article>`;
  }

  renderStopGroup(stop, stopIndex, stopTotal) {
    const entries = this.entriesForAnchor(stop.id);
    return `<section class="sequence-group" draggable="${this.editable && !this.busy}" data-drag-kind="stop" data-stop-id="${escapeHtml(stop.id)}" data-stop-index="${stopIndex}"><header><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="sequence-index">${stopIndex + 1}</span><div><strong>${escapeHtml(stop.label)}</strong><small>${escapeHtml(stop.venue?.name || "Sede")}</small></div>${this.editable ? `<div class="compact-actions"><button class="button-secondary icon-button" type="button" data-move-stop="${escapeHtml(stop.id)}" data-direction="-1" aria-label="Sposta tappa prima" ${stopIndex === 0 || this.busy ? "disabled" : ""}>↑</button><button class="button-secondary icon-button" type="button" data-move-stop="${escapeHtml(stop.id)}" data-direction="1" aria-label="Sposta tappa dopo" ${stopIndex === stopTotal - 1 || this.busy ? "disabled" : ""}>↓</button><button class="button-secondary danger" type="button" data-remove-stop="${escapeHtml(stop.id)}">Rimuovi tappa</button></div>` : ""}</header><div class="sequence-entry-list">${entries.length ? entries.map((entry, index) => this.renderEntryCard(entry, index, id(stop.id), entries.length)).join("") : `<p class="note">Tappa senza contenuti associati.</p>`}</div></section>`;
  }

  renderManualStopBrowser({ open = false } = {}) {
    if (!this.editable) return "";
    const venueOptions = this.venueChoices().map((venue) => `<option value="${escapeHtml(id(venue.id))}" ${id(venue.id) === id(this.selectedVenueId) ? "selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.organizationName)}</option>`).join("");
    const used = new Set((this.revision?.stops || []).map((stop) => id(stop.venueTargetId)));
    const targets = (this.venueTargets?.targets || []).filter((entry) => !used.has(id(entry.id)));
    return `<details class="advanced-panel manual-stops" ${open ? "open" : ""}><summary>${open ? "Aggiungi la prima tappa" : "Opzioni avanzate"}</summary><h4>Aggiungi una tappa fisica</h4><p class="note">Scegli un’opera o un punto della sede in cui il visitatore dovrà fermarsi.</p><label>Sede<select data-venue>${venueOptions || "<option value=''>Nessuna sede disponibile</option>"}</select></label><div class="target-grid">${targets.map((entry) => `<article class="target-card"><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.subject?.preferredLabel || entry.description || "Entità fisica")}</small></div><button type="button" data-add-stop="${escapeHtml(id(entry.id))}">Aggiungi tappa</button></article>`).join("") || `<p class="note">Nessuna entità fisica pubblicata disponibile in questa sede.</p>`}</div></details>`;
  }

  renderVisitSequence() {
    const stops = this.revision?.stops || [];
    const contextual = this.contextualEntries();
    if (!(this.revision?.entries || []).length && !stops.length) return `<div class="empty-state compact"><h3>La visita è ancora vuota</h3><p>Aggiungi un contenuto dalla ricerca.</p></div>${this.renderManualStopBrowser()}`;
    const missingStop = !stops.length ? `<div class="missing-stop-notice" role="status"><strong>Manca ancora una tappa fisica</strong><p>I contenuti generali possono accompagnare la visita, ma per completarla serve almeno un luogo in cui fermarsi. Sceglilo qui sotto.</p></div>` : "";
    return `<div class="visit-sequence">${missingStop}${stops.map((stop, index) => this.renderStopGroup(stop, index, stops.length)).join("")}${contextual.length ? `<section class="sequence-group contextual-group"><header><div><strong>Contesto generale</strong><small>Contenuti senza una tappa fisica specifica</small></div></header><div class="sequence-entry-list">${contextual.map((entry, index) => this.renderEntryCard(entry, index, "contextual", contextual.length)).join("")}</div></section>` : ""}${this.renderManualStopBrowser({ open: !stops.length })}</div>`;
  }

  renderStepTwo() {
    if (this.activeStep !== 2) return "";
    const count = (this.revision?.entries || []).length;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Costruisci la visita</span><h2>Trova i contenuti, aggiungili e mettili in ordine</h2><p>ArtAround propone la collocazione fisica quando è univoca. Trascina le tappe o i contenuti della stessa tappa per cambiare la sequenza.</p></div><span class="count">${count}</span></header><div class="visit-content-composer"><section class="available-content-pane" aria-label="Contenuti disponibili">${this.renderContentSearch()}</section><aside class="visit-selection-pane" aria-label="Sequenza della visita"><header><span class="eyebrow">La tua visita</span><h3>${escapeHtml(this.revision?.title || "Visita")}</h3><p>${count} ${count === 1 ? "contenuto" : "contenuti"}</p></header>${this.renderVisitSequence()}</aside></div><div class="step-actions"><button class="button-secondary" type="button" data-step="1">Indietro</button><button type="button" data-step="3">Continua alle impostazioni ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderStepThree() {
    if (this.activeStep !== 3) return "";
    const baseline = this.revision?.presentationBaseline || {};
    const content = this.editable ? `<form data-visit-settings class="editor-form"><label>Profondità preferita<input name="depthPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.depthPreference ?? "")}"></label><label>Complessità del linguaggio<input name="languageComplexityPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.languageComplexityPreference ?? "")}"></label><label>Lingua preferita<input name="locale" value="${escapeHtml(baseline.locale || "")}" placeholder="es. it-IT"></label><button type="submit" ${this.busy ? "disabled" : ""}>Salva impostazioni</button></form>` : `<div class="review-grid"><article><span>Profondità</span><strong>${escapeHtml(baseline.depthPreference ?? "Non impostata")}</strong></article><article><span>Linguaggio</span><strong>${escapeHtml(baseline.languageComplexityPreference ?? "Non impostato")}</strong></article><article><span>Lingua</span><strong>${escapeHtml(baseline.locale || "Non impostata")}</strong></article></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Impostazioni</span><h2>Imposta il livello di partenza</h2><p>Queste preferenze guidano l'esecuzione senza duplicare i contenuti.</p></div></header>${content}<div class="step-actions"><button class="button-secondary" type="button" data-step="2">Indietro</button><button type="button" data-step="4">Controlla il percorso</button></div></section>`;
  }

  renderRouteBlocker(blocker) {
    return `<li><div><strong>${escapeHtml(blocker.message || blocker.code)}</strong></div>${blocker.fixHref ? `<button class="button-secondary" type="button" data-fix-href="${escapeHtml(blocker.fixHref)}">Correggi in Spazi e mappa</button>` : ""}</li>`;
  }
  renderRouteLeg(leg) {
    const from = leg.fromStop;
    const to = leg.toStop;
    const heading = `${from?.label || "Tappa"} → ${to?.label || "Tappa"}`;
    if (leg.type === "inter_venue") {
      const ready = leg.status === "ready";
      return `<article class="route-leg" data-status="${escapeHtml(leg.status)}"><div><span class="chip">Trasferimento tra sedi</span><h4>${escapeHtml(heading)}</h4>${ready ? `<p>${minutes(leg.estimatedSeconds)} min${leg.instruction ? ` · ${escapeHtml(leg.instruction)}` : ""}</p>` : `<p>Serve una stima esplicita.</p>`}</div>${this.editable ? `<form data-intervenue-transfer class="transfer-form"><input type="hidden" name="fromAnchorId" value="${escapeHtml(leg.fromAnchorId)}"><input type="hidden" name="toAnchorId" value="${escapeHtml(leg.toAnchorId)}"><label>Minuti<input name="transferMinutes" type="number" min="1" step="1" required value="${escapeHtml(minutes(leg.estimatedSeconds) || "")}"></label><label>Indicazione opzionale<input name="instructionOverride" value="${escapeHtml(leg.instruction || "")}"></label><button type="submit">Salva</button></form>` : ""}</article>`;
    }
    return `<article class="route-leg" data-status="${escapeHtml(leg.status)}"><div><span class="chip">Percorso nella sede</span><h4>${escapeHtml(heading)}</h4><p>${leg.status === "ready" ? `${leg.distanceMeters ?? 0} m · circa ${minutes(leg.estimatedSeconds) || 0} min` : "Il percorso non è verificabile."}</p></div></article>`;
  }

  renderStepFour() {
    if (this.activeStep !== 4) return "";
    const notes = (this.revision?.logistics?.preVisitNotes || []).join("\n");
    const review = this.revision?.routeReview || { status: "not_available", legs: [], blockers: [] };
    const notesUi = this.editable ? `<form data-visit-logistics class="editor-form"><label>Indicazioni prima della visita<textarea name="preVisitNotes" rows="5">${escapeHtml(notes)}</textarea></label><button type="submit">Salva indicazioni</button></form>` : `<p>${escapeHtml(notes || "Nessuna indicazione specifica.")}</p>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Percorso</span><h2>Verifica la logistica</h2><p>Il percorso deriva dalle tappe fisiche della visita e dalla configurazione pubblicata delle sedi.</p></div></header>${review.blockers?.length ? `<div class="issue-panel"><strong>Blocchi del percorso</strong><ul class="route-blockers">${review.blockers.map((entry) => this.renderRouteBlocker(entry)).join("")}</ul></div>` : `<div class="readiness success">${icon("check", { size: 18 })}<div><strong>Percorso verificabile</strong></div></div>`}<div class="route-leg-list">${(review.legs || []).map((leg) => this.renderRouteLeg(leg)).join("") || `<p class="note">Non ci sono ancora due tappe da collegare.</p>`}</div><div class="subsection"><h3>Informazioni prima della visita</h3>${notesUi}</div><div class="step-actions"><button class="button-secondary" type="button" data-step="3">Indietro</button><button type="button" data-step="5">Vai al riepilogo</button></div></section>`;
  }

  reviewSummary() {
    const entries = this.revision?.entries || [];
    const stops = this.revision?.stops || [];
    const roles = { core: 0, recommended: 0, optional: 0 };
    for (const entry of entries) roles[entry.role || "recommended"] = (roles[entry.role || "recommended"] || 0) + 1;
    const venues = [...new Set(stops.map((stop) => stop.venue?.name).filter(Boolean))];
    return `<div class="review-grid"><article><span>Contenuti</span><strong>${entries.length}</strong><small>${roles.core} essenziali · ${roles.recommended} consigliati · ${roles.optional} facoltativi</small></article><article><span>Tappe</span><strong>${stops.length}</strong></article><article><span>Sedi</span><strong>${venues.length}</strong><small>${escapeHtml(venues.join(", ") || "Nessuna")}</small></article><article><span>Percorso</span><strong>${escapeHtml(this.revision?.routeReview?.status === "ready" ? "Verificabile" : "Da controllare")}</strong></article><article><span>Stato</span><strong>${escapeHtml(this.revision?.status || "draft")}</strong></article></div>`;
  }
  renderWorkflowOperation(operation) {
    if (operation.requiresMessage) return `<form data-workflow-form class="workflow-message-form"><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><label>Motivazione<textarea name="message" rows="3" required></textarea></label><button class="button-secondary" type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
  }
  renderStepFive() {
    if (this.activeStep !== 5) return "";
    const issues = this.revision?.integrity?.issues || [];
    const operations = this.workflowOperations();
    const routeBlockers = this.revision?.routeReview?.blockers || [];
    const visitStructureMissing = issues.some((issue) => ["EMPTY_VISIT_CONTENT", "EMPTY_PHYSICAL_ITINERARY"].includes(issue.code));
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">5</span><div><span class="eyebrow">Riepilogo e pubblicazione</span><h2>Controlla la visita</h2><p>La pubblicazione nel Catalogo è un passaggio commerciale separato. Pubblicare editorialmente non crea automaticamente una scheda nel Marketplace.</p></div></header>${this.reviewSummary()}${routeBlockers.length ? `<div class="issue-panel"><strong>Il percorso ha ancora ${routeBlockers.length} blocco/i</strong><button class="button-secondary" type="button" data-step="4">Torna al percorso</button></div>` : ""}${issues.length ? `<div class="issue-panel"><strong>Cosa manca per completare la visita</strong><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul>${visitStructureMissing ? `<button class="button-secondary" type="button" data-step="2">Torna a contenuti e tappe</button>` : ""}</div>` : ""}<div class="workflow-panel"><div><h3>Azioni disponibili</h3><p class="note">Il controllo autorevole di pubblicazione resta backend-side.</p></div><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("") || `<p>Nessuna azione disponibile.</p>`}</div></div></section>`;
  }

  render() {
    if (this.busy && !this.projection) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione dell'editor visita…</p></div></main>`; return; }
    if (!this.projection) { this.innerHTML = `<main class="page"><p role="alert">${escapeHtml(this.error || "Editor visita non disponibile")}</p></main>`; return; }
    if (!this.visitId) { this.innerHTML = this.styles() + this.renderCreate(); return; }
    this.innerHTML = `${this.styles()}<main class="page visit-authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>${escapeHtml(this.revision?.title || "Visita")}</h1><p>Cerca i contenuti, aggiungili e costruisci una sequenza eseguibile nello spazio.</p></div></header>${this.renderProgress()}${this.busy ? `<p role="status">Salvataggio…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.message ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}${this.renderStepFive()}</main>`;
  }

  styles() {
    return `<style>
      :host{display:block}.visit-authoring-page{display:grid;gap:1rem;max-width:var(--content);margin:auto;padding:2rem 1rem 5rem}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem;align-items:flex-start}.step-number,.sequence-index{display:grid;place-items:center;flex:0 0 1.8rem;height:1.8rem;border-radius:999px;background:var(--ink-900);color:#fff}.editor-form{display:grid;gap:.9rem;max-width:52rem;margin-top:1rem}.step-actions,.workflow-actions,.compact-actions{display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;margin-top:.8rem}
      .authoring-progress{overflow:auto}.authoring-progress ol{display:grid;grid-template-columns:repeat(5,minmax(7rem,1fr));gap:.55rem;min-width:35rem;margin:0;padding:0;list-style:none}.authoring-progress__summary{display:none}.authoring-progress button{display:flex;width:100%;align-items:center;gap:.5rem;padding:.65rem;border:1px solid var(--line);border-radius:.7rem;background:var(--surface);color:var(--ink-800)}.authoring-progress li[data-current=true] button{background:var(--ink-900);color:#fff}.authoring-progress button>span{display:grid;place-items:center;flex:0 0 1.7rem;height:1.7rem;border-radius:999px;background:var(--sage-100);color:var(--ink-800)}
      .visit-content-composer{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(22rem,1fr);gap:1rem;align-items:start;margin-top:1.25rem}.available-content-pane,.visit-selection-pane{min-width:0;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--sage-50);padding:1rem}.visit-selection-pane{position:sticky;top:calc(var(--header-height) + 1rem);max-height:calc(100vh - var(--header-height) - 2rem);overflow:auto}.visit-selection-pane>header{padding-bottom:.75rem;border-bottom:1px solid var(--line)}
      .content-browser,.candidate-grid,.visit-sequence,.sequence-entry-list,.target-grid,.route-leg-list{display:grid;gap:.7rem}.search-inline{display:grid;grid-template-columns:1fr auto;gap:.65rem;align-items:end}.content-access-filter{display:flex;gap:.4rem;flex-wrap:wrap}.content-filter-bar{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.7rem}.candidate-heading{display:flex;justify-content:space-between;gap:1rem;align-items:end}.candidate-card,.sequence-entry,.target-card,.route-leg{display:grid;gap:.7rem;align-items:center;padding:.9rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface)}.candidate-card{grid-template-columns:minmax(0,1fr) auto}.candidate-copy h3,.candidate-copy p{margin:.15rem 0}.availability-list{display:flex;gap:.35rem;flex-wrap:wrap}.availability-reason,.chip{display:inline-flex;width:max-content;border-radius:999px;padding:.22rem .5rem;background:var(--sage-100);font-size:.72rem;font-weight:700}
      .sequence-group{padding:.8rem;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface)}.sequence-group>header{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:.55rem;align-items:center}.sequence-group>header small,.sequence-entry small{display:block;color:var(--sage-600)}.sequence-entry{grid-template-columns:auto minmax(0,1fr);margin-top:.55rem}.entry-controls{grid-column:2;display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.entry-controls .compact-actions{grid-column:1/-1;margin-top:0}.drag-handle{cursor:grab;color:var(--sage-600);font-weight:900;letter-spacing:-.18rem;padding-right:.18rem}.sequence-group[data-dragging=true],.sequence-entry[data-dragging=true]{opacity:.45}.contextual-group{border-style:dashed}.icon-button{min-width:2.25rem;padding:.4rem}.danger{color:var(--red-700)}
      .advanced-panel{padding:.8rem;border:1px dashed var(--line-strong);border-radius:var(--radius-md);background:var(--surface)}.manual-stops{margin-top:.8rem}.missing-stop-notice{padding:.9rem;border:1px solid var(--amber-500);border-radius:var(--radius-md);background:var(--amber-100)}.missing-stop-notice p{margin:.3rem 0 0}.target-grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:.7rem}.target-card{grid-template-columns:1fr auto}.occurrence-choice{display:grid;gap:.75rem;padding:1rem;border:1px solid var(--amber-500);border-radius:var(--radius-md);background:var(--amber-100)}.occurrence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}.occurrence-card{display:grid;text-align:left;padding:.8rem}
      .pagination{display:flex;justify-content:space-between;align-items:center}.route-blockers{display:grid;gap:.6rem;padding:0;list-style:none}.route-blockers li{display:flex;justify-content:space-between;gap:.75rem;align-items:center}.transfer-form{display:grid;grid-template-columns:8rem minmax(12rem,1fr) auto;gap:.6rem;align-items:end}.review-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;margin-top:1rem}.review-grid article{display:grid;gap:.18rem;padding:.8rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface)}.readiness,.issue-panel,.workflow-panel{margin-top:1rem;padding:1rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--sage-50)}.workflow-panel{display:grid;grid-template-columns:minmax(12rem,.75fr) minmax(0,1.25fr);gap:1rem}.note{color:var(--sage-600)}
      @media(max-width:68rem){.visit-content-composer{grid-template-columns:1fr}.visit-selection-pane{position:static;max-height:none}.entry-controls,.workflow-panel,.transfer-form{grid-template-columns:1fr}.target-grid,.occurrence-grid{grid-template-columns:1fr}.sequence-group>header{grid-template-columns:auto auto 1fr}.sequence-group>header .compact-actions{grid-column:1/-1}}
      @media(max-width:48rem){.authoring-progress ol{grid-template-columns:repeat(5,minmax(0,1fr));min-width:0}.authoring-progress button strong{font-size:.62rem}.search-inline,.content-filter-bar{grid-template-columns:1fr}}
      @media(max-width:32rem){.authoring-progress__summary{display:grid;gap:.1rem}.authoring-progress button strong{display:none}}
    </style>`;
  }
}

customElements.define("artaround-visit-authoring-view", ArtAroundVisitAuthoringView);
