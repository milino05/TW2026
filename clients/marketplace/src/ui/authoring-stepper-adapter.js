import { renderAuthoringStepper } from "./authoring-stepper.js";

const HOSTS = Object.freeze([
  "artaround-item-authoring-view",
  "artaround-visit-authoring-view",
]);

function text(value) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function projectHost(host) {
  const legacy = host.querySelector("nav.authoring-progress");
  if (!(legacy instanceof HTMLElement) || legacy.dataset.artaroundStepperProjected === "true") return;

  const buttons = [...legacy.querySelectorAll("button[data-step]")];
  if (!buttons.length) return;

  const steps = buttons.map((button, index) => ({
    id: String(button.dataset.step || index + 1),
    label: text(button.querySelector("strong")) || `Passaggio ${index + 1}`,
  }));
  const activeButton = buttons.find((button) => button.getAttribute("aria-current") === "step" || button.closest("li")?.dataset.current === "true") || buttons[0];
  const navigable = new Set(buttons.filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true").map((button) => String(button.dataset.step)));
  const complete = new Set(buttons.filter((button) => button.closest("li")?.dataset.complete === "true").map((button) => String(button.dataset.step)));

  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderAuthoringStepper({
    steps,
    activeStep: String(activeButton.dataset.step || steps[0].id),
    ariaLabel: legacy.getAttribute("aria-label") || "Passaggi di creazione",
    canNavigate: (step) => navigable.has(String(step.id)),
    isComplete: (step) => complete.has(String(step.id)),
  });
  const projected = wrapper.firstElementChild;
  if (!(projected instanceof HTMLElement)) return;
  projected.dataset.artaroundStepperProjected = "true";
  projected.dataset.artaroundLegacyProjection = "authoring-progress";
  legacy.replaceWith(projected);
}

function scan(root = document) {
  for (const selector of HOSTS) {
    const hosts = [];
    if (root instanceof Element && root.matches(selector)) hosts.push(root);
    for (const host of root.querySelectorAll?.(selector) || []) hosts.push(host);
    for (const host of hosts) projectHost(host);
  }
}

let queued = false;
function queueScan() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    scan(document);
  });
}

scan(document);
const observer = new MutationObserver(queueScan);
observer.observe(document.body, { childList: true, subtree: true });
