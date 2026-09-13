import { icon } from "./icons.js";
import { venueSlotInventoryMixin } from "./venue-editor-slot-inventory-mixin.js";

const addButtonPattern = /<button class="venue-inventory-add-button"[^>]*data-open-inventory-subject-picker[^>]*>[\s\S]*?<\/button>/;

export const venueSubjectInventoryMixin = {
  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-open-inventory-subject-picker]")) {
      this.openInventoryTargetCreateDialog?.();
      return true;
    }
    return venueSlotInventoryMixin.handleTargetMediaClick.call(this, event);
  },

  renderInventoryBrowserSurface(editable, browser) {
    let html = venueSlotInventoryMixin.renderInventoryBrowserSurface.call(this, editable, browser);
    const capabilities = this.data?.inventoryCapabilities || {};
    const canSourceSubject = capabilities.canManage === true || capabilities.canPropose === true;
    if (!canSourceSubject) return html.replace(addButtonPattern, "");

    const label = capabilities.canManage ? "Aggiungi entità all’inventario" : "Proponi entità all’inventario";
    const button = `<button class="venue-inventory-add-button" type="button" data-open-inventory-subject-picker aria-label="${label}" title="${label}">${icon("plus", { size: 18 })}</button>`;
    if (addButtonPattern.test(html)) return html.replace(addButtonPattern, button);
    return html.replace("</form>", `${button}</form>`);
  },

  renderInventorySubjectPickerOverlay() { return ""; },
};
