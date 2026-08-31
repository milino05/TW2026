import { revisionWorkflowOperations } from "../application/revision-workflow.js";
import { statusPresentation } from "../application/status-presentation.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/**
 * Presentation-only workflow surface. The backend projection remains authoritative:
 * this component renders only the operations assigned through availableOperations.
 */
export class ArtAroundRevisionWorkflowControls extends HTMLElement {
  _availableOperations = [];
  _presentationOverrides = {};

  static get observedAttributes() { return ["status", "integrity-status", "busy", "actions-only"]; }

  set availableOperations(value) {
    this._availableOperations = Array.isArray(value) ? value : [];
    if (this.isConnected) this.render();
  }
  get availableOperations() { return this._availableOperations; }

  set presentationOverrides(value) {
    this._presentationOverrides = value && typeof value === "object" ? value : {};
    if (this.isConnected) this.render();
  }
  get presentationOverrides() { return this._presentationOverrides; }

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.render();
  }

  disconnectedCallback() { this.removeEventListener("click", this.onClick); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  operations() { return revisionWorkflowOperations(this._availableOperations, this._presentationOverrides); }

  onClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-revision-workflow-operation]") : null;
    if (!button || this.hasAttribute("busy")) return;
    const operation = this.operations().find((entry) => entry.code === button.dataset.revisionWorkflowOperation);
    if (!operation) return;
    this.dispatchEvent(new CustomEvent("artaround:revision-workflow-operation", {
      detail: { operation },
      bubbles: true,
      composed: true,
    }));
  };

  render() {
    const operations = this.operations();
    const revision = statusPresentation("revision", this.getAttribute("status") || "");
    const integrityState = this.getAttribute("integrity-status");
    const integrity = integrityState ? statusPresentation("integrity", integrityState) : null;
    const busy = this.hasAttribute("busy");
    const actionsOnly = this.hasAttribute("actions-only");
    this.innerHTML = `<section class="artaround-revision-workflow" aria-label="Workflow editoriale">
      ${actionsOnly ? "" : `<div class="artaround-revision-workflow__status">
        ${revision.state ? `<artaround-status-indicator tone="${escapeHtml(revision.tone)}">${escapeHtml(revision.label)}</artaround-status-indicator>` : ""}
        ${integrity ? `<artaround-status-indicator tone="${escapeHtml(integrity.tone)}">${escapeHtml(integrity.label)}</artaround-status-indicator>` : ""}
      </div>`}
      <div class="artaround-revision-workflow__actions">
        ${operations.map((operation) => `<button type="button" data-revision-workflow-operation="${escapeHtml(operation.code)}" data-intent="${escapeHtml(operation.presentation.intent)}" ${busy ? "disabled" : ""}>${escapeHtml(operation.presentation.label)}</button>`).join("")}
      </div>
    </section>`;
  }
}

if (!customElements.get("artaround-revision-workflow-controls")) {
  customElements.define("artaround-revision-workflow-controls", ArtAroundRevisionWorkflowControls);
}
