import { managementRepository } from "../infrastructure/http/management-repository.js";
import "./semantic-entity-picker.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";
import { venueInventorySearchMixin } from "./venue-editor-inventory-search-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";
import { venueMapInspectorMixin } from "./venue-editor-map-inspector-mixin.js";
import { venueFloorDialogMixin } from "./venue-editor-floor-dialog-mixin.js";
import { venueMapCreationDialogMixin } from "./venue-editor-map-creation-dialog-mixin.js";
import { venueLiveConnectionPreviewMixin } from "./venue-editor-live-connection-preview-mixin.js";
import { venueSpatialDiagnosticsMixin } from "./venue-editor-spatial-diagnostics-mixin.js";
import { venueContextualWorkspaceMixin } from "./venue-editor-contextual-workspace-mixin.js";
import { venueSlotSubjectUiMixin } from "./venue-editor-slot-subject-ui-mixin.js";

const SECTIONS = ["overview", "map", "visitors", "publication"];
function venueId() { return new URLSearchParams(window.location.search).get("venueId"); }
function initialVenueSection() {
  const requested = String(window.location.hash || "").replace(/^#venue-/, "");
  return SECTIONS.includes(requested) ? requested : "overview";
}
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }

export class ArtAroundVenueEditorView extends HTMLElement {
  data = null;
  onboarding = null;
  lifecycleImpact = null;
  canManageLifecycle = false;
  pendingVenueRemoval = false;
  pendingTargetRemovalId = null;
  pendingDestructiveAction = null;
  busy = false;
  error = null;
  message = null;
  selectedSubject = null;
  id = venueId();
  managementRepository = managementRepository;
  pendingWorkflow = null;
  workflowMessage = "";
  activeSection = initialVenueSection();
  selectedFloorId = null;
  selectedMapPlaceId = null;
  selectedConnectionId = null;
  selectedExhibitSlotId = null;
  selectedVenueTargetId = null;
  activeSpatialTab = "map";
  activeMapInspectorTab = "details";
  floorDialog = null;
  mapCreationDialog = null;
  inventoryFilter = "all";
  inventorySearchQuery = "";
  venueSubjectCandidates = null;
  venueSubjectQuery = "";
  pendingMapAction = null;
  draggingPlace = null;

  connectedCallback() {
    this.addEventListener("click", this.onMapSelectionCapture, true);
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onSectionKeyDown);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("pointerdown", this.onMapPointerDown);
    this.addEventListener("pointermove", this.onMapPointerMove);
    this.addEventListener("pointermove", this.onMapLiveConnectionPreview);
    this.addEventListener("pointerup", this.onMapPointerUp);
    this.addEventListener("pointercancel", this.onMapPointerCancel);
    this.addEventListener("dblclick", this.onMapDoubleClick);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.addEventListener("slot-subject-assigned", this.onSlotSubjectAssigned);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onMapSelectionCapture, true);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onSectionKeyDown);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("pointerdown", this.onMapPointerDown);
    this.removeEventListener("pointermove", this.onMapPointerMove);
    this.removeEventListener("pointermove", this.onMapLiveConnectionPreview);
    this.removeEventListener("pointerup", this.onMapPointerUp);
    this.removeEventListener("pointercancel", this.onMapPointerCancel);
    this.removeEventListener("dblclick", this.onMapDoubleClick);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
    this.removeEventListener("slot-subject-assigned", this.onSlotSubjectAssigned);
  }

  onMapSelectionCapture = (event) => {
    if (this.pendingMapAction) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-map-place]")) {
      this.selectedConnectionId = null;
      this.selectedExhibitSlotId = null;
      this.activeMapInspectorTab = "details";
    }
  };

  onSlotSubjectAssigned = async (event) => {
    const assignment = event.detail || {};
    this.busy = true;
    this.error = null;
    this.message = null;
    try {
      await this.refreshServerState();
      this.selectedVenueTargetId = assignment.venueTargetId ? String(assignment.venueTargetId) : null;
      this.selectedExhibitSlotId = assignment.exhibitSlotId ? String(assignment.exhibitSlotId) : this.selectedExhibitSlotId;
      this.message = assignment.venueTargetCreated
        ? "Entità aggiunta all’inventario e assegnata allo slot."
        : assignment.previousExhibitSlotId
          ? "Entità ricollocata nello slot selezionato."
          : "Entità assegnata allo slot.";
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Configurazione aggiornata, ma non è stato possibile ricaricare la sede";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  async refreshServerState() {
    this.data = await managementRepository.venue(this.id);
    const floorIds = new Set((this.data?.layout?.floors || []).map((floor) => String(floor._id)));
    if (!floorIds.has(String(this.selectedFloorId || ""))) this.selectedFloorId = [...floorIds][0] || null;
    const needsSetup = !this.data?.release && !this.data?.layout && has(this.data?.availableOperations, "venue.release.ensure");
    this.onboarding = needsSetup ? await managementRepository.venuePhysicalOnboarding(this.id) : null;
    this.lifecycleImpact = null;
    this.canManageLifecycle = false;
    try {
      this.lifecycleImpact = await managementRepository.venueLifecycleImpact(this.id);
      this.canManageLifecycle = true;
    } catch {
      // Lifecycle management is a separate backend-authoritative permission boundary.
    }
  }

  async load() {
    if (!this.id) { this.error = "Sede non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { await this.refreshServerState(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Sede non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  async execute(callback, message) {
    this.busy = true; this.error = null; this.message = null; this.render();
    try {
      await callback();
      await this.refreshServerState();
      this.pendingWorkflow = null;
      this.workflowMessage = "";
      this.pendingTargetRemovalId = null;
      this.pendingDestructiveAction = null;
      this.message = message;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
      return false;
    } finally { this.busy = false; this.render(); }
  }

  onSectionKeyDown = (event) => {
    if (event.key === "Escape" && this.mapCreationDialog) {
      event.preventDefault();
      this.closeMapCreationDialog?.();
      this.render();
      return;
    }
    if (event.key === "Escape" && this.floorDialog) {
      event.preventDefault();
      this.floorDialog = null;
      this.render();
      return;
    }
    if (event.key === "Escape" && (this.pendingMapAction || this.draggingPlace)) {
      event.preventDefault();
      this.cancelMapAction();
      return;
    }
    if (this.onboarding?.required) return;
    const tab = event.target instanceof Element ? event.target.closest("[data-venue-section]") : null;
    if (!tab || !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const tabs = [...this.querySelectorAll("[data-venue-section]")];
    const current = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : ["ArrowDown", "ArrowRight"].includes(event.key) ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    this.showSection(tabs[next].dataset.venueSection);
    tabs[next].focus();
  };

  onInput = (event) => {
    const target = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.matches("[data-workflow-message]")) return;
    this.workflowMessage = target.value;
    const button = this.querySelector("[data-confirm-workflow]");
    if (button) button.disabled = !this.workflowMessage.trim();
  };
}

Object.assign(
  ArtAroundVenueEditorView.prototype,
  venueActionMixin,
  venueTargetsMixin,
  venueInventorySearchMixin,
  venueSpatialMixin,
  venueSectionMixin,
  venueMapAuthoringMixin,
  venueMapInspectorMixin,
  venueFloorDialogMixin,
  venueMapCreationDialogMixin,
  venueLiveConnectionPreviewMixin,
  venueSpatialDiagnosticsMixin,
  venueContextualWorkspaceMixin,
  venueSlotSubjectUiMixin,
);
customElements.define("artaround-venue-editor-view", ArtAroundVenueEditorView);
