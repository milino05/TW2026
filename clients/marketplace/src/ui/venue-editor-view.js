import { managementRepository } from "../infrastructure/http/management-repository.js";
import "./semantic-entity-picker.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";
import { venueInventorySearchMixin } from "./venue-editor-inventory-search-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";
import { venueSpatialDetailMixin } from "./venue-editor-spatial-detail-mixin.js";
import { venueFloorDialogMixin } from "./venue-editor-floor-dialog-mixin.js";
import { venueMapCreationDialogMixin } from "./venue-editor-map-creation-dialog-mixin.js";
import { venueLiveConnectionPreviewMixin } from "./venue-editor-live-connection-preview-mixin.js";
import { venueSpatialDiagnosticsMixin } from "./venue-editor-spatial-diagnostics-mixin.js";
import { venueContextualWorkspaceMixin } from "./venue-editor-contextual-workspace-mixin.js";
import { venueSpatialInteractionMixin } from "./venue-editor-spatial-interaction-mixin.js";
import { venueSpatialOverlayMixin } from "./venue-editor-spatial-overlay-mixin.js";
import { venueMapRefinementMixin } from "./venue-editor-map-refinement-mixin.js";
import { venueSlotInventoryMixin } from "./venue-editor-slot-inventory-mixin.js";
import { venueInventoryProposalsMixin } from "./venue-editor-inventory-proposals-mixin.js";

const SECTIONS = ["overview", "inventory", "map", "visitors", "publication"];
function venueId() { return new URLSearchParams(window.location.search).get("venueId"); }
function initialVenueSection() {
  const requested = String(window.location.hash || "").replace(/^#venue-/, "");
  return SECTIONS.includes(requested) ? requested : "overview";
}
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function id(value) { return String(value?._id || value?.id || value || ""); }

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
  spatialEditor = null;
  activeSpatialTab = "map";
  floorDialog = null;
  mapCreationDialog = null;
  calibrationOverwritePrompt = null;
  inventoryFilter = "all";
  inventorySearchQuery = "";
  inventoryBrowser = null;
  inventorySubjectPickerOpen = false;
  inventoryPendingSubject = null;
  inventoryDetailTargetId = null;
  venueSubjectCandidates = null;
  venueSubjectQuery = "";
  pendingMapAction = null;
  draggingPlace = null;
  inventoryProposals = null;
  inventoryProposalStatus = "pending";
  pendingProposalDecision = null;
  proposalDecisionMessage = "";

  connectedCallback() {
    this.addEventListener("click", this.onInventoryProposalClick);
    this.addEventListener("submit", this.onInventoryProposalSubmit);
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
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onInventoryProposalClick);
    this.removeEventListener("submit", this.onInventoryProposalSubmit);
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
    this.removeEventListener("subject-selected", this.onSubjectSelected);
    if (this._venueGlobalEscapeHandler) {
      window.removeEventListener("keydown", this._venueGlobalEscapeHandler, true);
      this._venueGlobalEscapeHandler = null;
    }
  }

  onInventoryProposalClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-inventory-proposal-status],[data-inventory-proposal-action],[data-cancel-inventory-proposal-decision]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.handleInventoryProposalClick?.(event);
  };

  onInventoryProposalSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-inventory-proposal-decision]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.handleInventoryProposalSubmit?.(form, new FormData(form));
  };

  validateSpatialEditor() {
    if (!this.spatialEditor || !this.data?.layout) return;
    const editor = this.spatialEditor;
    const layout = this.data.layout;
    const exists = editor.kind === "place"
      ? (layout.places || []).some((entry) => id(entry._id) === id(editor.id))
      : editor.kind === "connection"
        ? (layout.connections || []).some((entry) => id(entry._id) === id(editor.id))
        : editor.kind === "slot"
          ? (layout.exhibitSlots || []).some((entry) => id(entry.exhibitSlotId) === id(editor.id))
          : false;
    if (!exists) this.spatialEditor = null;
  }

  validateInventoryState() {
    const targetIds = new Set((this.data?.targets || []).map((target) => id(target.id)));
    if (this.selectedVenueTargetId && !targetIds.has(id(this.selectedVenueTargetId))) this.selectedVenueTargetId = null;
    if (this.inventoryDetailTargetId && !targetIds.has(id(this.inventoryDetailTargetId))) this.inventoryDetailTargetId = null;
    if (this.inventoryBrowser?.selectedTargetId && !targetIds.has(id(this.inventoryBrowser.selectedTargetId))) {
      this.inventoryBrowser = { ...this.inventoryBrowser, selectedTargetId: null };
    }
    if (this.inventoryBrowser?.exhibitSlotId) {
      const slotExists = (this.data?.layout?.exhibitSlots || []).some((slot) => id(slot.exhibitSlotId) === id(this.inventoryBrowser.exhibitSlotId));
      if (!slotExists) this.inventoryBrowser = null;
    }
  }

  async refreshServerState() {
    this.data = await managementRepository.venue(this.id);
    const floorIds = new Set((this.data?.layout?.floors || []).map((floor) => String(floor._id)));
    if (!floorIds.has(String(this.selectedFloorId || ""))) this.selectedFloorId = [...floorIds][0] || null;
    this.validateSpatialEditor();
    this.validateInventoryState();
    await this.refreshInventoryProposals?.();
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
    if (event.key === "Escape" && this.spatialEditor) {
      event.preventDefault();
      this.closeSpatialEditor?.();
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
    if (this.handleInventoryProposalInput?.(event)) return;
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
  venueSpatialDetailMixin,
  venueFloorDialogMixin,
  venueMapCreationDialogMixin,
  venueLiveConnectionPreviewMixin,
  venueSpatialDiagnosticsMixin,
  venueContextualWorkspaceMixin,
  venueSpatialInteractionMixin,
  venueSpatialOverlayMixin,
  venueMapRefinementMixin,
  venueSlotInventoryMixin,
  venueInventoryProposalsMixin,
);
customElements.define("artaround-venue-editor-view", ArtAroundVenueEditorView);