import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";
import { mountModalInteraction } from "../application/modal-interaction.js";
import { openVenueTargetCreateDialog } from "./venue-target-create-dialog.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function normalized(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function searchableTargetText(target) {
  return normalized([
    target?.label,
    target?.displayLabelOverride,
    target?.inventoryNote,
    target?.subject?.label,
    target?.subject?.preferredLabel,
    target?.subject?.description,
    target?.exhibitSlot?.label,
  ].filter(Boolean).join(" "));
}
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const venueInventorySearchMixin = {
  releaseInventoryDialog({ restoreFocus = false } = {}) {
    const layer = this._inventoryDialogLayer;
    if (layer) {
      if (this._inventoryDialogClickHandler) layer.removeEventListener("click", this._inventoryDialogClickHandler);
      if (this._inventoryDialogSubmitHandler) layer.removeEventListener("submit", this._inventoryDialogSubmitHandler);
    }
    this._inventoryDialogInteraction?.release?.({ restoreFocus });
    this._inventoryDialogInteraction = null;
    this._inventoryDialogLayer = null;
    this._inventoryDialogClickHandler = null;
    this._inventoryDialogSubmitHandler = null;
  },

  restoreInventoryLauncherFocus(targetId) {
    requestAnimationFrame(() => {
      const launcher = [...this.querySelectorAll("[data-select-venue-target]")]
        .find((button) => id(button.dataset.selectVenueTarget) === id(targetId));
      launcher?.focus?.({ preventScroll: true });
    });
  },

  closeInventoryDialog() {
    const targetId = this.selectedVenueTargetId;
    this.releaseInventoryDialog({ restoreFocus: false });
    this.selectedVenueTargetId = null;
    this.render();
    this.restoreInventoryLauncherFocus(targetId);
  },

  syncInventoryDialog() {
    if (!this.selectedVenueTargetId) {
      this.releaseInventoryDialog({ restoreFocus: false });
      return;
    }
    const layer = this.querySelector(".venue-inventory-modal-layer");
    if (!(layer instanceof HTMLElement)) {
      this.releaseInventoryDialog({ restoreFocus: false });
      return;
    }

    this.releaseInventoryDialog({ restoreFocus: false });
    const clickHandler = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-modal-dismiss]")) return;
      void this.onClick(event);
    };
    const submitHandler = (event) => { void this.onSubmit(event); };
    layer.addEventListener("click", clickHandler);
    layer.addEventListener("submit", submitHandler);
    this._inventoryDialogLayer = layer;
    this._inventoryDialogClickHandler = clickHandler;
    this._inventoryDialogSubmitHandler = submitHandler;
    this._inventoryDialogInteraction = mountModalInteraction({
      layer,
      panel: () => layer.querySelector(".venue-inventory-dialog"),
      kind: "modal",
      initialFocus: "[data-modal-dismiss]",
      canDismiss: () => !this.busy,
      onRequestDismiss: () => {
        this.closeInventoryDialog();
        return true;
      },
      lockScroll: true,
    });
  },

  openInventoryTargetCreateDialog() {
    if (this._targetCreateDialog) return;
    this._targetCreateDialog = openVenueTargetCreateDialog({
      venueId: this.id,
      onDismiss: () => { this._targetCreateDialog = null; },
      onExisting: (targetId) => {
        this._targetCreateDialog = null;
        this.selectedVenueTargetId = targetId;
        this.inventoryFilter = "all";
        this.message = "Questa identità è già presente nell’inventario della sede.";
        this.render();
      },
      onCreated: async () => {
        this._targetCreateDialog = null;
        this.busy = true;
        this.error = null;
        this.message = null;
        this.render();
        try {
          await this.refreshServerState();
          this.message = "Entità aggiunta all’inventario della sede.";
        } catch (error) {
          this.error = error instanceof Error ? error.message : "Inventario non aggiornabile";
        } finally {
          this.busy = false;
          this.render();
        }
      },
    });
  },

  async handleTargetMediaSubmit(form, data) {
    if (form.matches("[data-inventory-search-form]")) {
      this.inventorySearchQuery = String(data.get("inventoryQuery") || "").trim();
      this.selectedVenueTargetId = null;
      this.render();
      return true;
    }
    return venueTargetsMixin.handleTargetMediaSubmit.call(this, form, data);
  },

  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    if (target.closest("[data-open-target-create-dialog]")) {
      this.openInventoryTargetCreateDialog();
      return true;
    }

    if (target.closest("[data-clear-inventory-search]")) {
      this.inventorySearchQuery = "";
      this.selectedVenueTargetId = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-inventory-search-form] input")?.focus());
      return true;
    }

    const filter = target.closest("[data-inventory-filter]");
    if (filter) {
      this.inventoryFilter = filter.dataset.inventoryFilter || "all";
      const selectedTarget = (this.data.targets || []).find((entry) => id(entry.id) === id(this.selectedVenueTargetId));
      if (selectedTarget && this.inventoryFilter !== "all" && selectedTarget.configuration?.state !== this.inventoryFilter) this.selectedVenueTargetId = null;
      this.render();
      return true;
    }

    const selectTarget = target.closest("[data-select-venue-target]");
    if (selectTarget) {
      this.selectedVenueTargetId = selectTarget.dataset.selectVenueTarget;
      this.render();
      return true;
    }

    return venueTargetsMixin.handleTargetMediaClick.call(this, event);
  },

  renderTargets(editable) {
    const allTargets = this.data.targets || [];
    const query = normalized(this.inventorySearchQuery);
    const searchMatches = query
      ? allTargets.filter((target) => searchableTargetText(target).includes(query))
      : allTargets;
    if (this.selectedVenueTargetId && !searchMatches.some((entry) => id(entry.id) === id(this.selectedVenueTargetId))) this.selectedVenueTargetId = null;
    this.data.targets = searchMatches;
    let body;
    try {
      body = venueTargetsMixin.renderTargets.call(this, editable);
    } finally {
      this.data.targets = allTargets;
    }

    const visibleCount = searchMatches.filter((target) => this.inventoryFilter === "all" || target.configuration?.state === this.inventoryFilter).length;
    const search = `<form data-inventory-search-form class="venue-inventory-search" role="search"><label>Cerca nell’inventario<input name="inventoryQuery" value="${escapeHtml(this.inventorySearchQuery || "")}" placeholder="Es. Gioconda, Leonardo, Sala 2"></label><button class="button-secondary" type="submit">Cerca</button>${this.inventorySearchQuery ? `<button class="button-secondary" type="button" data-clear-inventory-search>Mostra tutte</button>` : ""}<span class="count">${visibleCount} entità</span></form>`;
    return `${search}${body}`;
  },
};
