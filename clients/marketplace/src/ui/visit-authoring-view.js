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
  return ({ core: "Essenziale", recommended: "Consigliato", optional: "Facoltativo" })[role] || role || "Consigliato";
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
        this.selectedVenueId = id(this.revision?.anchors?.[0]?.venue?.id || venues[0]?.id || "") || null;
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
      if (render) this.error = error instanceof Error ? error.message : "Oggetti della sede non disponibili";
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

  serializeSources() {
    return (this.revision?.editorialSources || []).map((source) => ({ _id: source.id, editorialReleaseId: source.editorialReleaseId }));
  }

  serializeAnchors(anchors = this.revision?.anchors || []) {
    return anchors.map((anchor) => ({ _id: anchor.id, venueTargetId: anchor.venueTargetId }));
  }

  serializeEntries(entries = this.revision?.entries || []) {
    return entries.map((entry) => ({
      _id: entry.id,
      editorialSourceId: entry.editorialSourceId,
      itemId: entry.itemId,
      itemEditionId: entry.itemEditionId,
      itemRevisionId: entry.itemRevisionId,
      deliveryAnchorId: entry.deliveryAnchorId || null,
      role: entry.role || "recommended",
    }));
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

  sourceForRelease(releaseId) { return (this.revision?.editorialSources || []).find((source) => id(source.editorialReleaseId) === id(releaseId)) || null; }
  anchorForTarget(targetId) { return (this.revision?.anchors || []).find((anchor) => id(anchor.venueTargetId) === id(targetId)) || null; }

  async ensureEditorialSource(releaseId) {
    let source = this.sourceForRelease(releaseId);
    if (source) return source;
    await authoringRepository.updateVisit(this.visitId, { editorialSources: [...this.serializeSources(), { editorialReleaseId: releaseId }] });
    await this.reloadProjection();
    source = this.sourceForRelease(releaseId);
    if (!source) throw new Error("La raccolta editoriale non è stata collegata alla visita");
    return source;
  }

  async execute(callback, successMessage, { refreshContent = false, refreshVenueTargets = false } = {}) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await callback();
      await this.reloadProjection();
      if (refreshContent) await this.loadContent(false);
      if (refreshVenueTargets) await this.loadVenueTargets(false);
      this.message = successMessage;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  canOpenStep(step) {
    if (!this.visitId) return step === 1;
    if (step === 1 || step === 2 || step === 4 || step === 5 || step === 6) return true;
    if (step === 3) return (this.revision?.entries || []).length > 0;
    return false;
  }

  stepComplete(step) {
    if (step === 1) return Boolean(this.revision?.title);
    if (step === 2) return (this.revision?.entries || []).length > 0;
    if (step === 3) return (this.revision?.anchors || []).length > 0;
    if (step === 4) return Boolean(this.revision?.presentationBaseline);
    if (step === 5) return Boolean((this.revision?.logistics?.preVisitNotes || []).length || (this.revision?.logistics?.routeHints || []).length);
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
      }), "Indicazioni logistiche salvate");
      return;
    }

    if (form.matches("[data-workflow-form]")) {
      const operationCode = String(data.get("operationCode") || "");
      const operation = this.availableOperation(operationCode);
      if (!operation || !String(operationCode).startsWith("workflow.")) return;
      const message = operation.requiresMessage ? String(data.get("message") || "").trim() : "";
      if (operation.requiresMessage && !message) { this.error = "Scrivi la motivazione delle modifiche richieste"; this.render(); return; }
      await this.execute(async () => {
        const result = await marketplaceRepository.executeWorkspaceOperation({
          operationCode,
          sourceRef: { resourceType: "visit", resourceId: this.visitId },
          targetPrincipal: { type: this.principal.type, id: this.principal.id },
          payload: message ? { message } : {},
        });
        if (operationCode === "workflow.check") {
          const issues = result?.result?.issues || [];
          this.message = issues.length ? `Controllo completato: ${issues.length} problema/i da risolvere.` : "Controllo completato: la visita è pronta per il passaggio successivo.";
        }
      }, workflowNotice(operationCode));
      this.activeStep = 6;
    }
  };

  onChange = async (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;

    if (target.matches("[data-source]")) {
      this.selectedReleaseId = target.value || null;
      this.page = 1;
      this.busy = true;
      this.error = null;
      this.render();
      await this.loadContent(false);
      this.busy = false;
      this.render();
      return;
    }

    if (target.matches("[data-venue]")) {
      this.selectedVenueId = target.value || null;
      this.busy = true;
      this.error = null;
      this.render();
      await this.loadVenueTargets(false);
      this.busy = false;
      this.render();
      return;
    }

    if (target.matches("[data-entry-role]")) {
      const entryId = target.dataset.entryRole;
      const entries = (this.revision?.entries || []).map((entry) => id(entry.id) === id(entryId) ? { ...entry, role: target.value } : entry);
      await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(entries) }), "Importanza del contenuto aggiornata");
      return;
    }

    if (target.matches("[data-entry-anchor]")) {
      const entryId = target.dataset.entryAnchor;
      const entries = (this.revision?.entries || []).map((entry) => id(entry.id) === id(entryId) ? { ...entry, deliveryAnchorId: target.value || null } : entry);
      await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(entries) }), target.value ? "Tappa associata al contenuto" : "Contenuto lasciato senza tappa specifica");
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("button[data-back]")) { navigate("/workspace"); return; }
    const stepButton = target.closest("button[data-step]");
    if (stepButton) { const step = Number(stepButton.dataset.step) || 1; if (this.canOpenStep(step)) { this.activeStep = step; this.error = null; this.render(); } return; }
    const addButton = target.closest("button[data-add-content]");
    if (addButton) {
      const result = (this.content?.results || []).find((entry) => id(entry.itemRevisionId) === id(addButton.dataset.addContent));
      if (!result) return;
      const card = addButton.closest("article");
      const role = card?.querySelector("select[data-add-role]")?.value || "recommended";
      await this.execute(async () => {
        const source = await this.ensureEditorialSource(this.selectedReleaseId);
        const entries = this.serializeEntries();
        entries.push({ editorialSourceId: source.id, itemId: result.itemId, itemEditionId: result.itemEditionId, itemRevisionId: result.itemRevisionId, deliveryAnchorId: null, role });
        await authoringRepository.updateVisit(this.visitId, { contentEntries: entries });
      }, "Contenuto aggiunto. Se serve, associa una tappa nel passaggio successivo.", { refreshContent: true });
      return;
    }
    const removeEntry = target.closest("button[data-remove-entry]");
    if (removeEntry) { const remaining = (this.revision?.entries || []).filter((entry) => id(entry.id) !== id(removeEntry.dataset.removeEntry)); await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(remaining) }), "Contenuto rimosso dalla visita", { refreshContent: true }); return; }
    const moveEntry = target.closest("button[data-move-entry]");
    if (moveEntry) { const entries = [...(this.revision?.entries || [])]; const index = entries.findIndex((entry) => id(entry.id) === id(moveEntry.dataset.moveEntry)); const next = index + (Number(moveEntry.dataset.direction) || 0); if (index < 0 || next < 0 || next >= entries.length) return; [entries[index], entries[next]] = [entries[next], entries[index]]; await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(entries) }), "Ordine della visita aggiornato"); return; }
    const pageButton = target.closest("button[data-content-page]");
    if (pageButton) { this.page = Math.max(1, Number(pageButton.dataset.contentPage) || 1); this.busy = true; this.error = null; this.render(); await this.loadContent(false); this.busy = false; this.render(); return; }
    const addAnchor = target.closest("button[data-add-anchor]");
    if (addAnchor) { const targetId = addAnchor.dataset.addAnchor; if (!targetId || this.anchorForTarget(targetId)) return; await this.execute(() => authoringRepository.updateVisit(this.visitId, { visitAnchors: [...this.serializeAnchors(), { venueTargetId: targetId }] }), "Tappa aggiunta alla visita"); return; }
    const removeAnchor = target.closest("button[data-remove-anchor]");
    if (removeAnchor) { const anchorId = removeAnchor.dataset.removeAnchor; const blockers = this.anchorRemovalBlockers(anchorId); if (blockers.length) { this.error = blockers.join(" "); this.render(); return; } const anchors = (this.revision?.anchors || []).filter((anchor) => id(anchor.id) !== id(anchorId)); await this.execute(() => authoringRepository.updateVisit(this.visitId, { visitAnchors: this.serializeAnchors(anchors) }), "Tappa rimossa dalla visita"); }
  };

  anchorRemovalBlockers(anchorId) {
    const entries = (this.revision?.entries || []).filter((entry) => id(entry.deliveryAnchorId) === id(anchorId));
    const hints = (this.revision?.logistics?.routeHints || []).filter((hint) => id(hint.fromAnchorId) === id(anchorId) || id(hint.toAnchorId) === id(anchorId));
    const blockers = [];
    if (entries.length) blockers.push(`La tappa è usata da ${entries.length} contenuto/i: riassegnali prima di rimuoverla.`);
    if (hints.length) blockers.push(`La tappa è usata da ${hints.length} indicazione/i di trasferimento e non può essere rimossa.`);
    return blockers;
  }

  suggestedTargets() { const subjectIds = new Set((this.revision?.entries || []).map((entry) => id(entry.primarySubjectId)).filter(Boolean)); const usedTargets = new Set((this.revision?.anchors || []).map((anchor) => id(anchor.venueTargetId))); return (this.venueTargets?.targets || []).filter((entry) => !usedTargets.has(id(entry.id)) && subjectIds.has(id(entry.subject?.id))); }
  otherTargets() { const suggested = new Set(this.suggestedTargets().map((entry) => id(entry.id))); const usedTargets = new Set((this.revision?.anchors || []).map((anchor) => id(anchor.venueTargetId))); return (this.venueTargets?.targets || []).filter((entry) => !usedTargets.has(id(entry.id)) && !suggested.has(id(entry.id))); }

  renderProgress() {
    const stages = [[1, "Informazioni principali"], [2, "Contenuti"], [3, "Tappe"], [4, "Impostazioni"], [5, "Logistica"], [6, "Riepilogo e pubblicazione"]];
    return `<nav class="visit-progress" aria-label="Passaggi di creazione della visita"><ol>${stages.map(([step, label]) => { const current = this.activeStep === step; const enabled = this.canOpenStep(step); const complete = this.stepComplete(step); return `<li data-current="${current}" data-complete="${complete}"><button type="button" data-step="${step}" ${enabled ? "" : "disabled"} aria-current="${current ? "step" : "false"}"><span>${complete ? icon("check", { size: 13 }) : step}</span><strong>${escapeHtml(label)}</strong></button></li>`; }).join("")}</ol></nav>`;
  }

  renderWorkingContext() {
    if (!this.context) return "";
    return `<div class="working-context surface"><span>Area di lavoro</span><strong>${escapeHtml(this.context.type === "organization" ? this.context.name : "Area personale")}</strong></div>`;
  }

  renderCreate() {
    return `<main class="page visit-authoring-page"><nav class="breadcrumb" aria-label="Percorso"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Nuova visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>Nuova visita</h1><p>Parti dalle informazioni essenziali. Contenuti, tappe, impostazioni e logistica verranno aggiunti nei passaggi successivi.</p></div></header>${this.renderWorkingContext()}<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Informazioni principali</span><h2>Come si presenta questa visita?</h2></div></header><form data-create-visit class="editor-form"><label>Titolo<input name="title" required maxlength="160" placeholder="Un titolo chiaro per chi sceglierà la visita"></label><label>Descrizione<textarea name="description" rows="5" placeholder="Spiega tema, pubblico o obiettivo della visita"></textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Crea la bozza e scegli i contenuti ${icon("chevron", { size: 15 })}</button></form></section>${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}</main>`;
  }

  renderStepOne() {
    if (this.activeStep !== 1) return "";
    const published = this.revision?.status === "published";
    if (!this.editable) return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Informazioni principali</span><h2>${escapeHtml(this.revision?.title || "Visita")}</h2><p>${escapeHtml(this.revision?.description || "Nessuna descrizione")}</p></div></header><p class="note">Questa revisione non è modificabile nello stato corrente.</p></section>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">1</span><div><span class="eyebrow">Informazioni principali</span><h2>Presenta la visita</h2><p>Titolo e descrizione aiutano chi la sceglierà a capire tema e obiettivo.</p></div></header>${published ? `<div class="context-box"><strong>Stai modificando una versione pubblicata</strong><p>Il primo salvataggio creerà una nuova bozza di lavoro; la versione pubblicata resterà immutabile.</p></div>` : ""}<form data-visit-main class="editor-form"><label>Titolo<input name="title" required maxlength="160" value="${escapeHtml(this.revision?.title || "")}"></label><label>Descrizione<textarea name="description" rows="5">${escapeHtml(this.revision?.description || "")}</textarea></label><div class="step-actions"><button type="submit" ${this.busy ? "disabled" : ""}>Salva informazioni</button><button class="button-secondary" type="button" data-step="2">Continua ai contenuti ${icon("chevron", { size: 15 })}</button></div></form><details class="technical-details"><summary>Dettagli tecnici</summary><p>Visit ${escapeHtml(this.projection?.visit?.id || "-")} · VisitRevision ${escapeHtml(this.revision?.id || "-")} · versione ${escapeHtml(this.revision?.version || "-")} · stato ${escapeHtml(this.revision?.status || "-")}</p></details></section>`;
  }

  renderEntrySequence() {
    const entries = this.revision?.entries || [];
    if (!entries.length) return `<div class="empty-state compact"><h3>Nessun contenuto nella visita</h3><p>Cerca nella raccolta editoriale e aggiungi il primo contenuto.</p></div>`;
    return `<ol class="visit-sequence">${entries.map((entry, index) => `<li><article class="sequence-card"><div class="sequence-index">${index + 1}</div><div class="sequence-copy"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml((entry.authorCredits || []).join(", ") || "Autore non indicato")}${entry.deliveryTarget ? ` · tappa: ${escapeHtml(entry.deliveryTarget.label)}` : " · tappa da definire o non necessaria"}</small></div><label>Importanza<select data-entry-role="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}><option value="core" ${entry.role === "core" ? "selected" : ""}>Essenziale</option><option value="recommended" ${entry.role === "recommended" ? "selected" : ""}>Consigliato</option><option value="optional" ${entry.role === "optional" ? "selected" : ""}>Facoltativo</option></select></label><div class="entry-actions"><button class="button-secondary" type="button" data-move-entry="${escapeHtml(entry.id)}" data-direction="-1" ${!this.editable || index === 0 || this.busy ? "disabled" : ""}>Sposta prima</button><button class="button-secondary" type="button" data-move-entry="${escapeHtml(entry.id)}" data-direction="1" ${!this.editable || index === entries.length - 1 || this.busy ? "disabled" : ""}>Sposta dopo</button><button class="button-secondary danger" type="button" data-remove-entry="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}>Rimuovi</button></div></article></li>`).join("")}</ol>`;
  }

  renderContentSearch() {
    if (!this.editable) return "";
    const sources = this.sourceChoices();
    if (!sources.length) return `<div class="blocker-panel"><span>${icon("warning", { size: 20 })}</span><div><strong>Nessuna raccolta editoriale disponibile</strong><p>Per aggiungere contenuti serve una raccolta che questa area possa usare per comporre visite.</p><details class="technical-details"><summary>Dettagli tecnici</summary><p>Nessuna EditorialRelease autorizzata con capability <code>context.compose_visit</code> è disponibile.</p></details></div></div>`;
    const sourceOptions = sources.map((source) => `<option value="${escapeHtml(id(source.editorialReleaseId))}" ${id(source.editorialReleaseId) === id(this.selectedReleaseId) ? "selected" : ""}>${escapeHtml(source.name)}${source.ownership === "licensed" ? " · tramite licenza" : ""}</option>`).join("");
    const existingRevisions = new Set((this.revision?.entries || []).map((entry) => id(entry.itemRevisionId)));
    const results = this.content?.results || [];
    const cards = results.map((result) => { const alreadyAdded = existingRevisions.has(id(result.itemRevisionId)); const profileCount = (result.presentationProfiles || []).length; return `<article class="candidate-card"><div><h3>${escapeHtml(result.label)}</h3><p>${escapeHtml((result.authorCredits || []).join(", ") || "Autore non indicato")}${result.license ? ` · ${escapeHtml(result.license)}` : ""}</p><p class="note">${profileCount} ${profileCount === 1 ? "profilo di presentazione" : "profili di presentazione"} disponibili.</p></div><label>Importanza<select data-add-role ${alreadyAdded ? "disabled" : ""}><option value="core">Essenziale</option><option value="recommended" selected>Consigliato</option><option value="optional">Facoltativo</option></select></label><button type="button" data-add-content="${escapeHtml(id(result.itemRevisionId))}" ${alreadyAdded || this.busy ? "disabled" : ""}>${alreadyAdded ? "Già nella visita" : "Aggiungi alla visita"}</button></article>`; }).join("");
    const page = Number(this.content?.page) || 1; const limit = Number(this.content?.limit) || 20; const total = Number(this.content?.total) || 0;
    return `<div class="content-browser"><div class="selectors"><label>Raccolta editoriale<select data-source>${sourceOptions}</select><small>Mostriamo soltanto raccolte che puoi usare in questa visita.</small></label></div><form data-visit-search class="search-inline" role="search"><label>Cerca contenuti<span class="input-icon">${icon("search", { size: 16 })}<input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo del contenuto"></span></label><button type="submit" ${this.busy ? "disabled" : ""}>Cerca</button></form><p class="note">${total} contenuti disponibili · ricerca e paginazione gestite dal server.</p><div class="candidate-grid">${cards || `<div class="empty-state compact"><p>Nessun contenuto trovato. Prova a cambiare ricerca o raccolta.</p></div>`}</div><nav class="pagination"><button type="button" data-content-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>Precedente</button><span>Pagina ${page}</span><button type="button" data-content-page="${page + 1}" ${page * limit >= total || this.busy ? "disabled" : ""}>Successiva</button></nav></div>`;
  }

  renderStepTwo() {
    if (this.activeStep !== 2) return "";
    const count = (this.revision?.entries || []).length;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">2</span><div><span class="eyebrow">Contenuti</span><h2>Scegli cosa raccontare e in quale ordine</h2><p>Aggiungi i contenuti, definisci la loro importanza e riordinali. Le tappe fisiche vengono gestite nel passaggio successivo.</p></div><span class="count">${count}</span></header>${this.renderEntrySequence()}${this.renderContentSearch()}<div class="step-actions"><button class="button-secondary" type="button" data-step="1">Indietro</button><button type="button" data-step="3" ${count ? "" : "disabled"}>Continua alle tappe ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderCurrentAnchors() {
    const anchors = this.revision?.anchors || [];
    if (!anchors.length) return `<div class="empty-state compact"><h3>Nessuna tappa ancora definita</h3><p>Aggiungi almeno una tappa fisica prima del controllo di pubblicazione.</p></div>`;
    return `<div class="anchor-list">${anchors.map((anchor, index) => { const blockers = this.anchorRemovalBlockers(anchor.id); return `<article class="anchor-card"><div class="anchor-index">${index + 1}</div><div><strong>${escapeHtml(anchor.label)}</strong><small>${escapeHtml(anchor.venue?.name || "Sede non disponibile")}</small>${blockers.length ? `<small>${escapeHtml(blockers.join(" "))}</small>` : ""}</div>${this.editable ? `<button class="button-secondary danger" type="button" data-remove-anchor="${escapeHtml(anchor.id)}" ${blockers.length || this.busy ? "disabled" : ""}>Rimuovi tappa</button>` : ""}</article>`; }).join("")}</div>`;
  }

  renderTargetCards(targets, { suggested = false } = {}) {
    if (!targets.length) return suggested ? `<p class="note">Nessuna nuova tappa suggerita per i contenuti presenti.</p>` : `<p class="note">Nessun altro oggetto attivo in questa sede.</p>`;
    return `<div class="target-grid">${targets.map((target) => `<article class="target-card"><div><strong>${escapeHtml(target.label)}</strong><small>${escapeHtml(target.subject?.preferredLabel || target.description || "Oggetto della sede")}</small>${suggested ? `<span class="chip" data-tone="success">Corrisponde a un contenuto</span>` : ""}</div><button type="button" data-add-anchor="${escapeHtml(id(target.id))}" ${!this.editable || this.busy ? "disabled" : ""}>Aggiungi tappa</button></article>`).join("")}</div>`;
  }

  renderAnchorAssignments() {
    const anchors = this.revision?.anchors || []; const entries = this.revision?.entries || []; if (!entries.length) return "";
    return `<div class="assignment-list">${entries.map((entry, index) => { const current = id(entry.deliveryAnchorId); const currentExists = anchors.some((anchor) => id(anchor.id) === current); const options = [`<option value="">Nessuna tappa specifica · contenuto associato</option>`, ...(current && !currentExists ? [`<option value="${escapeHtml(current)}" selected>Riferimento non disponibile</option>`] : []), ...anchors.map((anchor) => `<option value="${escapeHtml(anchor.id)}" ${id(anchor.id) === current ? "selected" : ""}>${escapeHtml(anchor.label)} · ${escapeHtml(anchor.venue?.name || "Sede")}</option>`)].join(""); return `<article class="assignment-card"><div><span class="sequence-index">${index + 1}</span><strong>${escapeHtml(entry.label)}</strong><small>Puoi associare liberamente questo contenuto a una tappa della visita.</small></div><label>Tappa di fruizione<select data-entry-anchor="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}>${options}</select></label></article>`; }).join("")}</div>`;
  }

  renderStepThree() {
    if (this.activeStep !== 3) return "";
    const venues = this.venueChoices(); const venueOptions = venues.map((venue) => `<option value="${escapeHtml(id(venue.id))}" ${id(venue.id) === id(this.selectedVenueId) ? "selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.organizationName)}</option>`).join("");
    const suggested = this.suggestedTargets(); const others = this.otherTargets();
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">3</span><div><span class="eyebrow">Tappe</span><h2>Definisci dove si svolge la visita</h2><p>Le tappe sono oggetti fisici della sede. Aggiungile esplicitamente, poi scegli dove presentare ciascun contenuto.</p></div></header><div class="subsection"><h3>Tappe della visita</h3>${this.renderCurrentAnchors()}</div>${this.editable ? `<div class="subsection"><label>Sede da esplorare<select data-venue>${venueOptions || "<option value=''>Nessuna sede disponibile</option>"}</select></label>${this.selectedVenueId ? `<h3>Tappe suggerite</h3>${this.renderTargetCards(suggested, { suggested: true })}<details class="advanced-panel"><summary>Altri oggetti della sede</summary>${this.renderTargetCards(others)}</details>` : ""}</div>` : ""}<div class="subsection"><h3>Associa i contenuti alle tappe</h3>${this.renderAnchorAssignments()}</div><div class="step-actions"><button class="button-secondary" type="button" data-step="2">Indietro</button><button type="button" data-step="4">Continua alle impostazioni ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderStepFour() {
    if (this.activeStep !== 4) return "";
    const baseline = this.revision?.presentationBaseline || {};
    const content = this.editable ? `<form data-visit-settings class="editor-form"><label>Profondità preferita<input name="depthPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.depthPreference ?? "")}"></label><label>Complessità del linguaggio<input name="languageComplexityPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.languageComplexityPreference ?? "")}"></label><label>Lingua preferita<input name="locale" value="${escapeHtml(baseline.locale || "")}" placeholder="es. it-IT"></label><button type="submit" ${this.busy ? "disabled" : ""}>Salva impostazioni</button></form>` : `<div class="review-grid"><article><span>Profondità</span><strong>${escapeHtml(baseline.depthPreference ?? "Non impostata")}</strong></article><article><span>Linguaggio</span><strong>${escapeHtml(baseline.languageComplexityPreference ?? "Non impostato")}</strong></article><article><span>Lingua</span><strong>${escapeHtml(baseline.locale || "Non impostata")}</strong></article></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">4</span><div><span class="eyebrow">Impostazioni</span><h2>Imposta il livello di partenza</h2><p>Queste preferenze guidano l'esecuzione della visita senza fissare un'unica versione del testo per tutti i contenuti.</p></div></header>${content}<div class="step-actions"><button class="button-secondary" type="button" data-step="3">Indietro</button><button type="button" data-step="5">Continua alla logistica ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  renderRouteHints() {
    const hints = this.revision?.logistics?.routeHints || [];
    if (!hints.length) return `<div class="empty-state compact">${icon("route", { size: 22 })}<div><strong>Nessun trasferimento esplicito</strong><p>Il percorso indoor resta responsabilità della sede e del suo layout.</p></div></div>`;
    const anchorById = new Map((this.revision?.anchors || []).map((anchor) => [id(anchor.id), anchor]));
    return `<div class="route-hint-list">${hints.map((hint, index) => { const from = anchorById.get(id(hint.fromAnchorId)); const to = anchorById.get(id(hint.toAnchorId)); const type = hint.type === "inter_venue" ? "Trasferimento tra sedi" : "Indicazione di percorso"; return `<article><span>${index + 1}</span><div><strong>${escapeHtml(type)}</strong><small>${escapeHtml(from?.label || "Tappa")}${to ? ` → ${escapeHtml(to.label)}` : ""}</small>${hint.instructionOverride ? `<p>${escapeHtml(hint.instructionOverride)}</p>` : ""}${hint.note ? `<small>${escapeHtml(hint.note)}</small>` : ""}</div></article>`; }).join("")}</div>`;
  }

  renderStepFive() {
    if (this.activeStep !== 5) return "";
    const notes = (this.revision?.logistics?.preVisitNotes || []).join("\n");
    const notesUi = this.editable ? `<form data-visit-logistics class="editor-form"><label>Indicazioni prima della visita<textarea name="preVisitNotes" rows="6">${escapeHtml(notes)}</textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Salva indicazioni</button></form>` : `<div class="context-box"><p>${notes ? escapeHtml(notes).replaceAll("\n", "<br>") : "Nessuna indicazione specifica della visita."}</p></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">5</span><div><span class="eyebrow">Logistica</span><h2>Prepara le informazioni operative</h2><p>Le indicazioni logistiche restano separate dai contenuti editoriali.</p></div></header>${notesUi}<div class="subsection"><h3>Trasferimenti strutturati</h3>${this.renderRouteHints()}</div><div class="step-actions"><button class="button-secondary" type="button" data-step="4">Indietro</button><button type="button" data-step="6">Vai al riepilogo ${icon("chevron", { size: 15 })}</button></div></section>`;
  }

  reviewSummary() {
    const entries = this.revision?.entries || []; const anchors = this.revision?.anchors || []; const roles = { core: 0, recommended: 0, optional: 0 }; for (const entry of entries) roles[entry.role || "recommended"] = (roles[entry.role || "recommended"] || 0) + 1; const venues = [...new Set(anchors.map((anchor) => anchor.venue?.name).filter(Boolean))]; const notes = (this.revision?.logistics?.preVisitNotes || []).length;
    return `<div class="review-grid"><article><span>Contenuti</span><strong>${entries.length}</strong><small>${roles.core} essenziali · ${roles.recommended} consigliati · ${roles.optional} facoltativi</small></article><article><span>Tappe</span><strong>${anchors.length}</strong></article><article><span>Sedi coinvolte</span><strong>${venues.length || 0}</strong><small>${escapeHtml(venues.join(", ") || "Nessuna")}</small></article><article><span>Profondità</span><strong>${escapeHtml(this.revision?.presentationBaseline?.depthPreference ?? "Non impostata")}</strong></article><article><span>Linguaggio</span><strong>${escapeHtml(this.revision?.presentationBaseline?.languageComplexityPreference ?? "Non impostato")}</strong></article><article><span>Indicazioni pre-visita</span><strong>${notes}</strong></article></div>`;
  }

  renderWorkflowOperation(operation) {
    if (operation.requiresMessage) return `<form data-workflow-form class="workflow-message-form"><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><label>Motivazione<textarea name="message" rows="3" required></textarea></label><button class="button-secondary" type="submit" ${this.busy ? "disabled" : ""}>${escapeHtml(workflowLabel(operation))}</button></form>`;
    return `<form data-workflow-form><input type="hidden" name="operationCode" value="${escapeHtml(operation.code)}"><button type="submit" ${this.busy ? "disabled" : ""}>${operation.code === "workflow.check" ? icon("check", { size: 15 }) : ""}${escapeHtml(workflowLabel(operation))}</button></form>`;
  }

  renderStepSix() {
    if (this.activeStep !== 6) return "";
    const revision = this.revision; const integrity = revision?.integrity?.status || "needs_review"; const issues = revision?.integrity?.issues || []; const operations = this.workflowOperations(); const published = revision?.status === "published";
    const state = published ? `<div class="readiness success">${icon("check", { size: 20 })}<div><strong>Versione pubblicata</strong><p>Questa VisitRevision è uno snapshot editoriale immutabile.</p></div></div>` : integrity === "valid" ? `<div class="readiness success">${icon("check", { size: 20 })}<div><strong>Controllo superato</strong><p>La visita è coerente e può passare alla pubblicazione.</p></div></div>` : `<div class="readiness warning">${icon("warning", { size: 20 })}<div><strong>Serve un controllo</strong><p>Esegui il controllo dopo le modifiche.</p></div></div>`;
    return `<section class="wizard-step panel"><header class="step-heading"><span class="step-number">6</span><div><span class="eyebrow">Riepilogo e pubblicazione</span><h2>Controlla la visita prima di pubblicarla</h2></div></header>${this.reviewSummary()}${state}${issues.length ? `<div class="issue-panel"><strong>Problemi da risolvere</strong><ul>${issues.map((issue) => `<li>${escapeHtml(userFacingIssueMessage(issue))}</li>`).join("")}</ul></div>` : ""}<div class="workflow-panel"><div><h3>Azioni disponibili</h3></div><div class="workflow-actions">${operations.map((operation) => this.renderWorkflowOperation(operation)).join("") || `<p>Nessuna azione editoriale disponibile.</p>`}</div></div></section>`;
  }

  render() {
    if (this.busy && !this.projection) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione dell'editor visita…</p></div></main>`; return; }
    if (!this.projection) { this.innerHTML = `<main class="page"><p role="alert">${escapeHtml(this.error || "Editor visita non disponibile")}</p></main>`; return; }
    if (!this.visitId) { this.innerHTML = this.styles() + this.renderCreate(); return; }
    this.innerHTML = `${this.styles()}<main class="page visit-authoring-page" aria-busy="${this.busy}"><nav class="breadcrumb"><button type="button" data-back>${icon("arrowLeft", { size: 15 })} Libreria</button><span>/</span><span>Visita</span></nav><header class="page-header"><div><span class="eyebrow">Crea visita</span><h1>${escapeHtml(this.revision?.title || "Visita")}</h1><p>Costruisci il percorso separando contenuti editoriali, tappe fisiche e indicazioni logistiche.</p></div></header>${this.renderWorkingContext()}${this.renderProgress()}${this.busy ? `<p role="status">Aggiornamento in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 16 })} ${escapeHtml(this.error)}</p>` : ""}${this.message ? `<p class="status success" role="status">${icon("check", { size: 16 })} ${escapeHtml(this.message)}</p>` : ""}${this.renderStepOne()}${this.renderStepTwo()}${this.renderStepThree()}${this.renderStepFour()}${this.renderStepFive()}${this.renderStepSix()}</main>`;
  }

  styles() {
    return `<style>:host{display:block}.visit-authoring-page{display:grid;gap:1rem;max-width:72rem;margin:auto;padding:2rem 1rem 5rem}.visit-progress{overflow:auto}.visit-progress ol{display:grid;grid-template-columns:repeat(6,minmax(9rem,1fr));gap:.5rem;min-width:58rem;margin:0;padding:0;list-style:none}.visit-progress button{display:flex;width:100%;height:100%;align-items:center;gap:.45rem;padding:.62rem;border:1px solid #ccd6d1;border-radius:.7rem;background:#fff;color:#476159}.visit-progress button>span{display:grid;place-items:center;flex:0 0 1.65rem;height:1.65rem;border-radius:999px;background:#edf2ef}.wizard-step{padding:1.35rem}.step-heading{display:flex;gap:.85rem}.step-number,.sequence-index,.anchor-index{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:999px;background:#173e35;color:#fff}.editor-form{display:grid;gap:.9rem;max-width:50rem;margin-top:1rem}.step-actions,.entry-actions,.workflow-actions{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:1rem}.visit-sequence,.candidate-grid,.anchor-list,.assignment-list,.target-grid,.route-hint-list{display:grid;gap:.65rem}.visit-sequence{padding:0;list-style:none}.sequence-card,.candidate-card,.anchor-card,.assignment-card,.target-card{display:grid;gap:.75rem;align-items:center;padding:.85rem;border:1px solid #d7dfdb;border-radius:.75rem;background:#fff}.sequence-card{grid-template-columns:auto minmax(0,1fr) minmax(9rem,.35fr) auto}.candidate-card{grid-template-columns:minmax(0,1fr) minmax(9rem,.3fr) auto}.anchor-card{grid-template-columns:auto minmax(0,1fr) auto}.assignment-card{grid-template-columns:minmax(0,.8fr) minmax(14rem,1.2fr)}.target-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.target-card{grid-template-columns:1fr auto}.content-browser,.subsection{display:grid;gap:.75rem;margin-top:1.25rem;padding-top:1rem;border-top:1px solid #e0e6e3}.search-inline{display:grid;grid-template-columns:1fr auto;gap:.65rem}.review-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;margin-top:1rem}.review-grid article{display:grid;gap:.18rem;padding:.8rem;border:1px solid #d9e0dc;border-radius:.7rem;background:#fff}.readiness,.issue-panel,.workflow-panel,.context-box,.blocker-panel{margin-top:1rem;padding:1rem;border:1px solid #d4ddd8;border-radius:.8rem;background:#f8faf8}.workflow-panel{display:grid;grid-template-columns:minmax(12rem,.75fr) minmax(0,1.25fr);gap:1rem}.readiness.success{background:#eef8f2}.readiness.warning{background:#fff8e8}.technical-details,.advanced-panel{margin-top:1rem;padding:.75rem;border:1px dashed #91a39b;border-radius:.7rem}.note{color:#60706a}@media(max-width:58rem){.sequence-card,.candidate-card,.assignment-card,.workflow-panel{grid-template-columns:1fr}.target-grid{grid-template-columns:1fr}}@media(max-width:42rem){.review-grid,.search-inline{grid-template-columns:1fr}}</style>`;
  }
}

customElements.define("artaround-visit-authoring-view", ArtAroundVisitAuthoringView);
