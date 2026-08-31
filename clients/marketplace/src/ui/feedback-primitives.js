import {
  UI_NOTIFICATION_DISMISS_EVENT,
  UI_NOTIFICATION_EVENT,
} from "../application/ui-feedback.js";
import { icon } from "./icons.js";

const TONE_ICONS = {
  neutral: "info",
  info: "info",
  success: "check",
  warning: "warning",
  danger: "warning",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tone(value) {
  return ["neutral", "info", "success", "warning", "danger"].includes(value) ? value : "neutral";
}

class ArtAroundToneSurface extends HTMLElement {
  static observedAttributes = ["tone"];

  connectedCallback() { this.syncTone(); }
  attributeChangedCallback() { this.syncTone(); }

  syncTone() {
    this.dataset.tone = tone(this.getAttribute("tone"));
  }
}

export class ArtAroundCallout extends ArtAroundToneSurface {
  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "note");
  }
}

export class ArtAroundIssuePanel extends ArtAroundToneSurface {
  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "region");
    if (!this.hasAttribute("aria-label")) this.setAttribute("aria-label", "Problemi da risolvere");
  }
}

export class ArtAroundFieldFeedback extends ArtAroundToneSurface {
  connectedCallback() {
    if (!this.hasAttribute("tone")) this.setAttribute("tone", "danger");
    super.connectedCallback();
    if (!this.hasAttribute("aria-live")) this.setAttribute("aria-live", "polite");
  }
}

export class ArtAroundStatusIndicator extends ArtAroundToneSurface {}

export class ArtAroundEmptyState extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "region");
  }
}

export class ArtAroundProgressState extends ArtAroundToneSurface {
  connectedCallback() {
    if (!this.hasAttribute("tone")) this.setAttribute("tone", "info");
    super.connectedCallback();
    if (!this.hasAttribute("role")) this.setAttribute("role", "status");
    if (!this.hasAttribute("aria-live")) this.setAttribute("aria-live", "polite");
  }
}

export class ArtAroundToastCenter extends HTMLElement {
  notifications = [];
  timers = new Map();

  connectedCallback() {
    this.setAttribute("aria-label", "Notifiche");
    window.addEventListener(UI_NOTIFICATION_EVENT, this.onNotification);
    window.addEventListener(UI_NOTIFICATION_DISMISS_EVENT, this.onExternalDismiss);
    this.addEventListener("click", this.onClick);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener(UI_NOTIFICATION_EVENT, this.onNotification);
    window.removeEventListener(UI_NOTIFICATION_DISMISS_EVENT, this.onExternalDismiss);
    this.removeEventListener("click", this.onClick);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  onNotification = (event) => {
    const incoming = event.detail;
    if (!incoming?.id || !incoming.message) return;
    const existing = this.notifications.findIndex((entry) => entry.id === incoming.id);
    if (existing >= 0) this.notifications.splice(existing, 1);
    this.notifications.push({ ...incoming, state: "visible" });
    this.render();

    if (incoming.duration > 0) {
      const previousTimer = this.timers.get(incoming.id);
      if (previousTimer) clearTimeout(previousTimer);
      this.timers.set(incoming.id, setTimeout(() => this.dismiss(incoming.id), incoming.duration));
    }
  };

  onExternalDismiss = (event) => this.dismiss(event.detail?.id);

  onClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-toast-dismiss]") : null;
    if (button) this.dismiss(button.dataset.toastDismiss);
  };

  dismiss(id) {
    const notification = this.notifications.find((entry) => entry.id === id);
    if (!notification || notification.state === "exiting") return;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    notification.state = "exiting";
    this.render();
    setTimeout(() => {
      this.notifications = this.notifications.filter((entry) => entry.id !== id);
      this.render();
    }, 180);
  }

  render() {
    this.innerHTML = `<div class="artaround-toast-stack">${this.notifications.map((entry) => {
      const currentTone = tone(entry.tone);
      const assertive = currentTone === "danger";
      return `<section class="artaround-toast" data-tone="${currentTone}" data-state="${entry.state}" role="${assertive ? "alert" : "status"}" aria-live="${assertive ? "assertive" : "polite"}">
        <span class="artaround-toast__icon" aria-hidden="true">${icon(TONE_ICONS[currentTone], { size: 18 })}</span>
        <p>${escapeHtml(entry.message)}</p>
        ${entry.dismissible ? `<button type="button" data-toast-dismiss="${escapeHtml(entry.id)}" aria-label="Chiudi notifica">×</button>` : ""}
      </section>`;
    }).join("")}</div>`;
  }
}

export class ArtAroundActionDialog extends ArtAroundToneSurface {
  config = null;
  returnFocus = null;

  connectedCallback() {
    if (!this.hasAttribute("tone")) this.setAttribute("tone", "neutral");
    super.connectedCallback();
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onKeyDown);
    document.documentElement.classList.remove("artaround-dialog-open");
    document.body?.classList.remove("artaround-dialog-open");
  }

  present(options = {}) {
    this.config = {
      title: String(options.title || "Conferma azione"),
      message: String(options.message || ""),
      confirmLabel: String(options.confirmLabel || "Conferma"),
      cancelLabel: String(options.cancelLabel || "Annulla"),
      tone: tone(options.tone || "neutral"),
      dismissible: options.dismissible !== false,
    };
    this.setAttribute("tone", this.config.tone);
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.hidden = false;
    document.documentElement.classList.add("artaround-dialog-open");
    document.body?.classList.add("artaround-dialog-open");
    this.render();
    requestAnimationFrame(() => this.querySelector("[data-dialog-cancel]")?.focus({ preventScroll: true }));
  }

  finish(confirmed) {
    const detail = { confirmed: Boolean(confirmed) };
    this.dispatchEvent(new CustomEvent("artaround:action-dialog-result", { detail, bubbles: true }));
    this.hidden = true;
    document.documentElement.classList.remove("artaround-dialog-open");
    document.body?.classList.remove("artaround-dialog-open");
    this.returnFocus?.focus?.({ preventScroll: true });
    if (this.dataset.ephemeral === "true") this.remove();
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-dialog-confirm]")) this.finish(true);
    else if (target?.closest("[data-dialog-cancel]")) this.finish(false);
    else if (target?.matches(".artaround-action-dialog__backdrop") && this.config?.dismissible) this.finish(false);
  };

  onKeyDown = (event) => {
    if (event.key === "Escape" && this.config?.dismissible) {
      event.preventDefault();
      this.finish(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  render() {
    if (!this.config) return;
    const dangerous = this.config.tone === "danger";
    this.innerHTML = `<div class="artaround-action-dialog__backdrop" aria-hidden="true"></div>
      <section class="artaround-action-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="artaround-action-dialog-title">
        <div class="artaround-action-dialog__heading">
          <span aria-hidden="true">${icon(TONE_ICONS[this.config.tone], { size: 20 })}</span>
          <div><h2 id="artaround-action-dialog-title">${escapeHtml(this.config.title)}</h2>${this.config.message ? `<p>${escapeHtml(this.config.message)}</p>` : ""}</div>
        </div>
        <div class="artaround-action-dialog__actions">
          <button class="button-secondary" type="button" data-dialog-cancel>${escapeHtml(this.config.cancelLabel)}</button>
          <button class="${dangerous ? "danger" : ""}" type="button" data-dialog-confirm>${escapeHtml(this.config.confirmLabel)}</button>
        </div>
      </section>`;
  }
}

export function openActionDialog(options = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("artaround-action-dialog");
    dialog.dataset.ephemeral = "true";
    dialog.hidden = true;
    dialog.addEventListener("artaround:action-dialog-result", (event) => resolve(Boolean(event.detail?.confirmed)), { once: true });
    document.body.append(dialog);
    dialog.present(options);
  });
}

const definitions = [
  ["artaround-toast-center", ArtAroundToastCenter],
  ["artaround-callout", ArtAroundCallout],
  ["artaround-issue-panel", ArtAroundIssuePanel],
  ["artaround-field-feedback", ArtAroundFieldFeedback],
  ["artaround-action-dialog", ArtAroundActionDialog],
  ["artaround-status-indicator", ArtAroundStatusIndicator],
  ["artaround-empty-state", ArtAroundEmptyState],
  ["artaround-progress-state", ArtAroundProgressState],
];
for (const [name, constructor] of definitions) {
  if (!customElements.get(name)) customElements.define(name, constructor);
}

export function ensureFeedbackHost() {
  if (!document.body || document.querySelector("artaround-toast-center")) return;
  document.body.append(document.createElement("artaround-toast-center"));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureFeedbackHost, { once: true });
else ensureFeedbackHost();
