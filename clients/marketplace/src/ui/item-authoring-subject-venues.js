import "./item-authoring-view.js";
import { openSubjectVenueDialog } from "./subject-venue-dialog.js";

function id(value) { return String(value?._id || value?.id || value || ""); }

function injectBeforeLastStepClose(html, addition) {
  const marker = "</div></section>";
  const index = html.lastIndexOf(marker);
  return index >= 0 ? `${html.slice(0, index)}${addition}${html.slice(index)}` : `${html}${addition}`;
}

export function installItemAuthoringSubjectVenueIntegration(ItemAuthoringView) {
  if (!ItemAuthoringView || ItemAuthoringView.__subjectVenueIntegrationInstalled) return;
  ItemAuthoringView.__subjectVenueIntegrationInstalled = true;
  const prototype = ItemAuthoringView.prototype;
  const baseConnected = prototype.connectedCallback;
  const baseDisconnected = prototype.disconnectedCallback;
  const baseRenderStepFour = prototype.renderStepFour;
  const baseRenderPrivateSuccessDialog = prototype.renderPrivateSuccessDialog;

  prototype.renderSubjectPresence = function renderSubjectPresenceOutsideAuthoringFlow() { return ""; };
  prototype.configureSubjectPresence = function configureSubjectPresenceOutsideAuthoringFlow() {};

  prototype.openSubjectVenueSurface = function openSubjectVenueSurface() {
    if (this.principal?.type !== "organization" || !this.selectedSubject || !this.itemId || this._subjectVenueDialog) return;
    this._subjectVenueDialog = openSubjectVenueDialog({
      subject: this.selectedSubject,
      subjectId: id(this.selectedSubject),
      sourceItemId: this.itemId,
      principal: this.principal,
      onDismiss: () => { this._subjectVenueDialog = null; },
    });
  };

  prototype._subjectVenueClickHandler = function subjectVenueClickHandler(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-open-subject-venues]")) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.privateSuccessOpen) {
      this.privateSuccessOpen = false;
      this.render();
    }
    this.openSubjectVenueSurface();
  };

  prototype.connectedCallback = function connectedWithSubjectVenue(...args) {
    baseConnected.apply(this, args);
    this.addEventListener("click", this._subjectVenueClickHandler);
  };
  prototype.disconnectedCallback = function disconnectedWithSubjectVenue(...args) {
    this.removeEventListener("click", this._subjectVenueClickHandler);
    this._subjectVenueDialog?.close?.({ restoreFocus: false, notify: false });
    this._subjectVenueDialog = null;
    baseDisconnected.apply(this, args);
  };

  prototype.renderStepFour = function renderStepFourWithSubjectVenue() {
    const html = baseRenderStepFour.call(this);
    if (!html || this.principal?.type !== "organization" || !this.itemId || !this.selectedSubject) return html;
    return injectBeforeLastStepClose(html, `<button class="button-secondary" type="button" data-open-subject-venues>Presenza nelle sedi</button>`);
  };

  prototype.renderPrivateSuccessDialog = function renderPrivateSuccessWithSubjectVenue() {
    const html = baseRenderPrivateSuccessDialog.call(this);
    if (!html || this.principal?.type !== "organization" || !this.itemId || !this.selectedSubject) return html;
    return html.replace("<button class=\"button-secondary\" type=\"button\" data-close-private-success>Mantieni privato</button>", `<button class="button-secondary" type="button" data-open-subject-venues>Presenza nelle sedi</button><button class="button-secondary" type="button" data-close-private-success>Mantieni privato</button>`);
  };
}

installItemAuthoringSubjectVenueIntegration(customElements.get("artaround-item-authoring-view"));
