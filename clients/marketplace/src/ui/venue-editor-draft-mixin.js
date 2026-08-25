import { accountRepository } from "../infrastructure/http/account-repository.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

const LAYOUT_FIELDS = ["placeTypes", "routingAttributes", "routingPresets", "floors", "places", "venueTargetPlacements", "connections"];
const WORKFLOW_CONFIG = {
  "venue.release.check": ["check-consistency", {}],
  "venue.release.request_review": ["review", {}],
  "venue.release.withdraw_review": ["review", { method: "DELETE" }],
  "venue.release.request_changes": ["request-changes", {}],
  "venue.release.publish": ["publish", {}],
};
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function comma(value) { return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function parseJson(value, fallback = {}) { if (!String(value || "").trim()) return fallback; return JSON.parse(value); }
function parseMedia(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const separator = line.indexOf("|"); return separator < 0 ? { url: line, altText: "" } : { url: line.slice(0, separator).trim(), altText: line.slice(separator + 1).trim() }; }); }
function parseRefs(value) { return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [scheme, id, matchType = "exact"] = line.split("|").map((part) => part.trim()); return { scheme, id, matchType }; }).filter((entry) => entry.scheme && entry.id); }

export const venueDraftMixin = {
  collectSection(field) {
    const rows = [...this.querySelectorAll(`[data-layout-section="${field}"] [data-layout-row]`)];
    const value = (row, name) => row.querySelector(`[name="${name}"]`)?.value || "";
    if (field === "placeTypes") return rows.map((row) => ({ key: value(row, "key"), label: value(row, "label"), description: value(row, "description"), userIntents: comma(value(row, "userIntents")), semanticRefs: parseRefs(value(row, "semanticRefs")) }));
    if (field === "routingAttributes") return rows.map((row) => ({ key: value(row, "key"), label: value(row, "label"), description: value(row, "description"), dataType: value(row, "dataType"), unit: value(row, "unit") || null, options: comma(value(row, "options")), canonicalKey: value(row, "canonicalKey") || null, appliesTo: value(row, "appliesTo") || "connection" }));
    if (field === "routingPresets") return rows.map((row) => ({ key: value(row, "key"), label: value(row, "label"), description: value(row, "description"), requirements: parseJson(value(row, "requirements"), []) }));
    if (field === "floors") return rows.map((row) => ({ key: value(row, "key"), label: value(row, "label"), map: { imageUrl: value(row, "imageUrl") || null, width: value(row, "width") ? Number(value(row, "width")) : null, height: value(row, "height") ? Number(value(row, "height")) : null } }));
    if (field === "places") return rows.map((row) => ({ ...(value(row, "_id") ? { _id: value(row, "_id") } : {}), typeKey: value(row, "typeKey"), label: value(row, "label"), floorKey: value(row, "floorKey"), position: { x: Number(value(row, "x")), y: Number(value(row, "y")) }, attributes: parseJson(value(row, "attributes"), {}) }));
    if (field === "venueTargetPlacements") return rows.map((row) => ({ venueTargetId: value(row, "venueTargetId"), primaryPlaceId: value(row, "primaryPlaceId"), placeIds: comma(value(row, "placeIds")) }));
    if (field === "connections") return rows.map((row) => ({ ...(value(row, "_id") ? { _id: value(row, "_id") } : {}), fromPlaceId: value(row, "fromPlaceId"), toPlaceId: value(row, "toPlaceId"), directionality: value(row, "directionality"), distanceMeters: Number(value(row, "distanceMeters")), additionalDelaySeconds: Number(value(row, "additionalDelaySeconds") || 0), attributes: parseJson(value(row, "attributes"), {}), instructions: { forward: value(row, "forward") || null, backward: value(row, "backward") || null } }));
    return [];
  },

  captureDraft() {
    if (!this.data) return null;
    const venueForm = this.querySelector("[data-venue-metadata]");
    const venueData = venueForm ? new FormData(venueForm) : null;
    const preVisit = this.querySelector('[name="preVisitInformation"]')?.value ?? (this.data.release?.preVisitInformation || []).join("\n");
    const bindingForm = this.querySelector("[data-target-bindings]");
    const targetBindings = this.data.release && bindingForm ? this.data.targets.map((entry) => {
      const card = bindingForm.querySelector(`[data-binding="${entry.id}"]`);
      if (!card?.querySelector('[name="included"]')?.checked) return null;
      return { venueTargetId: entry.id, availability: card.querySelector('[name="availability"]')?.value || "active", recognitionMedia: parseMedia(card.querySelector('[name="recognitionMedia"]')?.value || "") };
    }).filter(Boolean) : (this.data.release?.targetBindings || []);
    const layout = this.data.layout ? Object.fromEntries(LAYOUT_FIELDS.map((field) => [field, this.collectSection(field)])) : null;
    return {
      venue: venueData ? { name: String(venueData.get("name") || "").trim(), description: String(venueData.get("description") || "").trim() } : { name: this.data.venue.name, description: this.data.venue.description || "" },
      preVisitInformation: String(preVisit).split("\n").map((line) => line.trim()).filter(Boolean),
      targetBindings,
      layout,
    };
  },

  applyDraft(draft) {
    if (!draft || !this.data) return;
    Object.assign(this.data.venue, draft.venue || {});
    if (this.data.release) {
      this.data.release.preVisitInformation = draft.preVisitInformation || [];
      const bindingById = new Map((draft.targetBindings || []).map((entry) => [String(entry.venueTargetId), entry]));
      for (const target of this.data.targets) target.binding = bindingById.get(String(target.id)) || null;
    }
    if (this.data.layout && draft.layout) Object.assign(this.data.layout, draft.layout);
  },

  snapshotDraft() {
    const draft = this.captureDraft();
    this.applyDraft(draft);
    return draft;
  },

  async saveAll({ continueWorkflow = null } = {}) {
    let draft;
    try { draft = this.captureDraft(); }
    catch (error) { this.error = `JSON non valido: ${error.message}`; this.render(); return; }
    this.busy = true; this.error = null; this.message = null; this.render();
    try {
      await accountRepository.updateVenue(this.id, draft.venue);
      if (this.data.release && has(this.data.availableOperations, "venue.release.update")) {
        await managementRepository.updateVenueRelease(this.id, {
          preVisitInformation: draft.preVisitInformation,
          targetBindings: draft.targetBindings,
          layout: draft.layout,
        });
      }
      if (continueWorkflow) await this.runWorkflowRequest(continueWorkflow);
      this.data = await managementRepository.venue(this.id);
      this.dirty = false; this.pendingWorkflow = null; this.workflowMessage = ""; this.leaveConfirmation = false;
      this.message = continueWorkflow ? "Modifiche salvate e workflow aggiornato." : "Configurazione della sede salvata.";
    } catch (error) { this.error = error instanceof Error ? error.message : "Salvataggio non riuscito"; }
    finally { this.busy = false; this.render(); }
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

};
