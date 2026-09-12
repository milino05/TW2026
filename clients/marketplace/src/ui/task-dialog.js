import { mountModalInteraction } from "../application/modal-interaction.js";
import { openActionDialog } from "./feedback-primitives.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sizeClass(size) {
  if (size === "compact") return " artaround-task-modal--compact";
  if (size === "large") return " artaround-task-modal--large";
  return "";
}

/**
 * Programmatic shell for bounded Marketplace create/edit/select tasks.
 *
 * Domain state and repository calls remain outside this controller. The shell
 * owns only interaction mechanics and visual structure: body-level mounting,
 * focus, Escape/backdrop/cancel dismissal, optional dirty confirmation and the
 * single-scroll modal layout.
 */
export function createTaskDialog({
  eyebrow = "",
  title = "",
  description = "",
  size = "default",
  ariaLabel = null,
  initialFocus = null,
  renderBody = () => "",
  renderFooter = () => "",
  isBusy = () => false,
  isDirty = () => false,
  onDiscard = null,
  onDismiss = null,
  onClick = null,
  onSubmit = null,
  onInput = null,
  onChange = null,
} = {}) {
  const layer = document.createElement("div");
  layer.className = "artaround-modal-layer";
  layer.dataset.modalBackdrop = "true";
  layer.setAttribute("role", "presentation");

  let interaction = null;
  let released = false;
  const titleId = `task-dialog-${Math.random().toString(36).slice(2)}-title`;

  function render() {
    if (released) return;
    const labelledBy = ariaLabel ? "" : ` aria-labelledby="${titleId}"`;
    const label = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : "";
    layer.innerHTML = `<section class="artaround-task-modal${sizeClass(size)}" role="dialog" aria-modal="true"${label}${labelledBy} aria-busy="${Boolean(isBusy())}">
      <header class="artaround-task-modal__header">
        <div>${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ""}<h2 id="${titleId}">${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>
        <button type="button" class="button-secondary small artaround-task-modal__close" data-modal-dismiss aria-label="Chiudi">×</button>
      </header>
      <div class="artaround-task-modal__body">${renderBody()}</div>
      <footer class="artaround-task-modal__footer">${renderFooter()}</footer>
    </section>`;
  }

  async function requestClose(reason = "dismiss") {
    if (released || isBusy()) return false;
    if (isDirty()) {
      const discard = await openActionDialog({
        title: "Scartare le modifiche?",
        message: "Le modifiche non salvate andranno perse.",
        confirmLabel: "Scarta modifiche",
        cancelLabel: "Continua a modificare",
        tone: "danger",
      });
      if (!discard) return false;
      onDiscard?.();
    }
    release({ reason });
    return true;
  }

  function focus(selector) {
    requestAnimationFrame(() => {
      const target = typeof selector === "string" ? layer.querySelector(selector) : selector;
      target?.focus?.({ preventScroll: true });
    });
  }

  function release({ reason = "programmatic", restoreFocus = true, notify = true } = {}) {
    if (released) return;
    released = true;
    layer.removeEventListener("click", handleClick);
    layer.removeEventListener("submit", handleSubmit);
    layer.removeEventListener("input", handleInput);
    layer.removeEventListener("change", handleChange);
    interaction?.release({ restoreFocus });
    interaction = null;
    layer.remove();
    if (notify) onDismiss?.(reason);
  }

  const handleClick = (event) => onClick?.(event, controller);
  const handleSubmit = (event) => onSubmit?.(event, controller);
  const handleInput = (event) => onInput?.(event, controller);
  const handleChange = (event) => onChange?.(event, controller);

  const controller = {
    layer,
    render,
    focus,
    requestClose,
    close(options = {}) { release({ ...options, notify: options.notify !== false }); },
    get panel() { return layer.querySelector(".artaround-task-modal"); },
  };

  render();
  layer.addEventListener("click", handleClick);
  layer.addEventListener("submit", handleSubmit);
  layer.addEventListener("input", handleInput);
  layer.addEventListener("change", handleChange);
  interaction = mountModalInteraction({
    layer,
    panel: () => controller.panel,
    kind: "modal",
    initialFocus,
    canDismiss: () => !isBusy(),
    onRequestDismiss: requestClose,
    lockScroll: true,
  });

  return controller;
}
