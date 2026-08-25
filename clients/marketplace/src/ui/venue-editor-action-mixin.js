import { navigate } from "../application/router.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

function parseRefs(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [scheme, id, matchType = "exact"] = line.split("|").map((part) => part.trim()); return { scheme, id, matchType }; }).filter((entry) => entry.scheme && entry.id); }
function refsText(values = []) { return values.map((entry) => `${entry.scheme}|${entry.id}|${entry.matchType || "exact"}`).join("\n"); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function semanticRefChips(values = [], editable = true) { return values.length ? values.map((entry, index) => `<span class="semantic-ref-chip"><span>${escapeHtml(entry.scheme)} · ${escapeHtml(entry.id)} · ${escapeHtml(entry.matchType || "exact")}</span>${editable ? `<button type="button" data-remove-semantic-ref="${index}" aria-label="Rimuovi mapping ${escapeHtml(entry.id)}">×</button>` : ""}</span>`).join("") : `<span class="muted">Nessun mapping esterno</span>`; }

export const venueActionMixin = {
  async onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-back]")) {
      if (this.dirty) {
        try { this.snapshotDraft(); }
        catch (error) { this.error = `Correggi prima i dati non validi: ${error.message}`; this.render(); return; }
        this.leaveConfirmation = true; this.pendingWorkflow = null; this.render();
      } else navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.data.venue.organizationId)}&section=venues`);
      return;
    }
    if (target.closest("[data-cancel-leave]")) { this.leaveConfirmation = false; this.render(); return; }
    if (target.closest("[data-confirm-leave]")) { navigate(`/organizations/detail?organizationId=${encodeURIComponent(this.data.venue.organizationId)}&section=venues`); return; }

    if (target.closest("[data-ensure-release]")) { await this.execute(() => managementRepository.ensureVenueRelease(this.id), "Bozza della configurazione fisica pronta.", { preserveDraft: true }); return; }

    const add = target.closest("[data-add-layout]");
    if (add) {
      try { const draft = this.snapshotDraft(); draft.layout[add.dataset.addLayout].push(this.emptyEntry(add.dataset.addLayout)); this.data.layout[add.dataset.addLayout] = draft.layout[add.dataset.addLayout]; this.dirty = true; this.render(); }
      catch (error) { this.error = `JSON non valido: ${error.message}`; this.render(); }
      return;
    }
    const remove = target.closest("[data-remove-layout]");
    if (remove) {
      try { const draft = this.snapshotDraft(); draft.layout[remove.dataset.removeLayout].splice(Number(remove.dataset.index), 1); this.data.layout[remove.dataset.removeLayout] = draft.layout[remove.dataset.removeLayout]; this.dirty = true; this.render(); }
      catch (error) { this.error = `JSON non valido: ${error.message}`; this.render(); }
      return;
    }

    const removeSemanticRef = target.closest("[data-remove-semantic-ref]");
    if (removeSemanticRef) {
      const row = removeSemanticRef.closest("[data-layout-row]");
      const input = row?.querySelector('[name="semanticRefs"]');
      if (input) { const refs = parseRefs(input.value); refs.splice(Number(removeSemanticRef.dataset.removeSemanticRef), 1); input.value = refsText(refs); row.querySelector("[data-semantic-ref-list]").innerHTML = semanticRefChips(refs, true); this.markDirty(); }
      return;
    }

    const trash = target.closest("[data-trash-target]");
    if (trash) {
      if (this.dirty) {
        try { this.snapshotDraft(); }
        catch (error) { this.error = `Correggi prima i dati non validi: ${error.message}`; this.render(); return; }
      }
      this.trashTarget = { id: trash.dataset.trashTarget, label: trash.dataset.label }; this.render(); return;
    }
    if (target.closest("[data-cancel-trash]")) { this.trashTarget = null; this.render(); return; }
    if (target.closest("[data-confirm-trash]") && this.trashTarget) {
      const current = this.trashTarget;
      await this.execute(() => managementRepository.trashVenueTarget(this.id, current.id), `${current.label} è stato spostato nel cestino.`, { preserveDraft: true });
      return;
    }

    if (target.closest("[data-save-venue]")) { await this.saveAll(); return; }

    if (target.closest("[data-cancel-workflow]")) { this.pendingWorkflow = null; this.workflowMessage = ""; this.render(); return; }
    if (target.closest("[data-save-and-workflow]") && this.pendingWorkflow) { const code = this.pendingWorkflow; await this.saveAll({ continueWorkflow: code }); return; }
    if (target.closest("[data-confirm-workflow]") && this.pendingWorkflow) { const code = this.pendingWorkflow; await this.execute(() => this.runWorkflowRequest(code), "Workflow della sede aggiornato."); return; }

    const workflow = target.closest("[data-workflow]");
    if (workflow) {
      const code = workflow.dataset.workflow;
      if (this.dirty) {
        try { this.snapshotDraft(); }
        catch (error) { this.error = `Correggi prima i dati non validi: ${error.message}`; this.render(); return; }
        this.pendingWorkflow = code; this.workflowMessage = ""; this.render(); return;
      }
      await this.performWorkflow(code); return;
    }
  },

  async onSubmit(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    const data = new FormData(form);
    if (form.matches("[data-save-venue], [data-venue-metadata], [data-previsit], [data-target-bindings], [data-layout-form]")) { event.preventDefault(); await this.saveAll(); return; }
    if (form.matches("[data-target-metadata]")) {
      event.preventDefault();
      await this.execute(() => managementRepository.updateVenueTarget(this.id, form.dataset.targetMetadata, { label: String(data.get("label") || ""), description: String(data.get("description") || "") }), "Oggetto aggiornato.", { preserveDraft: true });
      return;
    }
    if (form.matches("[data-create-target]")) {
      event.preventDefault();
      const success = await this.execute(() => managementRepository.createVenueTarget(this.id, { subjectId: String(data.get("subjectId") || ""), label: String(data.get("label") || ""), description: String(data.get("description") || "") }), "Oggetto fisico creato.", { preserveDraft: true });
      if (success) { this.selectedSubject = null; this.render(); }
    }
  },

  onSubjectSelected(event) {
    if (!event.detail?.subject) return;
    if (this.dirty) {
      try { this.snapshotDraft(); }
      catch (error) { this.error = `Correggi prima i dati non validi: ${error.message}`; this.render(); return; }
    }
    this.selectedSubject = event.detail.subject;
    this.message = event.detail.source === "reuse_existing" ? "Identità esistente riutilizzata." : "Soggetto selezionato per il nuovo oggetto.";
    this.render();
  },

  onSemanticRefSelected(event) {
    const picker = event.target instanceof Element ? event.target : null;
    const row = picker?.closest("[data-layout-row]");
    const input = row?.querySelector('[name="semanticRefs"]');
    const semanticRef = event.detail?.semanticRef;
    if (!row || !input || !semanticRef) return;
    const refs = parseRefs(input.value);
    const key = `${semanticRef.scheme}::${semanticRef.id}::${semanticRef.matchType}`;
    if (!refs.some((entry) => `${entry.scheme}::${entry.id}::${entry.matchType}` === key)) refs.push(semanticRef);
    input.value = refsText(refs);
    row.querySelector("[data-semantic-ref-list]").innerHTML = semanticRefChips(refs, true);
    this.markDirty();
  },

  emptyEntry(field) {
    if (field === "placeTypes") return { key: "", label: "", description: "", userIntents: [], semanticRefs: [] };
    if (field === "routingAttributes") return { key: "", label: "", dataType: "boolean", appliesTo: "connection", options: [] };
    if (field === "routingPresets") return { key: "", label: "", description: "", requirements: [] };
    if (field === "floors") return { key: "", label: "", map: {} };
    if (field === "places") return { typeKey: "", label: "", floorKey: "", position: { x: 0.5, y: 0.5 }, attributes: {} };
    if (field === "venueTargetPlacements") return { venueTargetId: "", primaryPlaceId: "", placeIds: [] };
    return { fromPlaceId: "", toPlaceId: "", directionality: "bidirectional", distanceMeters: 1, additionalDelaySeconds: 0, attributes: {}, instructions: {} };
  }
};
