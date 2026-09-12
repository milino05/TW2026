import { mountModalInteraction } from "../application/modal-interaction.js";

const DISMISS_SELECTOR = [
  "[data-close-floor-dialog]",
  "[data-close-map-creation-dialog]",
  "[data-close-spatial-editor]",
  "[data-cancel-calibration-distance]",
  "[data-close-inventory-browser]",
  "[data-close-inventory-subject-picker]",
].join(", ");

function prepareVenueModalPanel(layer) {
  const taskPanel = layer.querySelector(".venue-modal-card");
  if (!(taskPanel instanceof HTMLElement)) return layer.querySelector(".venue-spatial-dialog-frame");
  layer.classList.add("artaround-modal-layer");
  taskPanel.classList.add("artaround-task-modal");
  if (taskPanel.matches(".venue-inventory-browser-dialog")) taskPanel.classList.add("artaround-task-modal--large");
  else if (taskPanel.matches(".venue-floor-settings-dialog, .venue-inventory-subject-dialog, .venue-connection-create-dialog")) {
    // Default shared width keeps these configuration tasks readable without
    // turning them into full workspace editors.
  } else taskPanel.classList.add("artaround-task-modal--compact");

  const header = [...taskPanel.children].find((child) => child instanceof HTMLElement && child.matches("header")) || null;
  if (header) header.classList.add("artaround-task-modal__header");

  const fixedFooter = taskPanel.matches(".venue-inventory-browser-dialog")
    ? taskPanel.querySelector(".venue-inventory-browser-footer")
    : null;
  fixedFooter?.remove();
  if (fixedFooter instanceof HTMLElement) fixedFooter.classList.add("artaround-task-modal__footer");

  const body = document.createElement("div");
  body.className = "artaround-task-modal__body venue-modal-card__body";
  const bodyChildren = [...taskPanel.children].filter((child) => child !== header && child !== fixedFooter);
  body.replaceChildren(...bodyChildren);
  if (header) header.after(body);
  else {
    taskPanel.classList.add("venue-modal-card--headerless");
    taskPanel.prepend(body);
  }
  if (fixedFooter) taskPanel.append(fixedFooter);
  return taskPanel;
}

function dismissVenueModal(editor, layer) {
  if (layer.matches(".venue-inventory-subject-backdrop")) {
    editor.inventorySubjectPickerOpen = false;
    editor.inventoryPendingSubject = null;
    editor.render();
    return;
  }
  if (layer.matches(".venue-inventory-browser-backdrop")) {
    editor.inventoryBrowser = null;
    editor.render();
    return;
  }
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
 * application-modal mechanics. Bounded Venue cards are normalized onto the
 * shared Task Modal shell before they are portalled. The long spatial editor
 * remains a specialized workspace-modal, but still shares LayerManager focus,
 * Escape and scroll locking.
 */
export const venueModalLifecycleMixin = {
  releaseVenueModalLayers({ restoreFocus = false } = {}) {
    for (const record of this._venueModalLayers || []) {
      const { layer, click, submit, change, input, subjectSelected, interaction } = record;
      layer.removeEventListener("click", click);
      layer.removeEventListener("submit", submit);
      layer.removeEventListener("change", change);
      layer.removeEventListener("input", input);
      layer.removeEventListener("subject-selected", subjectSelected);
      interaction.release({ restoreFocus });
    }
    this._venueModalLayers = [];
  },

  syncVenueModalLayers() {
    this.releaseVenueModalLayers({ restoreFocus: false });
    const layers = [...this.querySelectorAll(".venue-modal-backdrop")]
      .filter((layer) => layer instanceof HTMLElement);
    this._venueModalLayers = layers.map((layer) => {
      const panel = prepareVenueModalPanel(layer);
      if (!(panel instanceof HTMLElement)) return null;
      layer.dataset.modalBackdrop = "true";
      const click = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target === layer || target.closest(DISMISS_SELECTOR)) return;
        void this.onClick(event);
      };
      const submit = (event) => { void this.onSubmit(event); };
      const change = (event) => { this.onChange?.(event); };
      const input = (event) => { this.onInput?.(event); };
      const subjectSelected = (event) => { this.onSubjectSelected?.(event); };
      layer.addEventListener("click", click);
      layer.addEventListener("submit", submit);
      layer.addEventListener("change", change);
      layer.addEventListener("input", input);
      layer.addEventListener("subject-selected", subjectSelected);
      const interaction = mountModalInteraction({
        layer,
        panel: () => panel,
        kind: "modal",
        initialFocus: "[autofocus], input:not([type=hidden]), select, textarea, button",
        dismissSelector: DISMISS_SELECTOR,
        backdropSelector: "[data-modal-backdrop]",
        canDismiss: () => !this.busy,
        onRequestDismiss: () => {
          dismissVenueModal(this, layer);
          return true;
        },
        lockScroll: true,
      });
      return { layer, click, submit, change, input, subjectSelected, interaction };
    }).filter(Boolean);
  },
};
