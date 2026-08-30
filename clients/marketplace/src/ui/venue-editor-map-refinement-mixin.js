import { icon } from "./icons.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";
import { venueSpatialOverlayMixin } from "./venue-editor-spatial-overlay-mixin.js";
import { venueContextualWorkspaceMixin } from "./venue-editor-contextual-workspace-mixin.js";
import { venueSlotSubjectUiMixin } from "./venue-editor-slot-subject-ui-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function mapPoint(event, surface) {
  const rect = surface?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return null;
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}
function sameFloor(a, b) { return id(a?.floorId) === id(b?.floorId); }
function svgPoint(point) { return `${Number(point?.x || 0) * 100},${Number(point?.y || 0) * 100}`; }

export const venueMapRefinementMixin = {
  ensureGlobalEscapeHandler() {
    if (this._venueGlobalEscapeHandler) return;
    this._venueGlobalEscapeHandler = (event) => {
      if (!this.isConnected) {
        window.removeEventListener("keydown", this._venueGlobalEscapeHandler, true);
        this._venueGlobalEscapeHandler = null;
        return;
      }
      if (event.key !== "Escape" || this.busy) return;
      let handled = true;
      if (this.pendingDestructiveAction) {
        this.pendingDestructiveAction = null;
        this.error = null;
        this.render();
      } else if (this.pendingTargetRemovalId) {
        this.pendingTargetRemovalId = null;
        this.error = null;
        this.render();
      } else if (this.pendingVenueRemoval) {
        this.pendingVenueRemoval = false;
        this.error = null;
        this.render();
      } else if (this.pendingWorkflow) {
        this.pendingWorkflow = null;
        this.workflowMessage = "";
        this.render();
      } else if (this.calibrationOverwritePrompt) {
        this.calibrationOverwritePrompt = null;
        this.render();
      } else if (this.mapCreationDialog) {
        this.closeMapCreationDialog?.();
        this.render();
      } else if (this.floorDialog) {
        this.floorDialog = null;
        this.render();
      } else if (this.spatialEditor) {
        this.closeSpatialEditor?.();
      } else if (this.pendingMapAction || this.draggingPlace) {
        this.cancelMapAction?.();
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", this._venueGlobalEscapeHandler, true);
  },

  render() {
    this.ensureGlobalEscapeHandler();
    venueSlotSubjectUiMixin.render.call(this);
    if (!this.data) return;
    this.decorateMapRefinements();
  },

  renderMapActionStatus() {
    const action = this.pendingMapAction;
    if (action?.type === "connect") {
      if (!action.fromPlaceId) return `<p class="venue-map-instruction active"><strong>Collega luoghi</strong> · seleziona il luogo di partenza.</p>`;
      if (!action.toPlaceId) {
        const pointCount = (action.waypoints || []).length;
        return `<p class="venue-map-instruction active"><strong>Disegna il collegamento</strong> · clicca sulla planimetria per aggiungere punti intermedi${pointCount ? ` (${pointCount})` : ""}, poi clicca sul luogo di destinazione. Esc annulla.</p>`;
      }
      return `<p class="venue-map-instruction active"><strong>Percorso definito</strong> · completa tipo, direzione e metrica nel pannello aperto.</p>`;
    }
    return venueSpatialMixin.renderMapActionStatus.call(this);
  },

  decorateMapRefinements() {
    const floor = this.activeFloor?.();
    const calibrate = this.querySelector('[data-map-tool="calibrate"]');
    if (calibrate && floor?.calibration) {
      calibrate.classList.add("calibrated");
      calibrate.innerHTML = `${icon("check", { size: 15 })} Calibrato`;
      calibrate.title = "Il piano è già calibrato. Clicca per ricalibrare.";
    }

    const dialog = this.querySelector(".venue-spatial-dialog-frame");
    const danger = dialog?.querySelector(".venue-detail-danger .danger");
    if (dialog && danger) {
      const dangerZone = danger.closest(".venue-detail-danger");
      const label = danger.textContent?.trim() || "Rimuovi elemento";
      danger.className = "danger venue-spatial-dialog-delete";
      danger.innerHTML = icon("trash", { size: 17 });
      danger.setAttribute("aria-label", label);
      danger.setAttribute("title", label);
      dialog.querySelector(".venue-spatial-dialog-close")?.insertAdjacentElement("beforebegin", danger);
      dangerZone?.remove();
    }

    this.renderConnectionDraftPreview();
  },

  renderConnectionDraftPreview() {
    const svg = this.querySelector(".map-canvas--authoring svg");
    svg?.querySelector(".connection-draft-preview")?.remove();
    const action = this.pendingMapAction;
    if (!svg || action?.type !== "connect" || !action.fromPlaceId) return;
    const from = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(action.fromPlaceId));
    if (!from || id(from.floorId) !== id(this.activeFloorId?.())) return;
    const to = action.toPlaceId ? (this.data.layout?.places || []).find((entry) => id(entry._id) === id(action.toPlaceId)) : null;
    const tail = to && sameFloor(from, to) ? to.position : action.cursorPoint;
    const points = [from.position, ...(action.waypoints || []), ...(tail ? [tail] : [])];
    if (points.length < 2) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "connection-draft-preview");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.map(svgPoint).join(" "));
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("class", "connection-draft-line");
    group.append(line);
    for (const point of action.waypoints || []) {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      marker.setAttribute("cx", String(Number(point.x) * 100));
      marker.setAttribute("cy", String(Number(point.y) * 100));
      marker.setAttribute("r", "1");
      marker.setAttribute("class", "connection-draft-waypoint");
      group.append(marker);
    }
    svg.append(group);
  },

  onMapPointerMove(event) {
    venueMapAuthoringMixin.onMapPointerMove.call(this, event);
    const action = this.pendingMapAction;
    if (action?.type !== "connect" || !action.fromPlaceId || action.toPlaceId) return;
    const surface = event.target instanceof Element ? event.target.closest("[data-map-surface]") : null;
    if (!surface || id(surface.dataset.floorId) !== id(action.floorId)) return;
    const point = mapPoint(event, surface);
    if (!point) return;
    action.cursorPoint = point;
    this.renderConnectionDraftPreview();
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    if (target.closest("[data-cancel-calibration-overwrite]")) {
      this.calibrationOverwritePrompt = null;
      this.render();
      return true;
    }
    if (target.closest("[data-confirm-calibration-overwrite]")) {
      const floorId = this.calibrationOverwritePrompt?.floorId;
      this.calibrationOverwritePrompt = null;
      if (floorId) this.pendingMapAction = { type: "calibrate", floorId, points: [] };
      this.render();
      return true;
    }
    if (target.matches("[data-calibration-overwrite-backdrop]")) {
      this.calibrationOverwritePrompt = null;
      this.render();
      return true;
    }
    if (target.closest("[data-cancel-calibration-distance]") || target.matches("[data-calibration-distance-backdrop]")) {
      this.pendingMapAction = null;
      this.render();
      return true;
    }

    const calibrateTool = target.closest('[data-map-tool="calibrate"]');
    if (calibrateTool) {
      const floor = this.activeFloor?.();
      if (!floor) return true;
      if (floor.calibration) {
        this.calibrationOverwritePrompt = { floorId: id(floor._id) };
        this.render();
        requestAnimationFrame(() => this.querySelector("[data-confirm-calibration-overwrite]")?.focus());
      } else {
        this.pendingMapAction = { type: "calibrate", floorId: id(floor._id), points: [] };
        this.render();
      }
      return true;
    }

    const connectTool = target.closest('[data-map-tool="connect"], [data-context-start-connection]');
    if (connectTool) {
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      this.error = null;
      this.pendingMapAction = { type: "connect", fromPlaceId: null, toPlaceId: null, floorId: null, waypoints: [], cursorPoint: null };
      this.render();
      return true;
    }

    const action = this.pendingMapAction;
    if (action?.type === "connect") {
      if (target.closest("[data-map-connection]")) return true;
      const placeNode = target.closest("[data-map-place]");
      if (placeNode) {
        const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(placeNode.dataset.mapPlace));
        if (!place) return true;
        if (!action.fromPlaceId) {
          action.fromPlaceId = id(place._id);
          action.floorId = id(place.floorId);
          action.waypoints = [];
          action.cursorPoint = place.position;
          this.selectedFloorId = id(place.floorId);
          this.render();
          return true;
        }
        if (id(action.fromPlaceId) === id(place._id)) return true;
        const from = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(action.fromPlaceId));
        if ((action.waypoints || []).length && !sameFloor(from, place)) {
          this.error = "I punti intermedi descrivono una geometria planare e non possono terminare su un altro piano. Annulla il collegamento e creane uno cross-floor senza punti intermedi.";
          this.render();
          return true;
        }
        action.toPlaceId = id(place._id);
        action.cursorPoint = null;
        this.mapCreationDialog = { type: "connection" };
        this.render();
        requestAnimationFrame(() => this.querySelector("[data-connection-composer] select")?.focus());
        return true;
      }

      const surface = target.closest("[data-map-surface]");
      if (surface && action.fromPlaceId && !action.toPlaceId) {
        if (id(surface.dataset.floorId) !== id(action.floorId)) return true;
        const point = mapPoint(event, surface);
        if (!point) return true;
        action.waypoints = [...(action.waypoints || []), point].slice(0, 40);
        action.cursorPoint = point;
        this.render();
        return true;
      }
    }

    return venueSpatialOverlayMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-connection-composer]")) {
      const action = this.pendingMapAction;
      if (action?.type !== "connect" || !action.fromPlaceId || !action.toPlaceId) return true;
      const from = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(action.fromPlaceId));
      const to = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(action.toPlaceId));
      if (!from || !to) return true;
      const metricMode = String(data.get("metricMode") || "manual_override");
      const payload = {
        fromPlaceId: action.fromPlaceId,
        toPlaceId: action.toPlaceId,
        connectionTypeDefinitionId: String(data.get("connectionTypeDefinitionId") || "") || null,
        directionality: String(data.get("directionality") || "bidirectional"),
        metricMode,
        additionalDelaySeconds: Number(data.get("additionalDelaySeconds") || 0),
      };
      if (metricMode !== "geometry_derived") payload.distanceMeters = Number(data.get("distanceMeters"));
      if (sameFloor(from, to) && (action.waypoints || []).length) {
        payload.geometryPoints = [
          { x: Number(from.position.x), y: Number(from.position.y) },
          ...(action.waypoints || []).map((point) => ({ x: Number(point.x), y: Number(point.y) })),
          { x: Number(to.position.x), y: Number(to.position.y) },
        ];
      }
      const before = new Set((this.data.layout?.connections || []).map((entry) => id(entry._id)));
      const success = await this.execute(() => managementRepository.createVenueConnection(this.id, payload), "Collegamento aggiunto alla mappa.");
      if (success) {
        const created = (this.data.layout?.connections || []).find((entry) => !before.has(id(entry._id)));
        this.pendingMapAction = null;
        this.mapCreationDialog = null;
        this.activeSpatialTab = "map";
        if (created) this.openSpatialEditor?.("connection", id(created._id));
        else this.render();
      }
      return true;
    }
    return venueSpatialOverlayMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  renderCalibrationComposer(editable) {
    const action = this.pendingMapAction;
    if (!editable || action?.type !== "calibrate" || action.points?.length !== 2) return "";
    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(action.floorId));
    return `<div class="venue-modal-backdrop venue-calibration-distance-backdrop" data-calibration-distance-backdrop role="presentation"><section class="venue-modal-card venue-calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-calibration-distance-title"><header><div><span class="eyebrow">Calibrazione · ${escapeHtml(floor?.label || "Piano")}</span><h3 id="venue-calibration-distance-title">Inserisci la distanza reale</h3></div><button class="button-secondary small" type="button" data-cancel-calibration-distance aria-label="Chiudi">×</button></header><p>Hai indicato i due estremi sulla planimetria. Inserisci la distanza reale tra quei punti.</p><form data-calibration-distance class="venue-inline-form"><label>Distanza reale (m)<input name="distanceMeters" type="number" min="0.01" step="0.01" required autofocus></label><div class="button-row"><button type="submit">${icon("check", { size: 15 })} Conferma calibrazione</button><button class="button-secondary" type="button" data-cancel-calibration-distance>Annulla</button></div></form></section></div>`;
  },

  renderMapCreationDialog(editable) {
    const base = venueContextualWorkspaceMixin.renderMapCreationDialog.call(this, editable);
    const prompt = this.calibrationOverwritePrompt;
    if (!editable || !prompt) return base;
    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(prompt.floorId));
    const overwrite = `<div class="venue-modal-backdrop venue-calibration-overwrite-backdrop" data-calibration-overwrite-backdrop role="presentation"><section class="venue-modal-card venue-calibration-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-calibration-overwrite-title"><header><div><span class="eyebrow">Calibrazione · ${escapeHtml(floor?.label || "Piano")}</span><h3 id="venue-calibration-overwrite-title">Il piano è già calibrato</h3></div><button class="button-secondary small" type="button" data-cancel-calibration-overwrite aria-label="Chiudi">×</button></header><p>Il piano è già calibrato, vuoi sovrascrivere la calibratura?</p><div class="button-row"><button type="button" data-confirm-calibration-overwrite>Sì, ricalibra</button><button class="button-secondary" type="button" data-cancel-calibration-overwrite>No</button></div></section></div>`;
    return `${base}${overwrite}`;
  },

  renderDestructiveActionConfirmation() {
    const action = this.pendingDestructiveAction;
    if (!action) return "";
    return `<div class="venue-modal-backdrop venue-destructive-confirmation-backdrop" role="presentation"><section class="venue-modal-card venue-destructive-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="venue-destructive-confirmation-title"><header><div><span class="eyebrow">Conferma rimozione</span><h3 id="venue-destructive-confirmation-title">${escapeHtml(action.title || "Confermare l’operazione?")}</h3></div><button class="button-secondary small" type="button" data-cancel-destructive-action aria-label="Chiudi">×</button></header><p>${escapeHtml(action.description || "Questa operazione modifica la configurazione fisica di lavoro.")}</p><div class="button-row"><button class="danger" type="button" data-confirm-destructive-action ${this.busy ? "disabled" : ""}>${escapeHtml(action.confirmLabel || "Conferma")}</button><button class="button-secondary" type="button" data-cancel-destructive-action ${this.busy ? "disabled" : ""}>Annulla</button></div></section></div>`;
  },
};
