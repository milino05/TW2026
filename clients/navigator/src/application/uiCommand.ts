import { notify, type FeedbackTone } from "./uiFeedback";

export type UiCommandStatus = "success" | "failure" | "cancelled";

export type UiCommandResult<T> =
  | { status: "success"; result: T; key: string }
  | { status: "failure"; error: unknown; message: string; key: string }
  | { status: "cancelled"; key: string };

export type UiCommandFeedback<T = unknown> = string | {
  surface?: "toast";
  tone?: FeedbackTone;
  message: string;
} | ((context: UiCommandResult<T>) => string | { surface?: "toast"; tone?: FeedbackTone; message: string } | null);

export type UiCommandLifecycle = {
  setPending?: (pending: boolean) => void;
  clearError?: () => void;
  setError?: (message: string, error: unknown) => void;
};

const inFlight = new Map<string, Promise<UiCommandResult<unknown>>>();

export function uiCommandErrorMessage(error: unknown, fallback = "Operazione non riuscita") {
  return error instanceof Error && error.message ? error.message : String(error || fallback);
}

export function isUiCommandPending(key: string) {
  return inFlight.has(String(key || "default"));
}

function emitFeedback<T>(feedback: UiCommandFeedback<T> | null | undefined, context: UiCommandResult<T>) {
  const resolved = typeof feedback === "function" ? feedback(context) : feedback;
  if (!resolved || context.status === "cancelled") return;
  const descriptor = typeof resolved === "string" ? { surface: "toast" as const, tone: "success" as FeedbackTone, message: resolved } : resolved;
  if (descriptor.surface && descriptor.surface !== "toast") return;
  const emitter = notify[descriptor.tone || "success"] || notify;
  emitter(String(descriptor.message));
}

export function runUiCommand<T>({
  key = "default",
  execute,
  refresh,
  lifecycle = {},
  successFeedback = null,
  failureFeedback = null,
  onSuccess,
  onFailure,
  onSettled,
  errorFallback = "Operazione non riuscita",
  allowConcurrent = false,
}: {
  key?: string;
  execute: () => Promise<T> | T;
  refresh?: (result: T) => Promise<unknown> | unknown;
  lifecycle?: UiCommandLifecycle;
  successFeedback?: UiCommandFeedback<T> | null;
  failureFeedback?: UiCommandFeedback<T> | null;
  onSuccess?: (result: T, context: UiCommandResult<T>) => Promise<unknown> | unknown;
  onFailure?: (error: unknown, context: UiCommandResult<T>) => Promise<unknown> | unknown;
  onSettled?: () => Promise<unknown> | unknown;
  errorFallback?: string;
  allowConcurrent?: boolean;
}): Promise<UiCommandResult<T>> {
  if (typeof execute !== "function") throw new TypeError("runUiCommand requires execute().");
  const commandKey = String(key || "default");
  if (!allowConcurrent && inFlight.has(commandKey)) return inFlight.get(commandKey) as Promise<UiCommandResult<T>>;

  const task = (async (): Promise<UiCommandResult<T>> => {
    lifecycle.clearError?.();
    lifecycle.setPending?.(true);
    try {
      const result = await execute();
      if (refresh) await refresh(result);
      const context: UiCommandResult<T> = { status: "success", result, key: commandKey };
      emitFeedback(successFeedback, context);
      await onSuccess?.(result, context);
      return context;
    } catch (error) {
      const message = uiCommandErrorMessage(error, errorFallback);
      lifecycle.setError?.(message, error);
      const context: UiCommandResult<T> = { status: "failure", error, message, key: commandKey };
      emitFeedback(failureFeedback, context);
      await onFailure?.(error, context);
      return context;
    } finally {
      lifecycle.setPending?.(false);
      await onSettled?.();
    }
  })();

  if (!allowConcurrent) {
    inFlight.set(commandKey, task as Promise<UiCommandResult<unknown>>);
    task.finally(() => {
      if (inFlight.get(commandKey) === task) inFlight.delete(commandKey);
    });
  }
  return task;
}
