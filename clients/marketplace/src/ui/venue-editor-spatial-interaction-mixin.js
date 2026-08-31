import { venueContextualWorkspaceMixin } from "./venue-editor-contextual-workspace-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }

export const venueSpatialInteractionMixin = {
  locateExhibitSlot(exhibitSlotId) {
    const slot = (this.data.layout?.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(exhibitSlotId));
    const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(slot?.placeId));
    if (!slot || !place) return false;
    this.spatialEditor = null;
    this.selectedExhibitSlotId = id(slot.exhibitSlotId);
    this.selectedMapPlaceId = id(place._id);
    this.selectedConnectionId = null;
    this.selectedFloorId = id(place.floorId);
    this.activeSpatialTab = "map";
    this.render();
    requestAnimationFrame(() => this.querySelector(`[data-map-place="${CSS.escape(id(place._id))}"]`)?.focus());
    return true;
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    const locateSlot = target.closest("[data-locate-slot]");
    if (locateSlot) {
      this.locateExhibitSlot(locateSlot.dataset.locateSlot);
      return true;
    }

    if (this.spatialEditor) {
      const removePlace = target.closest("[data-remove-place][data-label]");
      if (removePlace) {
        await this.requestLayoutRemoval({ type: "place", id: removePlace.dataset.removePlace, label: removePlace.dataset.label || "questo luogo" });
        return true;
      }
      const removeConnection = target.closest("[data-remove-connection][data-label]");
      if (removeConnection) {
        const label = removeConnection.dataset.label || "questo collegamento";
        this.requestDestructiveAction({ type: "connection", id: removeConnection.dataset.removeConnection, title: `Rimuovere “${label}”?`, description: "Il collegamento non sarà più disponibile nel grafo della bozza.", confirmLabel: "Rimuovi collegamento", successMessage: "Collegamento rimosso." });
        return true;
      }
      const removeSlot = target.closest("[data-remove-slot][data-label]");
      if (removeSlot) {
        await this.requestLayoutRemoval({ type: "exhibit-slot", id: removeSlot.dataset.removeSlot, label: removeSlot.dataset.label || "questo slot" });
        return true;
      }
    }

    return venueContextualWorkspaceMixin.handleMapAuthoringClick.call(this, event);
  },
};
