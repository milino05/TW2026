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
  requestDestructiveAction(action) {
    this.pendingDestructiveAction = action;
    this.pendingWorkflow = null;
    this.error = null;
    this.render();
    requestAnimationFrame(() => this.querySelector("[data-confirm-destructive-action]")?.focus());
  },

  destructiveActionRequest(action) {
    if (action.type === "floor") return () => managementRepository.removeVenueFloor(this.id, action.id);
    if (action.type === "place") return () => managementRepository.removeVenuePlace(this.id, action.id);
    if (action.type === "connection") return () => managementRepository.removeVenueConnection(this.id, action.id);
    if (action.type === "target_detach") return () => managementRepository.detachVenueTarget(this.id, action.id);
    if (action.type === "recognition_media") {
      return () => managementRepository.removeVenueTargetRecognitionMedia(this.id, action.targetId, action.mediaId);
    }
    return null;
  },

  async onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (await this.handleTargetMediaClick?.(event)) return;
    if (await this.handleMapAuthoringClick?.(event)) return;

    if (target.closest("[data-cancel-destructive-action]")) {
      this.pendingDestructiveAction = null;
      this.error = null;
      this.render();
      return;
    }
    if (target.closest("[data-confirm-destructive-action]") && this.pendingDestructiveAction) {
      const action = this.pendingDestructiveAction;
      const request = this.destructiveActionRequest(action);
      if (!request) { this.pendingDestructiveAction = null; this.render(); return; }
      await this.execute(request, action.successMessage || "Configurazione fisica aggiornata.");
      return;
    }

    const sectionTab = target.closest("[data-venue-section]");
    if (sectionTab) { this.showSection(sectionTab.dataset.venueSection, { scroll: true }); return; }

    if (target.closest("[data-back]")) {
      navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.data.venue.organizationId)}&section=venues`);
      return;
    }

    if (target.closest("[data-cancel-venue-removal]")) { this.pendingVenueRemoval = false; this.error = null; this.render(); return; }
    if (target.closest("[data-request-venue-removal]")) {
      this.pendingVenueRemoval = true;
      this.pendingWorkflow = null;
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-confirm-venue-removal]")?.focus());
      return;
    }
    if (target.closest("[data-confirm-venue-removal]")) {
      this.busy = true; this.error = null; this.message = null; this.render();
      try {
        await managementRepository.trashVenue(this.id);
        navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.data.venue.organizationId)}&section=venues&removed=venue`);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Non è stato possibile rimuovere la sede";
        this.busy = false;
        this.render();
      }
      return;
    }

    if (target.closest("[data-cancel-target-removal]")) { this.pendingTargetRemovalId = null; this.error = null; this.render(); return; }
    const requestTargetRemoval = target.closest("[data-request-target-removal]");
    if (requestTargetRemoval) {
      this.pendingTargetRemovalId = requestTargetRemoval.dataset.requestTargetRemoval;
      this.pendingWorkflow = null;
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector(`[data-confirm-target-removal="${CSS.escape(this.pendingTargetRemovalId)}"]`)?.focus());
      return;
    }
    const confirmTargetRemoval = target.closest("[data-confirm-target-removal]");
    if (confirmTargetRemoval) {
      await this.execute(
        () => managementRepository.trashVenueTarget(this.id, confirmTargetRemoval.dataset.confirmTargetRemoval),
        "Oggetto fisico spostato nel cestino.",
      );
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
      const label = removeFloor.closest("article")?.querySelector("h3")?.textContent?.trim() || "questo piano";
      this.requestDestructiveAction({ type: "floor", id: removeFloor.dataset.removeFloor, title: `Rimuovere “${label}”?`, description: "Il piano può essere rimosso soltanto se non contiene luoghi.", confirmLabel: "Rimuovi piano", successMessage: "Piano rimosso." });
      return;
    }
    const removePlace = target.closest("[data-remove-place]");
    if (removePlace) {
      const label = removePlace.closest("article")?.querySelector("h3")?.textContent?.trim() || "questo luogo";
      this.requestDestructiveAction({ type: "place", id: removePlace.dataset.removePlace, title: `Rimuovere “${label}”?`, description: "Collegamenti e oggetti associati devono essere spostati prima.", confirmLabel: "Rimuovi luogo", successMessage: "Luogo rimosso." });
      return;
    }
    const removeConnection = target.closest("[data-remove-connection]");
    if (removeConnection) {
      const label = removeConnection.closest("article")?.querySelector("h3")?.textContent?.trim() || "questo collegamento";
      this.requestDestructiveAction({ type: "connection", id: removeConnection.dataset.removeConnection, title: `Rimuovere “${label}”?`, description: "Il collegamento non sarà più disponibile nel grafo della bozza.", confirmLabel: "Rimuovi collegamento", successMessage: "Collegamento rimosso." });
      return;
    }

    const detach = target.closest("[data-detach-target]");
    if (detach) {
      const label = detach.dataset.label || "questo oggetto";
      this.requestDestructiveAction({ type: "target_detach", id: detach.dataset.detachTarget, title: `Rimuovere “${label}” dalla configurazione?`, description: "Collocazione, disponibilità e immagini di riconoscimento verranno rimosse soltanto dalla bozza. Il VenueTarget resterà nell'archivio della sede.", confirmLabel: "Rimuovi dalla bozza", successMessage: "Oggetto rimosso dalla configurazione fisica di lavoro." });
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
      let createdTarget = null;
      const success = await this.execute(async () => {
        createdTarget = await managementRepository.createVenueTarget(this.id, {
          subjectId: String(data.get("subjectId") || ""),
          label: String(data.get("label") || ""),
          description: String(data.get("description") || ""),
        });
      }, "Oggetto fisico creato.");
      if (success) {
        this.selectedSubject = null;
        const targetId = String(createdTarget?._id || createdTarget?.id || "");
        if (targetId) {
          this.pendingMapAction = { type: "place-target", targetId };
          this.activeSection = "map";
          this.message = (this.data.layout?.places || []).length
            ? "Oggetto creato. Seleziona sulla mappa il luogo in cui si trova."
            : "Oggetto creato. Aggiungi un luogo sulla mappa, poi colloca l’oggetto.";
          this.render();
          this.showSection("map", { scroll: true });
        }
      }
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
