import { managementRepository } from "../infrastructure/http/management-repository.js";
import "./semantic-entity-picker.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";
import { venueSpatialDiagnosticsMixin } from "./venue-editor-spatial-diagnostics-mixin.js";

const SECTIONS = ["overview", "targets", "map", "visitors", "publication"];
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
  busy = false;
  error = null;
  message = null;
  selectedSubject = null;
  id = venueId();
  pendingWorkflow = null;
  workflowMessage = "";
  activeSection = initialVenueSection();
  selectedFloorId = null;
  selectedMapPlaceId = null;
  pendingMapAction = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onSectionKeyDown);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onSectionKeyDown);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

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
      this.message = message;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
      return false;
    } finally { this.busy = false; this.render(); }
  }

  onSectionKeyDown = (event) => {
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
  venueSpatialMixin,
  venueSectionMixin,
  venueMapAuthoringMixin,
  venueSpatialDiagnosticsMixin,
);
customElements.define("artaround-venue-editor-view", ArtAroundVenueEditorView);
