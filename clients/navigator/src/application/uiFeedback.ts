export const UI_NOTIFICATION_EVENT = "artaround:notification";
export const UI_NOTIFICATION_DISMISS_EVENT = "artaround:notification:dismiss";
export const DEFAULT_NOTIFICATION_DURATION = 3000;

export type FeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";

export type NotificationOptions = {
  id?: string;
  message: string;
  tone?: FeedbackTone;
  duration?: number;
  dismissible?: boolean;
};

export type NotificationDetail = Required<Pick<NotificationOptions, "id" | "message" | "tone" | "duration" | "dismissible">>;

const tones = new Set<FeedbackTone>(["neutral", "info", "success", "warning", "danger"]);

function notificationId() {
  return globalThis.crypto?.randomUUID?.() || `notification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalized(options: NotificationOptions): NotificationDetail {
  const duration = Number(options.duration ?? DEFAULT_NOTIFICATION_DURATION);
  return {
    id: String(options.id || notificationId()),
    message: String(options.message || "").trim(),
    tone: tones.has(options.tone || "neutral") ? (options.tone || "neutral") : "neutral",
    duration: Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_NOTIFICATION_DURATION,
    dismissible: options.dismissible !== false,
  };
}

function emit(options: NotificationOptions) {
  const detail = normalized(options);
  if (detail.message) window.dispatchEvent(new CustomEvent<NotificationDetail>(UI_NOTIFICATION_EVENT, { detail }));
  return detail.id;
}

export const notify = Object.assign(
  (message: string, options: Omit<NotificationOptions, "message"> = {}) => emit({ ...options, message }),
  {
    neutral: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "neutral" }),
    info: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "info" }),
    success: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "success" }),
    warning: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "warning" }),
    danger: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "danger" }),
    error: (message: string, options: Omit<NotificationOptions, "message" | "tone"> = {}) => emit({ ...options, message, tone: "danger" }),
  },
);

export function dismissNotification(id: string) {
  if (!id) return;
  window.dispatchEvent(new CustomEvent(UI_NOTIFICATION_DISMISS_EVENT, { detail: { id } }));
}
