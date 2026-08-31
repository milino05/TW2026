let fieldSequence = 1;

function ensureId(element, prefix) {
  if (!element.id) element.id = `${prefix}-${fieldSequence++}`;
  return element.id;
}

export class ArtAroundFormField extends HTMLElement {
  observer = null;

  connectedCallback() {
    this.synchronize();
    this.observer = new MutationObserver(() => this.synchronize());
    this.observer.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  }

  disconnectedCallback() { this.observer?.disconnect(); this.observer = null; }

  synchronize() {
    const control = this.querySelector("input, textarea, select, [role='combobox'], [contenteditable='true']");
    if (!(control instanceof HTMLElement)) return;
    const controlId = ensureId(control, "artaround-field");
    const label = this.querySelector("label");
    if (label instanceof HTMLLabelElement && !label.htmlFor) label.htmlFor = controlId;

    const descriptions = [...this.querySelectorAll("[data-field-help], artaround-field-feedback")]
      .filter((entry) => !entry.hasAttribute("hidden") && String(entry.textContent || "").trim());
    const descriptionIds = descriptions.map((entry) => ensureId(entry, "artaround-field-description"));
    if (descriptionIds.length) control.setAttribute("aria-describedby", descriptionIds.join(" "));
    else control.removeAttribute("aria-describedby");

    const feedback = descriptions.find((entry) => entry.matches("artaround-field-feedback"));
    if (feedback) control.setAttribute("aria-invalid", "true");
    else if (control.getAttribute("aria-invalid") === "true" && this.hasAttribute("managed-validity")) control.removeAttribute("aria-invalid");
  }
}

if (!customElements.get("artaround-form-field")) customElements.define("artaround-form-field", ArtAroundFormField);
