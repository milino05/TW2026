export const UI_NOTIFICATION_EVENT = "artaround:notification";
export const UI_NOTIFICATION_DISMISS_EVENT = "artaround:notification:dismiss";

export const UI_FEEDBACK_TONES = Object.freeze(["neutral", "info", "success", "warning", "danger"]);
export const DEFAULT_NOTIFICATION_DURATION = 3000;

function notificationId() {
  return globalThis.crypto?.randomUUID?.() || `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizedTone(value) {
  return UI_FEEDBACK_TONES.includes(value) ? value : "neutral";
}

function normalizedNotification(messageOrOptions, options = {}) {
  const source = typeof messageOrOptions === "string"
    ? { ...options, message: messageOrOptions }
    : { ...(messageOrOptions || {}) };
  const duration = Number(source.duration ?? DEFAULT_NOTIFICATION_DURATION);
  return {
    id: String(source.id || notificationId()),
    message: String(source.message || "").trim(),
    tone: normalizedTone(source.tone),
    duration: Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_NOTIFICATION_DURATION,
    dismissible: source.dismissible !== false,
  };
}

export function notify(messageOrOptions, options = {}) {
  const detail = normalizedNotification(messageOrOptions, options);
  if (!detail.message || typeof window === "undefined") return detail.id;
  window.dispatchEvent(new CustomEvent(UI_NOTIFICATION_EVENT, { detail }));
  return detail.id;
}

notify.neutral = (message, options = {}) => notify({ ...options, message, tone: "neutral" });
notify.info = (message, options = {}) => notify({ ...options, message, tone: "info" });
notify.success = (message, options = {}) => notify({ ...options, message, tone: "success" });
notify.warning = (message, options = {}) => notify({ ...options, message, tone: "warning" });
notify.danger = (message, options = {}) => notify({ ...options, message, tone: "danger" });
notify.error = notify.danger;

export function dismissNotification(id) {
  if (!id || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UI_NOTIFICATION_DISMISS_EVENT, { detail: { id: String(id) } }));
}
