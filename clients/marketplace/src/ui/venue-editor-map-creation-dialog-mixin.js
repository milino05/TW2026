import { venueFloorDialogMixin } from "./venue-editor-floor-dialog-mixin.js";
import { venueSpatialMixin } from "./venue-editor-spatial-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export const venueMapCreationDialogMixin = {
  closeMapCreationDialog() {
    if (this.mapCreationDialog?.type === "connection" && this.pendingMapAction?.type === "connect") {
      this.pendingMapAction = null;
    }
    this.mapCreationDialog = null;
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    if (target.closest("[data-close-map-creation-dialog]")) {
      this.closeMapCreationDialog();
      this.render();
      return true;
    }

    const createPlace = target.closest(".venue-map-toolbar [data-show-spatial-tab='places']");
    if (createPlace) {
      const floor = this.activeFloor?.();
      if (!floor) return true;
      this.mapCreationDialog = { type: "place", floorId: id(floor._id) };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-map-place-dialog] input[name=label]")?.focus());
      return true;
    }

    const handled = await venueFloorDialogMixin.handleMapAuthoringClick.call(this, event);
    if (handled && this.pendingMapAction?.type === "connect" && this.pendingMapAction.fromPlaceId && this.pendingMapAction.toPlaceId) {
      this.mapCreationDialog = { type: "connection" };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-map-connection-dialog] select")?.focus());
    }
    return handled;
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-map-place-dialog]")) {
      const floorId = this.mapCreationDialog?.floorId || this.activeFloorId?.();
      if (!floorId) return true;
      this.selectedFloorId = floorId;
      const shadow = document.createElement("form");
      shadow.dataset.placePositioning = "";
      for (const [name, value] of data.entries()) {
        const input = document.createElement("input");
        input.name = name;
        input.value = String(value);
        shadow.append(input);
      }
      const handled = await venueFloorDialogMixin.handleMapAuthoringSubmit.call(this, shadow, new FormData(shadow));
      if (handled) {
        this.mapCreationDialog = null;
        this.activeSpatialTab = "map";
        this.render();
      }
      return true;
    }

    if (form.matches("[data-connection-composer]")) {
      const handled = await venueFloorDialogMixin.handleMapAuthoringSubmit.call(this, form, data);
      if (handled && this.pendingMapAction?.type !== "connect") {
        this.mapCreationDialog = null;
        this.activeSpatialTab = "map";
        this.render();
      }
      return true;
    }

    return venueFloorDialogMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  renderMapCreationDialog(editable) {
    if (!editable || !this.mapCreationDialog) return "";

    if (this.mapCreationDialog.type === "place") {
      const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(this.mapCreationDialog.floorId));
      const definitions = this.physicalDefinitions();
      if (!floor || !definitions.placeTypes.length) return "";
      return `<div class="venue-modal-backdrop" role="presentation"><section class="venue-modal-card" role="dialog" aria-modal="true" aria-labelledby="venue-place-create-title"><header><div><span class="eyebrow">Nuovo luogo</span><h3 id="venue-place-create-title">Definisci il Place prima di posizionarlo</h3></div><button class="button-secondary small" type="button" data-close-map-creation-dialog aria-label="Chiudi">×</button></header><p>Il luogo sarà creato soltanto dopo che avrai scelto la sua posizione sulla mappa di <strong>${escapeHtml(floor.label)}</strong>.</p><form data-map-place-dialog class="venue-inline-form"><label>Nome<input name="label" placeholder="Es. Sala 1"></label><label>Tipo<select name="placeTypeDefinitionId" required>${definitions.placeTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}">${escapeHtml(type.label)}</option>`).join("")}</select></label><div class="button-row"><button type="submit">Continua sulla mappa</button><button class="button-secondary" type="button" data-close-map-creation-dialog>Annulla</button></div></form></section></div>`;
    }

    if (this.mapCreationDialog.type === "connection") {
      const action = this.pendingMapAction;
      if (action?.type !== "connect" || !action.fromPlaceId || !action.toPlaceId) return "";
      const composer = venueSpatialMixin.renderConnectionComposer.call(this, true);
      return `<div class="venue-modal-backdrop" role="presentation"><section class="venue-modal-card venue-connection-create-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-connection-create-title"><header><div><span class="eyebrow">Nuovo collegamento</span><h3 id="venue-connection-create-title">Configura il percorso selezionato</h3></div><button class="button-secondary small" type="button" data-close-map-creation-dialog aria-label="Chiudi">×</button></header>${composer}<p class="note">Le istruzioni direzionali e l’eventuale geometria dettagliata possono essere rifinite dall’inspector dopo la creazione.</p></section></div>`;
    }

    return "";
  },

  renderMapAndPlaces(editable) {
    return `${venueFloorDialogMixin.renderMapAndPlaces.call(this, editable)}${this.renderMapCreationDialog(editable)}`;
  },
};
