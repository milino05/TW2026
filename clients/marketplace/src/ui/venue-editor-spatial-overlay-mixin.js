import { venueSpatialDetailMixin } from "./venue-editor-spatial-detail-mixin.js";
import { venueSpatialInteractionMixin } from "./venue-editor-spatial-interaction-mixin.js";
import { venueContextualWorkspaceMixin } from "./venue-editor-contextual-workspace-mixin.js";

export const venueSpatialOverlayMixin = {
  renderSpatialEditor(editable) {
    const detail = venueSpatialDetailMixin.renderSpatialEditor.call(this, editable);
    if (!detail) return "";
    return `<div class="venue-canvas-layout venue-canvas-layout--full venue-spatial-underlay">${this.renderMapPreview(editable)}</div><div class="venue-modal-backdrop venue-spatial-editor-backdrop" data-spatial-editor-backdrop role="presentation"><div class="venue-spatial-dialog-frame" role="dialog" aria-modal="true" aria-label="Modifica elemento della mappa"><button class="button-secondary venue-spatial-dialog-close" type="button" data-close-spatial-editor aria-label="Chiudi pannello">×</button>${detail}</div></div>`;
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    if (target.matches("[data-spatial-editor-backdrop]")) {
      this.closeSpatialEditor?.();
      return true;
    }

    if (target.closest("[data-spatial-editor-tab], [data-close-spatial-editor], [data-position-place], [data-edit-connection-geometry]")) {
      return venueSpatialDetailMixin.handleMapAuthoringClick.call(this, event);
    }

    return venueSpatialInteractionMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-detail-create-slot], [data-length-constraint-authoring]")) {
      return venueSpatialDetailMixin.handleMapAuthoringSubmit.call(this, form, data);
    }
    return venueContextualWorkspaceMixin.handleMapAuthoringSubmit.call(this, form, data);
  },
};
