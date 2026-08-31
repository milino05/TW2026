import { mountUiLayer } from "../application/layer-manager.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function focusables(root) {
  return [...root.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), video[controls], audio[controls]')]
    .filter((element) => element instanceof HTMLElement && !element.hidden);
}

export function openMediaViewer({ src, type = "image", alt = "", title = "Anteprima media" } = {}) {
  if (!src) throw new TypeError("openMediaViewer requires src.");
  const overlay = document.createElement("div");
  overlay.className = "artaround-media-viewer";
  const media = type === "video"
    ? `<video src="${escapeHtml(src)}" controls></video>`
    : type === "audio"
      ? `<audio src="${escapeHtml(src)}" controls></audio>`
      : `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  overlay.innerHTML = `<div class="artaround-media-viewer__backdrop" data-media-viewer-close></div><section role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><button type="button" data-media-viewer-close aria-label="Chiudi anteprima">×</button>${media}</section>`;
  let restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let unmount = null;

  const onKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const items = focusables(overlay);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const close = () => {
    if (!unmount) return;
    const release = unmount;
    unmount = null;
    overlay.removeEventListener("keydown", onKeyDown);
    release();
    overlay.remove();
    restoreFocus?.focus?.({ preventScroll: true });
    restoreFocus = null;
  };
  overlay.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-media-viewer-close]")) close();
  });
  overlay.addEventListener("keydown", onKeyDown);
  unmount = mountUiLayer(overlay, { kind: "modal", lockScroll: true, onEscape: close });
  requestAnimationFrame(() => overlay.querySelector("button[data-media-viewer-close]")?.focus({ preventScroll: true }));
  return { close, element: overlay };
}
