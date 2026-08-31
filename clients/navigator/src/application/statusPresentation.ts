import type { FeedbackTone } from "./uiFeedback";

export type StatusFamily = "revision" | "integrity" | "session" | "listing";
export type StatusPresentation = { family: StatusFamily; state: string; label: string; tone: FeedbackTone };

const registry: Record<StatusFamily, Record<string, { label: string; tone: FeedbackTone }>> = {
  revision: {
    working: { label: "Bozza", tone: "neutral" },
    draft: { label: "Bozza", tone: "neutral" },
    in_review: { label: "In revisione", tone: "info" },
    changes_requested: { label: "Modifiche richieste", tone: "warning" },
    private: { label: "Privato", tone: "neutral" },
    published: { label: "Pubblicata", tone: "success" },
    superseded: { label: "Superata", tone: "neutral" },
    withdrawn: { label: "Ritirata", tone: "warning" },
    empty: { label: "Da completare", tone: "warning" },
  },
  integrity: {
    valid: { label: "Pronta", tone: "success" },
    ready: { label: "Pronta", tone: "success" },
    invalid: { label: "Da correggere", tone: "danger" },
    needs_review: { label: "Da controllare", tone: "warning" },
    unchecked: { label: "Da controllare", tone: "warning" },
  },
  session: {
    active: { label: "In corso", tone: "success" },
    paused: { label: "In pausa", tone: "warning" },
    completed: { label: "Completata", tone: "success" },
    abandoned: { label: "Terminata", tone: "neutral" },
    waiting: { label: "In attesa", tone: "info" },
  },
  listing: {
    draft: { label: "Bozza", tone: "neutral" },
    active: { label: "Attiva", tone: "success" },
    withdrawn: { label: "Ritirata", tone: "warning" },
    inactive: { label: "Non attiva", tone: "neutral" },
  },
};

export function statusPresentation(family: StatusFamily, state: string, fallback?: string): StatusPresentation {
  const stateKey = String(state || "");
  const entry = registry[family]?.[stateKey];
  return {
    family,
    state: stateKey,
    label: entry?.label || fallback || stateKey,
    tone: entry?.tone || "neutral",
  };
}
