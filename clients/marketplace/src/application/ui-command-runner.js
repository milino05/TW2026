import { notify } from "./ui-feedback.js";

export const UI_COMMAND_STATUS = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
  CANCELLED: "cancelled",
});

const inFlight = new Map();

export function uiCommandErrorMessage(error, fallback = "Operazione non riuscita") {
  return error instanceof Error && error.message ? error.message : String(error || fallback);
}

export function isUiCommandPending(key) {
  return inFlight.has(String(key || "default"));
}

function feedbackDescriptor(value, context) {
  const resolved = typeof value === "function" ? value(context) : value;
  if (!resolved) return null;
  if (typeof resolved === "string") return { surface: "toast", tone: "success", message: resolved };
  return { surface: "toast", tone: "success", ...resolved };
}

function emitFeedback(value, context) {
  const descriptor = feedbackDescriptor(value, context);
  if (!descriptor?.message || descriptor.surface !== "toast") return;
  const emitter = notify[descriptor.tone] || notify;
  emitter(String(descriptor.message), descriptor.options || {});
}

/**
 * Runs one application command without owning domain policy.
 *
 * The caller supplies the backend-authoritative operation and repository callback.
 * This coordinator only standardizes UI lifecycle: duplicate-submit protection,
 * pending/error hooks, projection refresh and explicitly requested transient feedback.
 */
export function runUiCommand({
  key = "default",
  execute,
  refresh = null,
  lifecycle = {},
  successFeedback = null,
  failureFeedback = null,
  onSuccess = null,
  onFailure = null,
  onSettled = null,
  errorFallback = "Operazione non riuscita",
  allowConcurrent = false,
} = {}) {
  if (typeof execute !== "function") throw new TypeError("runUiCommand requires execute().");
  const commandKey = String(key || "default");
  if (!allowConcurrent && inFlight.has(commandKey)) return inFlight.get(commandKey);

  const task = (async () => {
    lifecycle.clearError?.();
    lifecycle.setPending?.(true);
    try {
      const result = await execute();
      if (typeof refresh === "function") await refresh(result);
      const context = { status: UI_COMMAND_STATUS.SUCCESS, result, key: commandKey };
      emitFeedback(successFeedback, context);
      if (typeof onSuccess === "function") await onSuccess(result, context);
      return context;
    } catch (error) {
      const message = uiCommandErrorMessage(error, errorFallback);
      lifecycle.setError?.(message, error);
      const context = { status: UI_COMMAND_STATUS.FAILURE, error, message, key: commandKey };
      emitFeedback(failureFeedback, context);
      if (typeof onFailure === "function") await onFailure(error, context);
      return context;
    } finally {
      lifecycle.setPending?.(false);
      if (typeof onSettled === "function") await onSettled();
    }
  })();

  if (!allowConcurrent) {
    inFlight.set(commandKey, task);
    task.finally(() => {
      if (inFlight.get(commandKey) === task) inFlight.delete(commandKey);
    });
  }
  return task;
}
