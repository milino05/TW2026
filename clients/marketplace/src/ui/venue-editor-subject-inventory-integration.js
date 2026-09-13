import "./venue-editor-view.js";
import { icon } from "./icons.js";

export function installVenueSubjectInventoryIntegration(VenueEditorView) {
  if (!VenueEditorView || VenueEditorView.__subjectInventoryIntegrationInstalled) return;
  VenueEditorView.__subjectInventoryIntegrationInstalled = true;
  const prototype = VenueEditorView.prototype;
  const baseHandleTargetMediaClick = prototype.handleTargetMediaClick;
  const baseRenderInventoryBrowserSurface = prototype.renderInventoryBrowserSurface;

  prototype.handleTargetMediaClick = async function handleTargetMediaClickWithSubjectBrowser(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-open-inventory-subject-picker]")) {
      this.openInventoryTargetCreateDialog?.();
      return true;
    }
    return baseHandleTargetMediaClick.call(this, event);
  };

  prototype.renderInventoryBrowserSurface = function renderInventoryBrowserWithSubjectSource(editable, browser) {
    let html = baseRenderInventoryBrowserSurface.call(this, editable, browser);
    const capabilities = this.data?.inventoryCapabilities || {};
    const canSourceSubject = capabilities.canManage === true || capabilities.canPropose === true;
    const addButtonPattern = /<button class="venue-inventory-add-button"[^>]*data-open-inventory-subject-picker[^>]*>[\s\S]*?<\/button>/;
    if (!canSourceSubject) return html.replace(addButtonPattern, "");
    if (!addButtonPattern.test(html)) {
      const label = capabilities.canManage ? "Aggiungi entità all’inventario" : "Proponi entità all’inventario";
      const button = `<button class="venue-inventory-add-button" type="button" data-open-inventory-subject-picker aria-label="${label}" title="${label}">${icon("plus", { size: 18 })}</button>`;
      html = html.replace("</form>", `${button}</form>`);
    }
    return html;
  };

  prototype.renderInventorySubjectPickerOverlay = function renderInventorySubjectPickerViaSharedDialog() { return ""; };
}

installVenueSubjectInventoryIntegration(customElements.get("artaround-venue-editor-view"));
