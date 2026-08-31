const REGISTRY = Object.freeze({
  revision: Object.freeze({
    working: { label: "Bozza", tone: "neutral" },
    draft: { label: "Bozza", tone: "neutral" },
    in_review: { label: "In revisione", tone: "info" },
    changes_requested: { label: "Modifiche richieste", tone: "warning" },
    private: { label: "Privato", tone: "neutral" },
    published: { label: "Pubblicata", tone: "success" },
    superseded: { label: "Superata", tone: "neutral" },
    withdrawn: { label: "Ritirata", tone: "warning" },
    empty: { label: "Da completare", tone: "warning" },
  }),
  integrity: Object.freeze({
    valid: { label: "Pronta", tone: "success" },
    ready: { label: "Pronta", tone: "success" },
    invalid: { label: "Da correggere", tone: "danger" },
    needs_review: { label: "Da controllare", tone: "warning" },
    unchecked: { label: "Da controllare", tone: "warning" },
  }),
  session: Object.freeze({
    active: { label: "In corso", tone: "success" },
    paused: { label: "In pausa", tone: "warning" },
    completed: { label: "Completata", tone: "success" },
    abandoned: { label: "Terminata", tone: "neutral" },
    waiting: { label: "In attesa", tone: "info" },
  }),
  listing: Object.freeze({
    draft: { label: "Bozza", tone: "neutral" },
    active: { label: "Attiva", tone: "success" },
    withdrawn: { label: "Ritirata", tone: "warning" },
    inactive: { label: "Non attiva", tone: "neutral" },
  }),
});

export const STATUS_FAMILIES = Object.freeze(Object.keys(REGISTRY));

export function statusPresentation(family, state, fallback = null) {
  const familyKey = String(family || "");
  const stateKey = String(state || "");
  const entry = REGISTRY[familyKey]?.[stateKey];
  if (entry) return { family: familyKey, state: stateKey, ...entry };
  return {
    family: familyKey,
    state: stateKey,
    label: String(fallback ?? stateKey),
    tone: "neutral",
  };
}
