function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function normalizedSteps(steps = []) {
  return steps.map((step, index) => typeof step === "string"
    ? { id: String(index + 1), label: step }
    : { id: String(step.id ?? index + 1), label: String(step.label || step.id || index + 1), ...step });
}

export function renderAuthoringStepper({
  steps = [],
  activeStep,
  ariaLabel = "Passaggi di creazione",
  canNavigate = () => true,
  isComplete = () => false,
} = {}) {
  const entries = normalizedSteps(steps);
  const activeIndex = Math.max(0, entries.findIndex((step) => String(step.id) === String(activeStep)));
  const current = entries[activeIndex] || entries[0];
  return `<nav class="artaround-authoring-stepper" aria-label="${escapeHtml(ariaLabel)}">
    <p class="artaround-authoring-stepper__summary">Passaggio ${entries.length ? activeIndex + 1 : 0} di ${entries.length}${current ? ` · ${escapeHtml(current.label)}` : ""}</p>
    <ol>
      ${entries.map((step, index) => {
        const active = index === activeIndex;
        const complete = Boolean(isComplete(step, index));
        const navigable = Boolean(canNavigate(step, index));
        return `<li data-current="${active}" data-complete="${complete}"><button type="button" data-authoring-step="${escapeHtml(step.id)}" data-step="${escapeHtml(step.id)}" ${active ? 'aria-current="step"' : ""} ${navigable ? "" : 'aria-disabled="true" disabled'}><span aria-hidden="true">${complete ? "✓" : index + 1}</span><strong>${escapeHtml(step.label)}</strong></button></li>`;
      }).join("")}
    </ol>
  </nav>`;
}

export function installAuthoringStepper(root, { onSelect, canSelect = () => true } = {}) {
  if (!(root instanceof Element) || typeof onSelect !== "function") throw new TypeError("installAuthoringStepper requires a root element and onSelect().");

  const buttons = () => [...root.querySelectorAll("button[data-authoring-step]")];
  const click = (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-authoring-step]") : null;
    if (!button || !root.contains(button) || button.getAttribute("aria-disabled") === "true") return;
    if (canSelect(button.dataset.authoringStep, button) !== false) onSelect(button.dataset.authoringStep, button);
  };
  const keydown = (event) => {
    const current = event.target instanceof Element ? event.target.closest("button[data-authoring-step]") : null;
    if (!current || !root.contains(current) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const entries = buttons().filter((button) => button.getAttribute("aria-disabled") !== "true");
    if (!entries.length) return;
    const index = Math.max(0, entries.indexOf(current));
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : event.key === "ArrowLeft" ? Math.max(0, index - 1) : Math.min(entries.length - 1, index + 1);
    event.preventDefault();
    entries[nextIndex]?.focus();
  };

  root.addEventListener("click", click);
  root.addEventListener("keydown", keydown);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("keydown", keydown);
  };
}
