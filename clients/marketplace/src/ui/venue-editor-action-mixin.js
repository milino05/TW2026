import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

const WORKFLOW_CONFIG = {
  "venue.release.check": ["check-consistency", {}],
  "venue.release.request_review": ["review", {}],
  "venue.release.withdraw_review": ["review", { method: "DELETE" }],
  "venue.release.request_changes": ["request-changes", {}],
  "venue.release.publish": ["publish", {}],
};

function number(value, fallback = null) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

export const venueActionMixin = {
  async onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (await this.handleTargetMediaClick?.(event)) return;
    if (await this.handleMapAuthoringClick?.(event)) return;

    const sectionTab = target.closest("[data-venue-section]");
    if (sectionTab) { this.showSection(sectionTab.dataset.venueSection, { scroll: true }); return; }

    if (target.closest("[data-back]")) {
      navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.data.venue.organizationId)}&section=venues`);
      return;
    }

    if (target.closest("[data-ensure-release]")) {
      await this.execute(() => managementRepository.ensureVenueRelease(this.id), "Nuova bozza fisica pronta.");
      return;
    }

    if (target.closest("[data-cancel-workflow]")) { this.pendingWorkflow = null; this.workflowMessage = ""; this.render(); return; }
    if (target.closest("[data-confirm-workflow]") && this.pendingWorkflow) {
      const code = this.pendingWorkflow;
      await this.execute(() => this.runWorkflowRequest(code), "Workflow della sede aggiornato.");
      return;
    }
    const workflow = target.closest("[data-workflow]");
    if (workflow) { await this.performWorkflow(workflow.dataset.workflow); return; }

    const removeFloor = target.closest("[data-remove-floor]");
    if (removeFloor) {
      if (!window.confirm("Rimuovere questo piano? L'operazione è consentita solo se non contiene luoghi.")) return;
      await this.execute(() => managementRepository.removeVenueFloor(this.id, removeFloor.dataset.removeFloor), "Piano rimosso.");
      return;
    }
    const removePlace = target.closest("[data-remove-place]");
    if (removePlace) {
      if (!window.confirm("Rimuovere questo luogo? Collegamenti e oggetti devono essere spostati prima.")) return;
      await this.execute(() => managementRepository.removeVenuePlace(this.id, removePlace.dataset.removePlace), "Luogo rimosso.");
      return;
    }
    const removeConnection = target.closest("[data-remove-connection]");
    if (removeConnection) {
      if (!window.confirm("Rimuovere questo collegamento?")) return;
      await this.execute(() => managementRepository.removeVenueConnection(this.id, removeConnection.dataset.removeConnection), "Collegamento rimosso.");
      return;
    }

    const trash = target.closest("[data-trash-target]");
    if (trash) {
      if (!window.confirm(`Spostare “${trash.dataset.label || "questo oggetto"}” nel cestino?`)) return;
      await this.execute(() => managementRepository.trashVenueTarget(this.id, trash.dataset.trashTarget), "Oggetto spostato nel cestino.");
    }
  },

  async onSubmit(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (await this.handleMapAuthoringSubmit?.(form, data)) return;
    if (await this.handleTargetMediaSubmit?.(form, data)) return;

    if (form.matches("[data-physical-onboarding]")) {
      const mode = String(data.get("mode") || this.onboarding?.recommendedMode || "starter");
      const payload = mode === "existing"
        ? { mode, physicalVocabularyRevisionId: String(data.get("physicalVocabularyRevisionId") || "") }
        : { mode, name: String(data.get("name") || ""), description: String(data.get("description") || "") };
      await this.execute(() => managementRepository.initializeVenuePhysicalOnboarding(this.id, payload), "Configurazione fisica iniziale pronta.");
      return;
    }

    if (form.matches("[data-venue-metadata]")) {
      await this.execute(() => accountRepository.updateVenue(this.id, {
        name: String(data.get("name") || ""),
        description: String(data.get("description") || ""),
      }), "Profilo della sede aggiornato.");
      return;
    }

    if (form.matches("[data-previsit]")) {
      const items = String(data.get("preVisitInformation") || "").split("\n").map((line) => line.trim()).filter(Boolean);
      await this.execute(() => managementRepository.setVenuePreVisitInformation(this.id, items), "Informazioni pre-visita aggiornate.");
      return;
    }

    if (form.matches("[data-target-metadata]")) {
      await this.execute(() => managementRepository.updateVenueTarget(this.id, form.dataset.targetMetadata, {
        label: String(data.get("label") || ""),
        description: String(data.get("description") || ""),
      }), "Oggetto aggiornato.");
      return;
    }

    if (form.matches("[data-target-availability]")) {
      await this.execute(() => managementRepository.setVenueTargetAvailability(
        this.id,
        form.dataset.targetAvailability,
        String(data.get("availability") || "active"),
      ), "Disponibilità dell'oggetto aggiornata.");
      return;
    }

    if (form.matches("[data-create-target]")) {
      const success = await this.execute(() => managementRepository.createVenueTarget(this.id, {
        subjectId: String(data.get("subjectId") || ""),
        label: String(data.get("label") || ""),
        description: String(data.get("description") || ""),
      }), "Oggetto fisico creato.");
      if (success) this.selectedSubject = null;
      return;
    }

    if (form.matches("[data-add-floor]")) {
      await this.execute(() => managementRepository.addVenueFloor(this.id, { label: String(data.get("label") || "") }), "Piano aggiunto.");
      return;
    }

    if (form.matches("[data-floor-metadata]")) {
      await this.execute(() => managementRepository.updateVenueFloor(this.id, form.dataset.floorMetadata, {
        label: String(data.get("label") || ""),
      }), "Nome del piano aggiornato.");
      return;
    }

    if (form.matches("[data-place-editor]")) {
      await this.execute(() => managementRepository.updateVenuePlace(this.id, form.dataset.placeEditor, {
        label: String(data.get("label") || ""),
        placeTypeDefinitionId: String(data.get("placeTypeDefinitionId") || ""),
      }), "Luogo aggiornato.");
      return;
    }

    if (form.matches("[data-connection-editor]")) {
      const metricMode = String(data.get("metricMode") || "manual_override");
      const payload = {
        connectionTypeDefinitionId: String(data.get("connectionTypeDefinitionId") || "") || null,
        directionality: String(data.get("directionality") || "bidirectional"),
        metricMode,
        additionalDelaySeconds: number(data.get("additionalDelaySeconds"), 0),
        instructions: { forward: String(data.get("forward") || ""), backward: String(data.get("backward") || "") },
      };
      if (metricMode !== "geometry_derived") payload.distanceMeters = number(data.get("distanceMeters"));
      await this.execute(() => managementRepository.updateVenueConnection(this.id, form.dataset.connectionEditor, payload), "Collegamento aggiornato.");
    }
  },

  async runWorkflowRequest(code) {
    const config = WORKFLOW_CONFIG[code];
    if (!config) return;
    const options = { ...config[1] };
    if (code === "venue.release.request_changes") {
      const message = this.workflowMessage.trim();
      if (!message) throw new Error("Inserisci una motivazione per le modifiche richieste.");
      options.payload = { message };
    }
    await managementRepository.venueWorkflow(this.id, config[0], options);
  },

  async performWorkflow(code) {
    if (!WORKFLOW_CONFIG[code]) return;
    if (code === "venue.release.request_changes") { this.pendingWorkflow = code; this.workflowMessage = ""; this.render(); return; }
    await this.execute(() => this.runWorkflowRequest(code), "Workflow della sede aggiornato.");
  },

  onSubjectSelected(event) {
    if (!event.detail?.subject) return;
    this.selectedSubject = event.detail.subject;
    this.message = event.detail.source === "reuse_existing" ? "Identità esistente riutilizzata." : "Soggetto selezionato per il nuovo oggetto.";
    this.render();
  },

  onSemanticRefSelected() {},
};
