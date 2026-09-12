export const UI_LAYER_ORDER = Object.freeze(["floating", "popover", "drawer", "modal", "dialog", "toast"]);

const mountedLayers = [];
let escapeInstalled = false;

function syncScrollLock() {
  const locked = mountedLayers.some((entry) => entry.lockScroll);
  document.documentElement.classList.toggle("artaround-layer-scroll-lock", locked);
  document.body?.classList.toggle("artaround-layer-scroll-lock", locked);
}

function topEscapableLayer() {
  return [...mountedLayers].reverse().find((entry) => typeof entry.onEscape === "function") || null;
}

function onDocumentKeyDown(event) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const entry = topEscapableLayer();
  if (!entry) return;
  event.preventDefault();
  entry.onEscape();
}

function ensureEscapeHandler() {
  if (escapeInstalled) return;
  document.addEventListener("keydown", onDocumentKeyDown);
  escapeInstalled = true;
}

export function topUiLayer() { return mountedLayers.at(-1) || null; }

/** Mounts an application-owned floating surface directly under document.body. */
export function mountUiLayer(element, { kind = "floating", onEscape = null, lockScroll = false } = {}) {
  if (!(element instanceof HTMLElement)) throw new TypeError("mountUiLayer requires an HTMLElement.");
  if (!UI_LAYER_ORDER.includes(kind)) throw new TypeError(`Unknown ArtAround layer kind: ${kind}`);
  ensureEscapeHandler();
  const returnParent = element.parentNode;
  const returnNextSibling = element.nextSibling;
  element.dataset.artaroundLayer = kind;
  if (element.parentNode !== document.body) document.body.append(element);
  const entry = { element, kind, onEscape, lockScroll };
  mountedLayers.push(entry);
  syncScrollLock();
  let released = false;

  const finalize = ({ returnToOwner = true } = {}) => {
    if (released) return;
    released = true;
    const index = mountedLayers.indexOf(entry);
    if (index >= 0) mountedLayers.splice(index, 1);
    delete element.dataset.artaroundLayer;
    if (returnToOwner && returnParent?.isConnected && element.parentNode !== returnParent) {
      returnParent.insertBefore(element, returnNextSibling?.isConnected ? returnNextSibling : null);
    } else if (!returnToOwner || !returnParent?.isConnected) {
      element.remove();
    }
    syncScrollLock();
  };

  return ({ visualHandoff = false } = {}) => {
    if (released) return;
    if (visualHandoff) {
      // Custom-element modal owners often rerender synchronously by replacing
      // their staging DOM and immediately mounting a new body-level layer.
      // Keeping the outgoing layer mounted until the microtask checkpoint
      // prevents a compositor-visible backdrop/blur and scroll-lock gap.
      queueMicrotask(() => finalize({ returnToOwner: false }));
      return;
    }
    finalize({ returnToOwner: true });
  };
}