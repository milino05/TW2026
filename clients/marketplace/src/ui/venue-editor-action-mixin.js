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

function media(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    return separator < 0
      ? { url: line, altText: "" }
      : { url: line.slice(0, separator).trim(), altText: line.slice(separator + 1).trim() };
  });
}
function number(value, fallback = null) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

export const venueActionMixin = {
  async onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
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

    if (form.matches("[data-target-binding]")) {
      await this.execute(() => managementRepository.setVenueTargetBinding(this.id, form.dataset.targetBinding, {
        availability: String(data.get("availability") || "active"),
        recognitionMedia: media(data.get("recognitionMedia")),
      }), "Disponibilità e immagini aggiornate.");
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

    if (form.matches("[data-calibrate-floor]")) {
      await this.execute(() => managementRepository.calibrateVenueFloor(this.id, form.dataset.calibrateFloor, {
        method: "line",
        distanceMeters: number(data.get("distanceMeters")),
        line: {
          from: { x: number(data.get("fromX")), y: number(data.get("fromY")) },
          to: { x: number(data.get("toX")), y: number(data.get("toY")) },
        },
      }), "Piano calibrato.");
      return;
    }

    if (form.matches("[data-add-place]")) {
      await this.execute(() => managementRepository.createVenuePlace(this.id, {
        floorId: String(data.get("floorId") || ""),
        placeTypeDefinitionId: String(data.get("placeTypeDefinitionId") || ""),
        label: String(data.get("label") || ""),
        position: { x: number(data.get("x"), 0.5), y: number(data.get("y"), 0.5) },
      }), "Luogo aggiunto.");
      return;
    }

    if (form.matches("[data-place-editor]")) {
      const placeId = form.dataset.placeEditor;
      const position = { x: number(data.get("x")), y: number(data.get("y")) };
      await this.execute(async () => {
        await managementRepository.updateVenuePlace(this.id, placeId, {
          label: String(data.get("label") || ""),
          placeTypeDefinitionId: String(data.get("placeTypeDefinitionId") || ""),
        });
        return managementRepository.moveVenuePlace(this.id, placeId, position);
      }, "Luogo aggiornato.");
      return;
    }

    if (form.matches("[data-add-connection]")) {
      const metricMode = String(data.get("metricMode") || "manual_override");
      const payload = {
        fromPlaceId: String(data.get("fromPlaceId") || ""),
        toPlaceId: String(data.get("toPlaceId") || ""),
        connectionTypeDefinitionId: String(data.get("connectionTypeDefinitionId") || "") || null,
        directionality: String(data.get("directionality") || "bidirectional"),
        metricMode,
        additionalDelaySeconds: number(data.get("additionalDelaySeconds"), 0),
      };
      if (metricMode !== "geometry_derived") payload.distanceMeters = number(data.get("distanceMeters"));
      await this.execute(() => managementRepository.createVenueConnection(this.id, payload), "Collegamento aggiunto.");
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
      return;
    }

    if (form.matches("[data-target-placement]")) {
      await this.execute(() => managementRepository.setVenueTargetPlacement(this.id, form.dataset.targetPlacement, {
        primaryPlaceId: String(data.get("primaryPlaceId") || ""),
        placeIds: [],
      }), "Collocazione dell'oggetto aggiornata.");
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