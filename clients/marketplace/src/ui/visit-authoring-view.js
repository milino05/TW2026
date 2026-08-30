import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
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
    step: Math.max(1, Math.min(6, Number(params.get("step")) || 1)),
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
  selectedReleaseId = null;
  selectedVenueId = null;
  activeStep = 1;
  activeContentStopId = null;
  pendingOccurrence = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("change", this.onChange);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("change", this.onChange);
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
  sourceChoices() {
    const values = new Map();
    for (const source of this.projection?.editorialSources || []) values.set(id(source.editorialReleaseId), source);
    for (const source of this.revision?.editorialSources || []) {
      const key = id(source.editorialReleaseId);
      if (!values.has(key)) values.set(key, {
        editorialContextId: source.editorialContextId,
        editorialReleaseId: source.editorialReleaseId,
        name: source.name,
        summary: "Raccolta già collegata alla visita",
        ownership: "current_visit",
        versionMode: "pinned",
      });
    }
    return [...values.values()];
  }
  venueChoices() {
    return (this.projection?.venueSelector?.organizations || []).flatMap((organization) =>
      (organization.venues || []).map((venue) => ({ ...venue, organizationName: organization.name }))
    );
  }
  stopById(anchorId) {
    return (this.revision?.stops || []).find((stop) => id(stop.id) === id(anchorId)) || null;
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
      const sources = this.sourceChoices();
      if (!sources.some((source) => id(source.editorialReleaseId) === id(this.selectedReleaseId))) {
        this.selectedReleaseId = id(this.revision?.editorialSources?.[0]?.editorialReleaseId || sources[0]?.editorialReleaseId || "") || null;
        this.page = 1;
      }
      const venues = this.venueChoices();
      if (!venues.some((venue) => id(venue.id) === id(this.selectedVenueId))) {
        this.selectedVenueId = id(this.revision?.stops?.[0]?.venue?.id || venues[0]?.id || "") || null;
      }
      await Promise.all([this.loadVenueTargets(false), this.loadContent(false)]);
      if (this.visitId) {
        const requested = currentParams().step;
        this.activeStep = this.canOpenStep(requested) ? requested : (this.revision?.status === "published" ? 6 : 1);
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
    if (this.activeContentStopId && !this.stopById(this.activeContentStopId)) this.activeContentStopId = null;
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
    if (!this.selectedReleaseId || !this.principal || !this.visitId) {
      this.content = null;
      if (render) this.render();
      return;
    }
    try {
      this.content = await authoringRepository.searchVisitContent({
        editorialReleaseId: this.selectedReleaseId,
        principalType: this.principal.type,
        principalId: this.principal.id,
        q: this.query,
        page: this.page,
        limit: 20,
      });
    } catch (error) {
      this.content = null;
      if (render) this.error = error instanceof Error ? error.message : "Contenuti della raccolta non disponibili";
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

  async addSelectedContent(result, role, venueTargetId = null) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const payload = {
        editorialReleaseId: this.selectedReleaseId,
        itemEditionId: result.itemEditionId,
        itemRevisionId: result.itemRevisionId,
        role,
        ...(venueTargetId ? { venueTargetId } : {}),
      };
      const response = this.activeContentStopId
        ? await authoringRepository.addVisitContentToStop(this.visitId, this.activeContentStopId, payload)
        : await authoringRepository.addVisitContent(this.visitId, payload);
      this.pendingOccurrence = null;
      await this.reloadProjection();
      await this.loadContent(false);
      const inference = response?.command?.inference?.status;
      this.message = inference === "inferred"
        ? "Contenuto aggiunto e tappa fisica riconosciuta automaticamente."
        : inference === "selected_occurrence"
          ? "Contenuto aggiunto all'occorrenza scelta."
          : inference === "explicit_stop"
            ? "Contenuto aggiunto direttamente alla tappa."
            : "Contenuto aggiunto come contenuto contestuale, senza inventare una tappa fisica.";
    } catch (error) {
      if (!this.activeContentStopId && error?.code === "VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED") {
        const candidates = error.details?.find((detail) => detail.code === "VISIT_CONTENT_OCCURRENCE_SELECTION_REQUIRED")?.context?.candidates || [];
        this.pendingOccurrence = { result, role, candidates };
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
    if ([1, 2, 4, 5, 6].includes(step)) return true;
    if (step === 3) return (this.revision?.entries || []).length > 0;
    return false;
  }
  stepComplete(step) {
    if (step === 1) return Boolean(this.revision?.title);
    if (step === 2) return (this.revision?.entries || []).length > 0;
    if (step === 3) return (this.revision?.stops || []).length > 0;
    if (step === 4) return Boolean(this.revision?.presentationBaseline);
    if (step === 5) return this.revision?.routeReview?.status === "ready";
    if (step === 6) return this.revision?.status === "published";
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
      this.activeStep = 6;
    }
  };

  onChange = async (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-source]")) {
      this.selectedReleaseId = target.value || null;
      this.page = 1;
      this.pendingOccurrence = null;
      this.busy = true;
      this.render();
      await this.loadContent(false);
      this.busy = false;
      this.render();
      return;
    }
    if (target.matches("[data-venue]")) {
      this.selectedVenueId = target.value || null;
      this.busy = true;
      this.render();
      await this.loadVenueTargets(false);
      this.busy = false;
      this.render();
      return;
    }
    if (target.matches("[data-entry-role]")) {
      await this.execute(() => authoringRepository.setVisitContentRole(this.visitId, target.dataset.entryRole, target.value), "Importanza del contenuto aggiornata");
      return;
    }
    if (target.matches("[data-attach-contextual]")) {
      if (!target.value) return;
      await this.execute(() => authoringRepository.attachVisitContentToStop(this.visitId, target.dataset.attachContextual, target.value), "Contenuto collegato alla tappa scelta");
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
    const addButton = target.closest("button[data-add-content]");
    if (addButton) {
      const result = (this.content?.results || []).find((entry) => id(entry.itemRevisionId) === id(addButton.dataset.addContent));
      if (!result) return;
      const role = addButton.closest("article")?.querySelector("select[data-add-role]")?.value || "recommended";
      await this.addSelectedContent(result, role);
      return;
    }
    const occurrenceButton = target.closest("button[data-occurrence-target]");
    if (occurrenceButton && this.pendingOccurrence) {
      await this.addSelectedContent(this.pendingOccurrence.result, this.pendingOccurrence.role, occurrenceButton.dataset.occurrenceTarget);
      return;
    }
    if (target.closest("button[data-cancel-occurrence]")) { this.pendingOccurrence = null; this.message = null; this.render(); return; }
    const removeContent = target.closest("button[data-remove-content]");
    if (removeContent) { await this.execute(() => authoringRepository.removeVisitContent(this.visitId, removeContent.dataset.removeContent), "Contenuto rimosso dalla visita", { refreshContent: true }); return; }
    const detachContent = target.closest("button[data-detach-content]");
    if (detachContent) { await this.execute(() => authoringRepository.detachVisitContentFromStop(this.visitId, detachContent.dataset.detachContent), "Contenuto scollegato dalla tappa: resta nella visita come contenuto contestuale"); return; }
    const browseForStop = target.closest("button[data-content-for-stop]");
    if (browseForStop) { this.activeContentStopId = browseForStop.dataset.contentForStop; this.activeStep = 2; this.pendingOccurrence = null; this.render(); return; }
    if (target.closest("button[data-content-for-route]")) { this.activeContentStopId = null; this.render(); return; }
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
    if (removeStop) { await this.execute(() => authoringRepository.removeVisitStop(this.visitId, removeStop.dataset.removeStop), "Tappa rimossa; i contenuti associati restano nella visita come contestuali"); return; }
    const addStop = target.closest("button[data-add-stop]");
    if (addStop) { await this.execute(() => authoringRepository.addVisitStop(this.visitId, addStop.dataset.addStop), "Tappa aggiunta alla visita"); return; }
    const fixButton = target.closest("button[data-fix-href]");
    if (fixButton) { navigate(fixButton.dataset.fixHref); return; }
  };

  renderProgress() {
    const stages = [[1, "Informazioni"], [2, "Contenuti"], [3, "Tappe"], [4, "Impostazioni"], [5, "Percorso"], [6, "Pubblicazione"]];
    return `<nav class="visit-progress" aria-label="Passaggi di creazione della visita"><ol>${stages.map(([step, label]) => {
      const current = this.activeStep === step;
      const enabled = this.canOpenStep(step);
      const complete = this.stepComplete(step);
      return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${enabled ? "" : "disabled"} aria-current="${current ? "step" : "false"}"><span>${complete ? icon("check", { size: 13 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`;
    }).join("")}</ol></nav>`;
  }
  renderWorkingContext() {
    if (!this.context) return "";
    return `<div class="working-context surface"><span>Area di lavoro</span><strong>${escapeHtml(this.context.type === "organization" ? this.context.name : "Area personale")}</strong></div>`;
  }
  renderCreate() {
    return `<main class="page visit-authoring-page"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Nuova visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>Nuova visita</h1><p>Definisci le informazioni essenziali; ArtAround collegherà i contenuti alle occorrenze fisiche quando il legame è univoco.</p></div></header>${this.renderWorkingContext()}<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><h2>Come si presenta questa visita?</h2></div></header><form data-create-visit class="editor-form"><label>Titolo<input name="title" required maxlength="160"></label><label>Descrizione<textarea name="description" rows="5"></textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Crea la bozza e scegli i contenuti ${icon("chevron", { size: 15 })}</button></form></section>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</main>`;
  }
  renderStepOne() {
    if (this.activeStep !== 1) return "";
    if (!this.editable) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><h2>${escapeHtml(this.revision?.title || "Visita")}</h2><p>${escapeHtml(this.revision?.description || "Nessuna descrizione")}</p></div></header></section>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Informazioni</span><h2>Presenta la visita</h2></div></header><form data-visit-main class="editor-form"><label>Titolo<input name="title" required maxlength="160" value="${escapeHtml(this.revision?.title || "")}"></label><label>Descrizione<textarea name="description" rows="5">${escapeHtml(this.revision?.description || "")}</textarea></label><div class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>Salva</button><button class="button-secondary" type="button" data-step="2">Continua ai contenuti</button></div></form></section>`;
  }

  renderContentSummary() {
    const entries = this.revision?.entries || [];
    if (!entries.length) return `<div class="empty-state compact"><h3>Nessun contenuto</h3><p>Scegli un contenuto dalla raccolta editoriale.</p></div>`;
    return `<div class="content-summary-list">${entries.map((entry) => `<article class="content-summary-card"><div><strong>${escapeHtml(entry.label)}</strong><small>${entry.deliveryTarget ? `${escapeHtml(entry.deliveryTarget.label)} · ${escapeHtml(entry.deliveryTarget.venue?.name || "Sede")}` : "Contenuto contestuale · nessuna tappa fisica inferita"}</small></div><span class="chip">${escapeHtml(roleLabel(entry.role))}</span></article>`).join("")}</div>`;
  }
  renderOccurrenceChoice() {
    if (!this.pendingOccurrence) return "";
    const candidates = this.pendingOccurrence.candidates || [];
    return `<section class="occurrence-choice" role="status"><div><strong>Scegli dove si trova l’entità</strong><p>Lo stesso Subject ha più occorrenze fisiche pubblicate. ArtAround non ne sceglie una arbitrariamente.</p></div><div class="occurrence-grid">${candidates.map((candidate) => `<button type="button" class="occurrence-card" data-occurrence-target="${escapeHtml(id(candidate.venueTargetId))}"><strong>${escapeHtml(candidate.label)}</strong><small>${escapeHtml(candidate.venue?.name || "Sede")}</small></button>`).join("")}</div><button class="button-secondary" type="button" data-cancel-occurrence>Annulla</button></section>`;
  }
  renderContentSearch() {
    if (!this.editable) return "";
    const sources = this.sourceChoices();
    if (!sources.length) return `<div class="blocker-panel"><strong>Nessuna raccolta editoriale disponibile</strong><p>Serve una raccolta utilizzabile per comporre visite.</p></div>`;
    const sourceOptions = sources.map((source) => `<option value="${escapeHtml(id(source.editorialReleaseId))}" ${id(source.editorialReleaseId) === id(this.selectedReleaseId) ? "selected" : ""}>${escapeHtml(source.name)}${source.ownership === "licensed" ? " · tramite licenza" : ""}</option>`).join("");
    const existing = new Set((this.revision?.entries || []).map((entry) => id(entry.itemRevisionId)));
    const cards = (this.content?.results || []).map((result) => {
      const alreadyAdded = existing.has(id(result.itemRevisionId));
      return `<article class="candidate-card"><div><h3>${escapeHtml(result.label)}</h3><p>${escapeHtml((result.authorCredits || []).join(", ") || "Autore non indicato")}</p><small>${(result.presentationProfiles || []).length} profilo/i di presentazione</small></div><label>Importanza<select data-add-role ${alreadyAdded ? "disabled" : ""}><option value="core">Essenziale</option><option value="recommended" selected>Consigliato</option><option value="optional">Facoltativo</option></select></label><button type="button" data-add-content="${escapeHtml(id(result.itemRevisionId))}" ${alreadyAdded || this.busy ? "disabled" : ""}>${alreadyAdded ? "Già nella visita" : this.activeContentStopId ? "Aggiungi a questa tappa" : "Aggiungi"}</button></article>`;
    }).join("");
    const page = Number(this.content?.page) || 1;
    const limit = Number(this.content?.limit) || 20;
    const total = Number(this.content?.total) || 0;
    const stop = this.stopById(this.activeContentStopId);
    return `<div class="content-browser">${stop ? `<div class="context-box"><strong>Stai aggiungendo contenuti a: ${escapeHtml(stop.label)}</strong><p>${escapeHtml(stop.venue?.name || "Sede")}. Il deliveryAnchor sarà questa tappa anche se il contenuto parla di un altro Subject.</p><button class="button-secondary" type="button" data-content-for-route>Torna all'inferenza automatica</button></div>` : `<div class="context-box"><strong>Collocazione automatica</strong><p>Se il Subject ha una sola occorrenza fisica pubblicata, ArtAround crea o riusa la tappa. Se ne ha più di una ti chiede quale scegliere; se non ne ha, il contenuto resta contestuale.</p></div>`}${this.renderOccurrenceChoice()}<label>Raccolta editoriale<select data-source>${sourceOptions}</select></label><form data-visit-search class="search-inline"><label>Cerca contenuti<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo"></label><button type="submit" ${this.busy ? "disabled" : ""}>Cerca</button></form><p class="note">${total} contenuti disponibili</p><div class="candidate-grid">${cards || `<div class="empty-state compact"><p>Nessun contenuto trovato.</p></div>`}</div><nav class="pagination"><button type="button" data-content-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>Precedente</button><span>Pagina ${page}</span><button type="button" data-content-page="${page + 1}" ${page * limit >= total || this.busy ? "disabled" : ""}>Successiva</button></nav></div>`;
  }
  renderStepTwo() {
    if (this.activeStep !== 2) return "";
    const count = (this.revision?.entries || []).length;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Contenuti</span><h2>Scegli cosa raccontare</h2><p>La collocazione fisica viene inferita dal Subject quando è deterministica; non devi associare manualmente ogni contenuto.</p></div><span class="count">${count}</span></header>${this.renderContentSummary()}${this.renderContentSearch()}<div class="step-actions"><button class="button-secondary" type="button" data-step="1">Indietro</button><button type="button" data-step="3" ${count ? "" : "disabled"}>Rivedi le tappe ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderStopContents(stop) {
    const contents = stop.contents || [];
    if (!contents.length) return `<p class="note">Tappa fisica senza contenuti associati.</p>`;
    return `<div class="stop-content-list">${contents.map((entry) => `<article class="stop-content"><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml((entry.authorCredits || []).join(", ") || "Autore non indicato")}</small></div><label>Importanza<select data-entry-role="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}><option value="core" ${entry.role === "core" ? "selected" : ""}>Essenziale</option><option value="recommended" ${entry.role === "recommended" ? "selected" : ""}>Consigliato</option><option value="optional" ${entry.role === "optional" ? "selected" : ""}>Facoltativo</option></select></label>${this.editable ? `<div class="entry-actions"><button class="button-secondary" type="button" data-detach-content="${escapeHtml(entry.id)}">Scollega dalla tappa</button><button class="button-secondary danger" type="button" data-remove-content="${escapeHtml(entry.id)}">Rimuovi contenuto</button></div>` : ""}</article>`).join("")}</div>`;
  }
  renderStops() {
    const stops = this.revision?.stops || [];
    if (!stops.length) return `<div class="empty-state compact"><h3>Nessuna tappa fisica</h3><p>I contenuti senza occorrenza fisica possono restare contestuali. Per una visita pubblicabile serve almeno una tappa.</p></div>`;
    return `<ol class="stop-list">${stops.map((stop, index) => `<li><article class="stop-card"><header><span class="sequence-index">${index + 1}</span><div><strong>${escapeHtml(stop.label)}</strong><small>${escapeHtml(stop.venue?.name || "Sede non disponibile")}</small></div>${this.editable ? `<div class="stop-actions"><button class="button-secondary" type="button" data-move-stop="${escapeHtml(stop.id)}" data-direction="-1" aria-label="Sposta prima" title="Sposta prima" ${index === 0 || this.busy ? "disabled" : ""}>↑</button><button class="button-secondary" type="button" data-move-stop="${escapeHtml(stop.id)}" data-direction="1" aria-label="Sposta dopo" title="Sposta dopo" ${index === stops.length - 1 || this.busy ? "disabled" : ""}>↓</button><button class="button-secondary danger" type="button" data-remove-stop="${escapeHtml(stop.id)}" ${this.busy ? "disabled" : ""}>Rimuovi tappa</button></div>` : ""}</header>${this.renderStopContents(stop)}${this.editable ? `<button class="button-secondary add-to-stop" type="button" data-content-for-stop="${escapeHtml(stop.id)}">Aggiungi contenuto a questa tappa</button>` : ""}</article></li>`).join("")}</ol>`;
  }
  renderContextualEntries() {
    const entries = this.revision?.contextualEntries || [];
    if (!entries.length) return "";
    const stops = this.revision?.stops || [];
    return `<section class="subsection contextual-section"><h3>Contenuti contestuali</h3><p>Questi contenuti fanno parte della visita ma non hanno una tappa fisica inferita. Puoi lasciarli così oppure scegliere esplicitamente dove presentarli.</p><div class="contextual-list">${entries.map((entry) => `<article><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(roleLabel(entry.role))}</small></div>${this.editable && stops.length ? `<label>Presenta a<select data-attach-contextual="${escapeHtml(entry.id)}"><option value="">Scegli una tappa…</option>${stops.map((stop) => `<option value="${escapeHtml(stop.id)}">${escapeHtml(stop.label)} · ${escapeHtml(stop.venue?.name || "Sede")}</option>`).join("")}</select></label>` : ""}${this.editable ? `<button class="button-secondary danger" type="button" data-remove-content="${escapeHtml(entry.id)}">Rimuovi</button>` : ""}</article>`).join("")}</div></section>`;
  }
  renderManualStopBrowser() {
    if (!this.editable) return "";
    const venues = this.venueChoices();
    const venueOptions = venues.map((venue) => `<option value="${escapeHtml(id(venue.id))}" ${id(venue.id) === id(this.selectedVenueId) ? "selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.organizationName)}</option>`).join("");
    const used = new Set((this.revision?.stops || []).map((stop) => id(stop.venueTargetId)));
    const targets = (this.venueTargets?.targets || []).filter((entry) => !used.has(id(entry.id)));
    return `<details class="advanced-panel"><summary>Aggiungi una tappa fisica esplicita</summary><p>Usa questa opzione per una sosta intenzionale anche prima di associarle un contenuto. Normalmente le tappe vengono create dall'inferenza dei contenuti.</p><label>Sede<select data-venue>${venueOptions || "<option value=''>Nessuna sede disponibile</option>"}</select></label><div class="target-grid">${targets.map((entry) => `<article class="target-card"><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.subject?.preferredLabel || entry.description || "Entità fisica")}</small></div><button type="button" data-add-stop="${escapeHtml(id(entry.id))}">Aggiungi tappa</button></article>`).join("") || `<p class="note">Nessun’altra entità pubblicata disponibile in questa sede.</p>`}</div></details>`;
  }
  renderStepThree() {
    if (this.activeStep !== 3) return "";
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Tappe</span><h2>Rivedi la sequenza fisica</h2><p>Una tappa è un VisitAnchor su un’entità fisica. I contenuti restano entità editoriali separate e vengono proiettati dentro la tappa solo per l'authoring.</p></div></header>${this.renderStops()}${this.renderContextualEntries()}${this.renderManualStopBrowser()}<div class="step-actions"><button class="button-secondary" type="button" data-step="2">Indietro</button><button type="button" data-step="4">Continua alle impostazioni</button></div></section>`;
  }

  renderStepFour() {
    if (this.activeStep !== 4) return "";
    const baseline = this.revision?.presentationBaseline || {};
    const content = this.editable ? `<form data-visit-settings class="editor-form"><label>Profondità preferita<input name="depthPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.depthPreference ?? "")}"></label><label>Complessità del linguaggio<input name="languageComplexityPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.languageComplexityPreference ?? "")}"></label><label>Lingua preferita<input name="locale" value="${escapeHtml(baseline.locale || "")}" placeholder="es. it-IT"></label><button type="submit" ${this.busy ? "disabled" : ""}>Salva impostazioni</button></form>` : `<div class="review-grid"><article><span>Profondità</span><strong>${escapeHtml(baseline.depthPreference ?? "Non impostata")}</strong></article><article><span>Linguaggio</span><strong>${escapeHtml(baseline.languageComplexityPreference ?? "Non impostato")}</strong></article><article><span>Lingua</span><strong>${escapeHtml(baseline.locale || "Non impostata")}</strong></article></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Impostazioni</span><h2>Imposta il livello di partenza</h2><p>Queste preferenze guidano l'esecuzione senza duplicare i contenuti.</p></div></header>${content}<div class="step-actions"><button class="button-secondary" type="button" data-step="3">Indietro</button><button type="button" data-step="5">Controlla il percorso</button></div></section>`;
  }

  renderRouteBlocker(blocker) {
    return `<li><div><strong>${escapeHtml(blocker.message || blocker.code)}</strong>${blocker.venueId ? `<small>Venue ${escapeHtml(blocker.venueId)}</small>` : ""}</div>${blocker.fixHref ? `<button class="button-secondary" type="button" data-fix-href="${escapeHtml(blocker.fixHref)}">Correggi in Spazi e mappa</button>` : ""}</li>`;
  }
  renderRouteLeg(leg) {
    const from = leg.fromStop;
    const to = leg.toStop;
    const heading = `${from?.label || "Tappa"} → ${to?.label || "Tappa"}`;
    if (leg.type === "inter_venue") {
      const ready = leg.status === "ready";
      return `<article class="route-leg" data-status="${escapeHtml(leg.status)}"><div><span class="chip">Trasferimento tra sedi</span><h4>${escapeHtml(heading)}</h4><small>${escapeHtml(from?.venue?.name || "Sede")} → ${escapeHtml(to?.venue?.name || "Sede")}</small>${ready ? `<p>${minutes(leg.estimatedSeconds)} min${leg.instruction ? ` · ${escapeHtml(leg.instruction)}` : ""}</p>` : `<p>Serve una stima esplicita: ArtAround non inventa tempi tra sedi.</p>`}</div>${this.editable ? `<form data-intervenue-transfer class="transfer-form"><input type="hidden" name="fromAnchorId" value="${escapeHtml(leg.fromAnchorId)}"><input type="hidden" name="toAnchorId" value="${escapeHtml(leg.toAnchorId)}"><label>Minuti<input name="transferMinutes" type="number" min="1" step="1" required value="${escapeHtml(minutes(leg.estimatedSeconds) || "")}"></label><label>Indicazione opzionale<input name="instructionOverride" value="${escapeHtml(leg.instruction || "")}" placeholder="es. attraversa il cortile"></label><button type="submit">${ready ? "Aggiorna" : "Salva trasferimento"}</button></form>` : ""}</article>`;
    }
    if (leg.type === "indoor") {
      return `<article class="route-leg" data-status="${escapeHtml(leg.status)}"><div><span class="chip">Percorso nella sede</span><h4>${escapeHtml(heading)}</h4>${leg.status === "ready" ? `<p>${leg.distanceMeters ?? 0} m · circa ${minutes(leg.estimatedSeconds) || 0} min</p>` : `<p>Il grafo pubblicato non collega queste tappe.</p>`}</div></article>`;
    }
    return `<article class="route-leg" data-status="blocked"><h4>${escapeHtml(heading)}</h4><p>Il percorso non è verificabile finché le tappe non sono risolvibili.</p></article>`;
  }
  renderStepFive() {
    if (this.activeStep !== 5) return "";
    const notes = (this.revision?.logistics?.preVisitNotes || []).join("\n");
    const review = this.revision?.routeReview || { status: "not_available", legs: [], blockers: [], warnings: [] };
    const notesUi = this.editable ? `<form data-visit-logistics class="editor-form"><label>Indicazioni prima della visita<textarea name="preVisitNotes" rows="5">${escapeHtml(notes)}</textarea></label><button type="submit">Salva indicazioni</button></form>` : "";
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">5</span><div><span class="eyebrow">Percorso</span><h2>Verifica la logistica senza modificare la mappa</h2><p>I tratti indoor derivano da Place, Connection e placement della Venue pubblicata. Se qualcosa non è raggiungibile, correggilo nel Venue editor.</p></div></header>${review.blockers?.length ? `<div class="issue-panel"><strong>Blocchi del percorso</strong><ul class="route-blockers">${review.blockers.map((entry) => this.renderRouteBlocker(entry)).join("")}</ul></div>` : `<div class="readiness success">${icon("check", { size: 18 })}<div><strong>Percorso verificabile</strong><p>Le tappe indoor sono raggiungibili e i trasferimenti tra sedi hanno una stima esplicita.</p></div></div>`}<div class="route-leg-list">${(review.legs || []).map((leg) => this.renderRouteLeg(leg)).join("") || `<p class="note">Non ci sono ancora due tappe da collegare.</p>`}</div><div class="subsection"><h3>Informazioni prima della visita</h3>${notesUi || `<p>${escapeHtml(notes || "Nessuna indicazione specifica.")}</p>`}</div><div class="step-actions"><button class="button-secondary" type="button" data-step="4">Indietro</button><button type="button" data-step="6">Vai al riepilogo</button></div></section>`;
  }

  reviewSummary() {
    const entries = this.revision?.entries || [];
    const stops = this.revision?.stops || [];
    const roles = { core: 0, recommended: 0, optional: 0 };
    for (const entry of entries) roles[entry.role || "recommended"] = (roles[entry.role || "recommended"] || 0) + 1;
    const venues = [...new Set(stops.map((stop) => stop.venue?.name).filter(Boolean))];
    return `<div class="review-grid"><article><span>Contenuti</span><strong>${entries.length}</strong><small>${roles.core} essenziali · ${roles.recommended} consigliati · ${roles.optional} facoltativi</small></article><article><span>Tappe</span><strong>${stops.length}</strong></article><article><span>Contestuali</span><strong>${(this.revision?.contextualEntries || []).length}</strong></article><article><span>Sedi</span><strong>${venues.length}</strong><small>${escapeHtml(venues.join(", ") || "Nessuna")}</small></article><article><span>Percorso</span><strong>${escapeHtml(this.revision?.routeReview?.status === "ready" ? "Verificabile" : "Da correggere")}</strong></article><article><span>Stato</span><strong>${escapeHtml(this.revision?.status || "draft")}</strong></article></div>`;
  }
  renderWorkflowOperation(operation) {
    if (operation.requiresMessage) return `<form data-workflow-form class="workflow-message-form"><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><label>Motivazione<textarea name="message" rows="3" required></textarea></label><button class="button-secondary" type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
  }
  renderStepSix() {
    if (this.activeStep !== 6) return "";
    const revision = this.revision;
    const issues = revision?.integrity?.issues || [];
    const operations = this.workflowOperations();
    const routeBlockers = revision?.routeReview?.blockers || [];
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">6</span><div><span class="eyebrow">Riepilogo e pubblicazione</span><h2>Controlla la visita</h2><p>La pubblicazione nel Catalogo è un passaggio commerciale separato. Pubblicare editorialmente non crea automaticamente una scheda nel Marketplace.</p></div></header>${this.reviewSummary()}${routeBlockers.length ? `<div class="issue-panel"><strong>Il percorso ha ancora ${routeBlockers.length} blocco/i</strong><ul>${routeBlockers.map((entry) => `<li>${escapeHtml(entry.message)}</li>`).join("")}</ul><button class="button-secondary" type="button" data-step="5">Torna al percorso</button></div>` : ""}${issues.length ? `<div class="issue-panel"><strong>Problemi di integrità</strong><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul></div>` : ""}<div class="workflow-panel"><div><h3>Azioni disponibili</h3><p class="note">Il controllo autorevole di pubblicazione resta backend-side.</p></div><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("") || `<p>Nessuna azione disponibile.</p>`}</div></div></section>`;
  }

  render() {
    if (this.busy && !this.projection) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione dell'editor visita…</p></div></main>`; return; }
    if (!this.projection) { this.innerHTML = `<main class="page"><p role="alert">${escapeHtml(this.error || "Editor visita non disponibile")}</p></main>`; return; }
    if (!this.visitId) { this.innerHTML = this.styles() + this.renderCreate(); return; }
    this.innerHTML = `${this.styles()}<main class="page visit-authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>${escapeHtml(this.revision?.title || "Visita")}</h1><p>Contenuti editoriali e tappe fisiche restano separati nel dominio; l'editor li presenta insieme solo quando serve all'autore.</p></div></header>${this.renderWorkingContext()}${this.renderProgress()}${this.busy ? `<p role="status">Salvataggio…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.message ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}${this.renderStepFive()}${this.renderStepSix()}</main>`;
  }

  styles() {
    return `<style>:host{display:block}.visit-authoring-page{display:grid;gap:1rem;max-width:76rem;margin:auto;padding:2rem 1rem 5rem}.working-context{display:grid;grid-template-columns:auto 1fr;gap:.35rem .6rem}.visit-progress{overflow:auto}.visit-progress ol{display:grid;grid-template-columns:repeat(6,minmax(8.5rem,1fr));gap:.5rem;min-width:55rem;margin:0;padding:0;list-style:none}.visit-progress button{display:flex;width:100%;align-items:center;gap:.45rem;padding:.62rem;border:1px solid #ccd6d1;border-radius:.7rem;background:#fff;color:#476159}.visit-progress button>span,.step-number,.sequence-index{display:grid;place-items:center;flex:0 0 1.8rem;height:1.8rem;border-radius:999px;background:#173e35;color:#fff}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem;align-items:flex-start}.editor-form{display:grid;gap:.9rem;max-width:52rem;margin-top:1rem}.step-actions,.entry-actions,.stop-actions,.workflow-actions{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;margin-top:.8rem}.content-summary-list,.candidate-grid,.stop-content-list,.contextual-list,.target-grid,.route-leg-list{display:grid;gap:.7rem;margin-top:.8rem}.content-summary-card,.candidate-card,.stop-content,.contextual-list article,.target-card,.route-leg{display:grid;gap:.7rem;align-items:center;padding:.9rem;border:1px solid #d7dfdb;border-radius:.8rem;background:#fff}.content-summary-card{grid-template-columns:1fr auto}.candidate-card{grid-template-columns:minmax(0,1fr) minmax(9rem,.35fr) auto}.candidate-card small,.content-summary-card small,.stop-content small,.stop-card small{display:block;color:#60706a}.content-browser,.subsection{display:grid;gap:.8rem;margin-top:1.2rem;padding-top:1rem;border-top:1px solid #e0e6e3}.search-inline{display:grid;grid-template-columns:1fr auto;gap:.65rem;align-items:end}.occurrence-choice{display:grid;gap:.75rem;padding:1rem;border:1px solid #d99b3e;border-radius:.8rem;background:#fff8e8}.occurrence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem}.occurrence-card{display:grid;text-align:left;padding:.8rem;border:1px solid #d4ddd8;border-radius:.7rem;background:#fff}.stop-list{display:grid;gap:.9rem;padding:0;list-style:none}.stop-card{padding:1rem;border:1px solid #cbd7d1;border-radius:1rem;background:#fdfefd}.stop-card>header{display:grid;grid-template-columns:auto 1fr auto;gap:.7rem;align-items:center}.stop-content{grid-template-columns:minmax(0,1fr) minmax(9rem,.3fr) auto}.add-to-stop{margin-top:.75rem}.contextual-section{border-top:2px solid #d8e1dd}.contextual-list article{grid-template-columns:minmax(0,1fr) minmax(14rem,.6fr) auto}.advanced-panel{margin-top:1rem;padding:.85rem;border:1px dashed #91a39b;border-radius:.8rem}.target-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.target-card{grid-template-columns:1fr auto}.route-blockers{display:grid;gap:.6rem;padding:0;list-style:none}.route-blockers li{display:flex;justify-content:space-between;gap:.75rem;align-items:center;padding:.7rem;border-top:1px solid #e1e5e3}.route-leg[data-status=blocked]{border-color:#d89a43;background:#fffaf0}.transfer-form{display:grid;grid-template-columns:8rem minmax(12rem,1fr) auto;gap:.6rem;align-items:end}.review-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;margin-top:1rem}.review-grid article{display:grid;gap:.18rem;padding:.8rem;border:1px solid #d9e0dc;border-radius:.7rem;background:#fff}.readiness,.issue-panel,.workflow-panel,.context-box,.blocker-panel{margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#f8faf8}.workflow-panel{display:grid;grid-template-columns:minmax(12rem,.75fr) minmax(0,1.25fr);gap:1rem}.readiness.success{background:#eef8f2}.note{color:#60706a}.chip{display:inline-flex;width:max-content;padding:.2rem .5rem;border-radius:999px;background:#edf3f0;color:#38554d;font-size:.75rem}.danger{color:#9b2c2c}.pagination{display:flex;justify-content:space-between;align-items:center}@media(max-width:60rem){.candidate-card,.stop-content,.contextual-list article,.workflow-panel,.transfer-form{grid-template-columns:1fr}.target-grid,.occurrence-grid{grid-template-columns:1fr}.stop-card>header{grid-template-columns:auto 1fr}.stop-actions{grid-column:1/-1}}@media(max-width:42rem){.working-context,.review-grid,.search-inline{grid-template-columns:1fr}}</style>`;
  }
}

customElements.define("artaround-visit-authoring-view", ArtAroundVisitAuthoringView);
