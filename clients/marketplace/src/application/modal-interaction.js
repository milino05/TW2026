import { mountUiLayer } from "./layer-manager.js";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex=\"-1\"])",
  "video[controls]",
  "audio[controls]",
].join(", ");
const modalOwnerState = new WeakMap();

function focusableElements(root) {
  if (!(root instanceof HTMLElement)) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => element instanceof HTMLElement
      && !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.getClientRects().length > 0);
}

function resolveInitialFocus(layer, initialFocus, panel) {
  if (initialFocus instanceof HTMLElement) return initialFocus;
  if (typeof initialFocus === "string") {
    const target = layer.querySelector(initialFocus);
    if (target instanceof HTMLElement && target.getClientRects().length > 0) return target;
  }
  return focusableElements(panel)[0] || (panel instanceof HTMLElement ? panel : null);
}

function customElementOwner(layer) {
  let current = layer.parentElement;
  while (current && current !== document.body) {
    if (current.tagName.includes("-")) return current;
    current = current.parentElement;
  }
  return null;
}

function restoreOwnerFocus(owner, state) {
  if (modalOwnerState.get(owner) !== state) return;
  modalOwnerState.delete(owner);
  if (owner.isConnected && state.returnFocus?.isConnected) state.returnFocus.focus?.({ preventScroll: true });
}

/**
 * Shared lifecycle for application-owned modal surfaces.
 *
 * This module deliberately owns only interaction mechanics: global layering,
 * Escape routing, backdrop/explicit dismiss requests, focus trap, scroll lock
 * and focus restoration. Dirty-state policy, validation and domain operations
 * remain with the consumer through onRequestDismiss/canDismiss.
 *
 * `panel` can be an HTMLElement or a resolver returning the current panel. The
 * resolver form supports vanilla custom elements that rerender their modal DOM.
 * For portalled layers owned by a custom element, the original launcher focus
 * is retained across those rerenders. A release without restoration is treated
 * as an in-place rerender only when another modal for the same owner mounts in
 * the same turn; otherwise the flow has ended and focus is restored.
 */
export function mountModalInteraction({
  layer,
  panel,
  kind = "modal",
  initialFocus = null,
  dismissSelector = "[data-modal-dismiss]",
  backdropSelector = "[data-modal-backdrop]",
  canDismiss = () => true,
  onRequestDismiss = () => {},
  lockScroll = true,
} = {}) {
  if (!(layer instanceof HTMLElement)) throw new TypeError("mountModalInteraction requires a layer HTMLElement.");
  const resolvePanel = () => typeof panel === "function" ? panel() : panel;
  const initialPanel = resolvePanel();
  if (!(initialPanel instanceof HTMLElement) || !layer.contains(initialPanel)) {
    throw new TypeError("mountModalInteraction requires a panel contained by the layer.");
  }

  const owner = customElementOwner(layer);
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let ownerState = owner ? modalOwnerState.get(owner) : null;
  if (owner && !ownerState) {
    ownerState = { returnFocus: activeElement && !layer.contains(activeElement) ? activeElement : null, active: 0 };
    modalOwnerState.set(owner, ownerState);
  }
  if (ownerState) ownerState.active += 1;
  const returnFocus = ownerState?.returnFocus || activeElement;
  let released = false;
  let dismissPending = false;

  const dismissAllowed = () => typeof canDismiss === "function" ? canDismiss() !== false : canDismiss !== false;

  const requestDismiss = async (reason = "dismiss") => {
    if (released || dismissPending || !dismissAllowed()) return false;
    dismissPending = true;
    try {
      const outcome = await onRequestDismiss(reason);
      return outcome !== false;
    } finally {
      dismissPending = false;
    }
  };

  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (dismissSelector && target.closest(dismissSelector)) {
      void requestDismiss("dismiss");
      return;
    }
    if (backdropSelector && target.matches(backdropSelector)) void requestDismiss("backdrop");
  };

  const onKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const currentPanel = resolvePanel();
    const items = focusableElements(currentPanel);
    if (!items.length) {
      event.preventDefault();
      currentPanel?.focus?.({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  layer.addEventListener("click", onClick);
  layer.addEventListener("keydown", onKeyDown);
  const unmountLayer = mountUiLayer(layer, {
    kind,
    lockScroll,
    onEscape: () => void requestDismiss("escape"),
  });

  requestAnimationFrame(() => resolveInitialFocus(layer, initialFocus, resolvePanel())?.focus?.({ preventScroll: true }));

  return {
    requestDismiss,
    release({ restoreFocus = true } = {}) {
      if (released) return;
      released = true;
      layer.removeEventListener("click", onClick);
      layer.removeEventListener("keydown", onKeyDown);
      unmountLayer();
      if (owner && ownerState) {
        ownerState.active = Math.max(0, ownerState.active - 1);
        if (restoreFocus) {
          restoreOwnerFocus(owner, ownerState);
        } else {
          queueMicrotask(() => {
            if (ownerState.active === 0) restoreOwnerFocus(owner, ownerState);
          });
        }
        return;
      }
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    },
  };
}