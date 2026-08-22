const ACTION_DEFINITIONS = Object.freeze({
  PROGRESS_NEXT: Object.freeze({
    actionId: "progress.next",
    type: "PROGRESS_NEXT",
    family: "progress",
    label: "Prossimo",
    controlledVoiceAliases: ["prossimo", "avanti"],
  }),
  PROGRESS_PREVIOUS: Object.freeze({
    actionId: "progress.previous",
    type: "PROGRESS_PREVIOUS",
    family: "progress",
    label: "Precedente",
    controlledVoiceAliases: ["precedente", "indietro"],
  }),
  PRESENTATION_DEPTH_INCREASE: Object.freeze({
    actionId: "presentation.depth.increase",
    type: "PRESENTATION_DEPTH_INCREASE",
    family: "presentation",
    label: "Dimmi di più",
    controlledVoiceAliases: ["dimmi di più", "più approfondito"],
  }),
  PRESENTATION_DEPTH_DECREASE: Object.freeze({
    actionId: "presentation.depth.decrease",
    type: "PRESENTATION_DEPTH_DECREASE",
    family: "presentation",
    label: "Dimmi di meno",
    controlledVoiceAliases: ["dimmi di meno", "più breve"],
  }),
  PRESENTATION_COMPLEXITY_INCREASE: Object.freeze({
    actionId: "presentation.complexity.increase",
    type: "PRESENTATION_COMPLEXITY_INCREASE",
    family: "presentation",
    label: "Più specialistico",
    controlledVoiceAliases: ["troppo semplice", "più specialistico"],
  }),
  PRESENTATION_COMPLEXITY_DECREASE: Object.freeze({
    actionId: "presentation.complexity.decrease",
    type: "PRESENTATION_COMPLEXITY_DECREASE",
    family: "presentation",
    label: "Più semplice",
    controlledVoiceAliases: ["non ho capito", "più semplice"],
  }),
  SEMANTIC_RETURN: Object.freeze({
    actionId: "semantic.return",
    type: "SEMANTIC_RETURN",
    family: "semantic",
    label: "Torna al contenuto della visita",
    controlledVoiceAliases: ["torna alla visita", "torna al contenuto"],
  }),
  PAUSE: Object.freeze({
    actionId: "lifecycle.pause",
    type: "PAUSE",
    family: "lifecycle",
    label: "Pausa",
    controlledVoiceAliases: ["pausa", "ferma la visita"],
  }),
  RESUME: Object.freeze({
    actionId: "lifecycle.resume",
    type: "RESUME",
    family: "lifecycle",
    label: "Riprendi",
    controlledVoiceAliases: ["riprendi", "continua la visita"],
  }),
  COMPLETE: Object.freeze({
    actionId: "lifecycle.complete",
    type: "COMPLETE",
    family: "lifecycle",
    label: "Termina visita",
    controlledVoiceAliases: ["termina visita", "fine visita"],
  }),
});

const NAVIGATION_INTENT_LABELS = Object.freeze({
  FIND_EXIT: "Trova l'uscita",
  FIND_EMERGENCY_EXIT: "Trova un'uscita di emergenza",
  FIND_TOILET: "Trova una toilette",
  FIND_BAR: "Trova il bar",
  FIND_SHOP: "Trova il negozio",
  FIND_ELEVATOR: "Trova un ascensore",
  FIND_STAIRS: "Trova le scale",
  FIND_ENTRANCE: "Trova l'ingresso",
});

const NAVIGATION_VOICE_ALIASES = Object.freeze({
  FIND_EXIT: ["dov'è l'uscita", "trova l'uscita"],
  FIND_EMERGENCY_EXIT: ["dov'è l'uscita di emergenza", "uscita di emergenza"],
  FIND_TOILET: ["dov'è il bagno", "dov'è la toilette", "trova una toilette"],
  FIND_BAR: ["dov'è il bar", "trova il bar"],
  FIND_SHOP: ["dov'è il negozio", "trova il negozio"],
  FIND_ELEVATOR: ["dov'è l'ascensore", "trova un ascensore"],
  FIND_STAIRS: ["dove sono le scale", "trova le scale"],
  FIND_ENTRANCE: ["dov'è l'ingresso", "trova l'ingresso"],
});

function navigationActionDefinition(intent, fallbackLabel = null) {
  const normalized = String(intent || "").trim().toUpperCase();
  return {
    actionId: `navigation.place.${normalized.toLowerCase()}`,
    type: "NAVIGATE_TO_PLACE_INTENT",
    family: "navigation",
    label: NAVIGATION_INTENT_LABELS[normalized] || fallbackLabel || "Trova un servizio",
    controlledVoiceAliases: NAVIGATION_VOICE_ALIASES[normalized] || [],
  };
}

function publicAction(definition) {
  return {
    actionId: definition.actionId,
    type: definition.type,
    family: definition.family,
    label: definition.label,
    controlledVoiceAliases: [...(definition.controlledVoiceAliases || [])],
  };
}

module.exports = {
  ACTION_DEFINITIONS,
  navigationActionDefinition,
  publicAction,
};
