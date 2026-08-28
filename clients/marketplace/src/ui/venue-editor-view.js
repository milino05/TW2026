import { navigate } from "../application/router.js";
import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { icon } from "./icons.js";
import "./semantic-entity-picker.js";
import { venueDraftMixin } from "./venue-editor-draft-mixin.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";
import { venueRoutingMixin } from "./venue-editor-routing-mixin.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";

const SECTIONS = [
  ["overview", "Panoramica"],
  ["targets", "Oggetti esposti"],
  ["visitors", "Informazioni visitatori"],
  ["map", "Mappa e luoghi"],
  ["routes", "Percorsi"],
  ["publication", "Pubblicazione"],
];
const LAYOUT_FIELDS = ["placeTypes", "routingAttributes", "routingPresets", "floors", "places", "venueTargetPlacements", "connections"];
const WORKFLOW_CONFIG = {
  "venue.release.check": ["check-consistency", {}],
  "venue.release.request_review": ["review", {}],
  "venue.release.withdraw_review": ["review", { method: "DELETE" }],
  "venue.release.request_changes": ["request-changes", {}],
  "venue.release.publish": ["publish", {}],
};
const WORKFLOW_LABEL = {
  "venue.release.check": "Controlla se è tutto pronto",
  "venue.release.request_review": "Invia in revisione",
  "venue.release.withdraw_review": "Ritira dalla revisione",
  "venue.release.request_changes": "Richiedi modifiche",
  "venue.release.publish": "Pubblica configurazione",
};

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function venueId() { return new URLSearchParams(window.location.search).get("venueId"); }
function comma(value) { return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function parseJson(value, fallback = {}) { if (!String(value || "").trim()) return fallback; return JSON.parse(value); }
function pretty(value) { return JSON.stringify(value ?? {}, null, 2); }
function mediaText(values = []) { return values.map((entry) => `${entry.url}|${entry.altText || ""}`).join("\n"); }
function parseMedia(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const separator = line.indexOf("|"); return separator < 0 ? { url: line, altText: "" } : { url: line.slice(0, separator).trim(), altText: line.slice(separator + 1).trim() }; }); }
function selected(value, current) { return String(value || "") === String(current || "") ? "selected" : ""; }
function refsText(values = []) { return values.map((entry) => `${entry.scheme}|${entry.id}|${entry.matchType || "exact"}`).join("\n"); }
function parseRefs(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [scheme, id, matchType = "exact"] = line.split("|").map((part) => part.trim()); return { scheme, id, matchType }; }).filter((entry) => entry.scheme && entry.id); }
function semanticRefChips(values = [], editable = true) { return values.length ? values.map((entry, index) => `<span class="semantic-ref-chip"><span>${escapeHtml(entry.scheme)} · ${escapeHtml(entry.id)} · ${escapeHtml(entry.matchType || "exact")}</span>${editable ? `<button type="button" data-remove-semantic-ref="${index}" aria-label="Rimuovi mapping ${escapeHtml(entry.id)}">×</button>` : ""}</span>`).join("") : `<span class="muted">Nessun mapping esterno</span>`; }
function statusLabel(status) { return { draft: "Bozza", in_review: "In revisione", changes_requested: "Modifiche richieste", published: "Pubblicata", superseded: "Superata" }[status] || status || "Da configurare"; }
function sourceLabel(source) { return source === "working" ? "Bozza di lavoro" : source === "published" ? "Versione pubblicata" : "Non configurata"; }
function availabilityLabel(value) { return value === "active" ? "Disponibile" : "Temporaneamente non disponibile"; }
function initialVenueSection() {
  const requested = String(window.location.hash || "").replace(/^#venue-/, "");
  return SECTIONS.some(([key]) => key === requested) ? requested : "overview";
}

export class ArtAroundVenueEditorView extends HTMLElement {
  data = null;
  onboarding = null;
  busy = false;
  error = null;
  message = null;
  selectedSubject = null;
  dirty = false;
  id = venueId();
  leaveConfirmation = false;
  pendingWorkflow = null;
  workflowMessage = "";
  trashTarget = null;
  activeSection = initialVenueSection();

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onSectionKeyDown);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.addEventListener("semantic-ref-selected", this.onSemanticRefSelected);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onSectionKeyDown);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
    this.removeEventListener("semantic-ref-selected", this.onSemanticRefSelected);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  async refreshServerState() {
    this.data = await managementRepository.venue(this.id);
    const needsSetup = !this.data?.release && !this.data?.layout && has(this.data?.availableOperations, "venue.release.ensure");
    this.onboarding = needsSetup ? await managementRepository.venuePhysicalOnboarding(this.id) : null;
  }

  async load() {
    if (!this.id) { this.error = "Sede non specificata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try { await this.refreshServerState(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Sede non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  async execute(callback, message, { preserveDraft = false } = {}) {
    let draft = null;
    if (preserveDraft && this.dirty) {
      try { draft = this.captureDraft(); }
      catch (error) { this.error = `Correggi prima i dati non validi: ${error.message}`; this.render(); return false; }
    }
    this.busy = true; this.error = null; this.message = null; this.render();
    try {
      await callback();
      await this.refreshServerState();
      if (draft && !this.onboarding?.required) { this.applyDraft(draft); this.dirty = true; }
      else this.dirty = false;
      this.leaveConfirmation = false; this.pendingWorkflow = null; this.workflowMessage = ""; this.trashTarget = null;
      this.message = message;
      return true;
    } catch (error) { this.error = error instanceof Error ? error.message : "Operazione non riuscita"; return false; }
    finally { this.busy = false; this.render(); }
  }

  onBeforeUnload = (event) => { if (!this.dirty) return; event.preventDefault(); event.returnValue = ""; };
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
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-physical-onboarding]")) return;
    if (target.matches("[data-workflow-message]")) {
      this.workflowMessage = target.value;
      const button = this.querySelector("[data-confirm-workflow], [data-save-and-workflow]");
      if (button) button.disabled = !this.workflowMessage.trim();
      return;
    }
    if (target.closest("artaround-semantic-entity-picker")) return;
    if (target.closest("[data-target-metadata], [data-create-target]")) return;
    this.markDirty();
  };
  markDirty() {
    this.dirty = true;
    const indicator = this.querySelector("[data-dirty-indicator]");
    if (indicator) { indicator.dataset.tone = "warning"; indicator.innerHTML = `${icon("warning", { size: 14 })} Modifiche non salvate`; }
  }
}

Object.assign(ArtAroundVenueEditorView.prototype, venueDraftMixin, venueActionMixin, venueTargetsMixin, venueSpatialMixin, venueRoutingMixin, venueSectionMixin);

customElements.define("artaround-venue-editor-view", ArtAroundVenueEditorView);
