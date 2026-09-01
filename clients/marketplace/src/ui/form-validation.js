let validationFeedbackSequence = 1;
let pendingFocus = null;

function validationMessage(control) {
  const validity = control.validity;
  if (validity.valueMissing) {
    return control instanceof HTMLSelectElement
      ? "Seleziona un'opzione prima di continuare."
      : "Compila questo campo prima di continuare.";
  }
  if (validity.typeMismatch) return "Inserisci un valore nel formato richiesto.";
  if (validity.tooShort) return `Inserisci almeno ${control.minLength} caratteri.`;
  if (validity.tooLong) return `Non superare ${control.maxLength} caratteri.`;
  if (validity.patternMismatch) return "Controlla il formato di questo campo.";
  if (validity.rangeUnderflow) return `Inserisci un valore non inferiore a ${control.min}.`;
  if (validity.rangeOverflow) return `Inserisci un valore non superiore a ${control.max}.`;
  if (validity.stepMismatch || validity.badInput) return "Inserisci un valore valido.";
  if (validity.customError && control.validationMessage) return control.validationMessage;
  return "Controlla questo campo prima di continuare.";
}

function feedbackContainer(control) {
  return control.closest("artaround-form-field") || control.closest("label") || control.parentElement;
}

function existingFeedback(control) {
  const container = feedbackContainer(control);
  return container?.querySelector?.('artaround-field-feedback[data-native-validation-feedback="true"]') || null;
}

function addDescription(control, feedbackId) {
  const ids = new Set(String(control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  ids.add(feedbackId);
  control.setAttribute("aria-describedby", [...ids].join(" "));
}

function removeDescription(control, feedbackId) {
  const ids = String(control.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== feedbackId);
  if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
  else control.removeAttribute("aria-describedby");
}

function showValidationFeedback(control) {
  const container = feedbackContainer(control);
  if (!container) return;
  let feedback = existingFeedback(control);
  if (!feedback) {
    feedback = document.createElement("artaround-field-feedback");
    feedback.dataset.nativeValidationFeedback = "true";
    feedback.setAttribute("tone", "danger");
    feedback.id = `artaround-validation-${validationFeedbackSequence++}`;
    container.append(feedback);
  }
  feedback.textContent = validationMessage(control);
  control.setAttribute("aria-invalid", "true");
  addDescription(control, feedback.id);
}

function clearValidationFeedback(control) {
  const feedback = existingFeedback(control);
  if (feedback) {
    removeDescription(control, feedback.id);
    feedback.remove();
  }
  if (control.validity.valid) control.removeAttribute("aria-invalid");
}

function scheduleInvalidFocus(control) {
  if (pendingFocus) return;
  pendingFocus = control;
  requestAnimationFrame(() => {
    const target = pendingFocus;
    pendingFocus = null;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  });
}

function isNativeConstraintControl(value) {
  return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement;
}

/*
 * Constraint Validation remains browser-authoritative, while ArtAround owns the
 * presentation of failures. Capturing invalid at document level prevents a mix
 * of browser tooltips and editor-specific setCustomValidity messages, and gives
 * every Marketplace form the same accessible inline feedback surface.
 */
document.addEventListener("invalid", (event) => {
  const control = event.target;
  if (!isNativeConstraintControl(control) || !control.closest("artaround-marketplace-app")) return;
  event.preventDefault();
  event.stopPropagation();
  showValidationFeedback(control);
  scheduleInvalidFocus(control);
}, true);

for (const eventName of ["input", "change"]) {
  document.addEventListener(eventName, (event) => {
    const control = event.target;
    if (!isNativeConstraintControl(control) || !control.closest("artaround-marketplace-app")) return;
    if (control.validity.valid) clearValidationFeedback(control);
  }, true);
}
