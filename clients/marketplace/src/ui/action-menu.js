import { mountUiLayer } from "../application/layer-manager.js";

function focusableItems(panel) {
  return [...panel.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"]), button:not(:disabled), a[href]')];
}

export class ArtAroundActionMenu extends HTMLElement {
  panel = null;
  placeholder = null;
  unmountLayer = null;

  connectedCallback() {
    this.addEventListener("click", this.onHostClick);
    this.addEventListener("keydown", this.onHostKeyDown);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    this.syncExpanded(false);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onHostClick);
    this.removeEventListener("keydown", this.onHostKeyDown);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    this.close({ restoreFocus: false });
  }

  get trigger() { return this.querySelector("[data-action-menu-trigger]"); }
  get localPanel() { return this.querySelector("[data-action-menu-panel]"); }

  syncExpanded(open) {
    this.trigger?.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && this.localPanel) this.localPanel.hidden = true;
  }

  open({ focus = true } = {}) {
    if (this.unmountLayer) return;
    const trigger = this.trigger;
    const panel = this.localPanel;
    if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
    this.panel = panel;
    this.placeholder = document.createComment("artaround-action-menu-panel");
    panel.parentNode?.insertBefore(this.placeholder, panel);
    panel.hidden = false;
    panel.setAttribute("role", panel.getAttribute("role") || "menu");
    panel.style.position = "fixed";
    panel.style.visibility = "hidden";
    panel.addEventListener("click", this.onPanelClick);
    panel.addEventListener("keydown", this.onPanelKeyDown);
    this.unmountLayer = mountUiLayer(panel, { kind: "popover", onEscape: () => this.close() });
    const rect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${Math.min(maxLeft, Math.max(8, rect.right - panel.offsetWidth))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(8, rect.bottom + 6))}px`;
    panel.style.visibility = "visible";
    trigger.setAttribute("aria-expanded", "true");
    if (focus) requestAnimationFrame(() => focusableItems(panel)[0]?.focus());
  }

  close({ restoreFocus = true } = {}) {
    if (!this.unmountLayer) { this.syncExpanded(false); return; }
    const trigger = this.trigger;
    const panel = this.panel;
    const placeholder = this.placeholder;
    const unmount = this.unmountLayer;
    this.unmountLayer = null;
    panel?.removeEventListener("click", this.onPanelClick);
    panel?.removeEventListener("keydown", this.onPanelKeyDown);
    unmount();
    if (panel && placeholder?.parentNode) placeholder.parentNode.insertBefore(panel, placeholder);
    placeholder?.remove();
    if (panel) {
      panel.hidden = true;
      panel.style.position = "";
      panel.style.left = "";
      panel.style.top = "";
      panel.style.visibility = "";
    }
    this.panel = null;
    this.placeholder = null;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus?.({ preventScroll: true });
  }

  movePanelFocus(event) {
    const panel = this.panel;
    if (!panel || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    const items = focusableItems(panel);
    if (!items.length) return false;
    const index = Math.max(0, items.indexOf(document.activeElement));
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
    return true;
  }

  onHostClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-action-menu-trigger]")) return;
    if (this.unmountLayer) this.close(); else this.open();
  };

  onHostKeyDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-action-menu-trigger]")) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!this.unmountLayer) this.open({ focus: false });
      const items = this.panel ? focusableItems(this.panel) : [];
      (event.key === "ArrowUp" ? items.at(-1) : items[0])?.focus();
    }
  };

  onPanelClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[role="menuitem"], button, a[href]')) this.close({ restoreFocus: false });
  };

  onPanelKeyDown = (event) => { this.movePanelFocus(event); };

  onPointerDown = (event) => {
    if (!this.unmountLayer) return;
    const target = event.target;
    if (target instanceof Node && (this.contains(target) || this.panel?.contains(target))) return;
    this.close();
  };
}

if (!customElements.get("artaround-action-menu")) customElements.define("artaround-action-menu", ArtAroundActionMenu);
