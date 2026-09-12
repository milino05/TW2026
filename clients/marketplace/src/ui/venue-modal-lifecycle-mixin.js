import { mountModalInteraction } from "../application/modal-interaction.js";

function modalPanel(layer) {
  return layer.querySelector(".venue-modal-card, .venue-spatial-dialog-frame");
}

function dismissVenueModal(editor, layer) {
  if (layer.matches(".venue-spatial-editor-backdrop")) {
    editor.closeSpatialEditor?.();
    return;
  }
  if (layer.matches(".venue-calibration-distance-backdrop")) {
    editor.pendingMapAction = null;
    editor.render();
    return;
  }
  if (layer.matches(".venue-calibration-overwrite-backdrop")) {
    editor.calibrationOverwritePrompt = null;
    editor.render();
    return;
  }
  if (editor.mapCreationDialog) {
    editor.closeMapCreationDialog?.();
    editor.render();
    return;
  }
  if (editor.floorDialog) {
    editor.floorDialog = null;
    editor.render();
  }
}

/**
 * Venue keeps domain-specific map/floor renderers, while this mixin owns the
 * application-modal mechanics. Portalled events are explicitly delegated back
 * to the editor because moving a layer under document.body breaks normal
 * custom-element bubbling.
 */
export const venueModalLifecycleMixin = {
  releaseVenueModalLayers({ restoreFocus = false } = {}) {
    for (const record of this._venueModalLayers || []) {
      const { layer, click, submit, change, input, interaction } = record;
      layer.removeEventListener("click", click);
      layer.removeEventListener("submit", submit);
      layer.removeEventListener("change", change);
      layer.removeEventListener("input", input);
      interaction.release({ restoreFocus });
    }
    this._venueModalLayers = [];
  },

  syncVenueModalLayers() {
    this.releaseVenueModalLayers({ restoreFocus: false });
    const layers = [...this.querySelectorAll(".venue-modal-backdrop")]
      .filter((layer) => layer instanceof HTMLElement && modalPanel(layer));
    this._venueModalLayers = layers.map((layer) => {
      layer.dataset.modalBackdrop = "true";
      const click = (event) => { void this.onClick(event); };
      const submit = (event) => { void this.onSubmit(event); };
      const change = (event) => { this.onChange?.(event); };
      const input = (event) => { this.onInput?.(event); };
      layer.addEventListener("click", click);
      layer.addEventListener("submit", submit);
      layer.addEventListener("change", change);
      layer.addEventListener("input", input);
      const interaction = mountModalInteraction({
        layer,
        panel: () => modalPanel(layer),
        kind: "modal",
        initialFocus: () => layer.querySelector("[autofocus], input:not([type=hidden]), select, textarea, button"),
        dismissSelector: "[data-close-floor-dialog], [data-close-map-creation-dialog], [data-close-spatial-editor], [data-cancel-calibration-distance]",
        backdropSelector: "[data-modal-backdrop]",
        canDismiss: () => !this.busy,
        onRequestDismiss: () => {
          dismissVenueModal(this, layer);
          return true;
        },
        lockScroll: true,
      });
      return { layer, click, submit, change, input, interaction };
    });
  },
};
