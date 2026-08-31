import { runUiCommand, UI_COMMAND_STATUS } from "./ui-command-runner.js";
import { openActionDialog } from "../ui/feedback-primitives.js";

/**
 * Standard destructive interaction. Domain-specific impact text and repository work
 * remain caller-owned. Complex confirmations can override confirm() while still using
 * the same command lifecycle.
 */
export async function runDestructiveAction({
  key,
  title = "Confermare l'operazione?",
  message = "Questa operazione può modificare o rimuovere dati.",
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  confirm = null,
  execute,
  refresh = null,
  lifecycle = {},
  successFeedback = null,
  failureFeedback = null,
  onSuccess = null,
  onFailure = null,
  errorFallback = "Operazione non riuscita",
} = {}) {
  if (typeof execute !== "function") throw new TypeError("runDestructiveAction requires execute().");
  const accepted = typeof confirm === "function"
    ? await confirm()
    : await openActionDialog({ title, message, confirmLabel, cancelLabel, tone: "danger" });
  if (!accepted) return { status: UI_COMMAND_STATUS.CANCELLED, key: String(key || "destructive-action") };

  return runUiCommand({
    key: key || "destructive-action",
    execute,
    refresh,
    lifecycle,
    successFeedback,
    failureFeedback,
    onSuccess,
    onFailure,
    errorFallback,
  });
}
