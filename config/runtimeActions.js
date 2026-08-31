const ACTION_DEFINITIONS = Object.freeze({
  SYNCHRONIZED_START: Object.freeze({
    actionId: "synchronization.start",
    type: "SYNCHRONIZED_START",
    family: "synchronization",
    label: "Avvia la visita",
    controlledVoiceAliases: ["avvia la visita", "inizia la visita"],
  }),
  SYNCHRONIZED_START_QUIZ: Object.freeze({
    actionId: "synchronization.quiz.start",
    type: "SYNCHRONIZED_START_QUIZ",
    family: "synchronization",
    label: "Avvia il quiz",
    controlledVoiceAliases: ["avvia il quiz", "inizia il quiz"],
  }),
  SYNCHRONIZED_COMPLETE: Object.freeze({
    actionId: "synchronization.complete",
    type: "SYNCHRONIZED_COMPLETE",
    family: "synchronization",
    label: "Concludi la visita",
    controlledVoiceAliases: ["concludi la visita", "termina la visita di gruppo"],
  }),
  SYNCHRONIZED_CANCEL: Object.freeze({
    actionId: "synchronization.cancel",
    type: "SYNCHRONIZED_CANCEL",
    family: "synchronization",
    label: "Annulla la sessione",
    controlledVoiceAliases: [],
  }),
  SYNCHRONIZED_SUBMIT_QUIZ: Object.freeze({
    actionId: "synchronization.quiz.submit",
    type: "SYNCHRONIZED_SUBMIT_QUIZ",
    family: "quiz",
    label: "Invia le risposte",
    controlledVoiceAliases: [],
  }),
  SYNCHRONIZED_PLAYBACK_PLAY: Object.freeze({
    actionId: "synchronization.playback.play",
    type: "SYNCHRONIZED_PLAYBACK_PLAY",
    family: "playback",
    label: "Ascolta il contenuto",
    controlledVoiceAliases: ["ascolta il contenuto", "avvia la lettura", "leggi il contenuto"],
  }),
  SYNCHRONIZED_PLAYBACK_PAUSE: Object.freeze({
    actionId: "synchronization.playback.pause",
    type: "SYNCHRONIZED_PLAYBACK_PAUSE",
    family: "playback",
    label: "Metti in pausa",
    controlledVoiceAliases: ["metti in pausa", "pausa lettura"],
  }),
  SYNCHRONIZED_PLAYBACK_RESUME: Object.freeze({
    actionId: "synchronization.playback.resume",
    type: "SYNCHRONIZED_PLAYBACK_RESUME",
    family: "playback",
    label: "Riprendi lettura",
    controlledVoiceAliases: ["riprendi lettura", "continua a leggere"],
  }),
  SYNCHRONIZED_PLAYBACK_STOP: Object.freeze({
    actionId: "synchronization.playback.stop",
    type: "SYNCHRONIZED_PLAYBACK_STOP",
    family: "playback",
    label: "Ferma ascolto",
    controlledVoiceAliases: ["ferma ascolto", "ferma la lettura"],
  }),
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
  CHECK_ROUTE_OBSTACLES: Object.freeze({
    actionId: "navigation.obstacles.next_route",
    type: "CHECK_ROUTE_OBSTACLES",
    family: "navigation",
    label: "Ci sono ostacoli?",
    controlledVoiceAliases: ["ci sono ostacoli", "troverò ostacoli", "ci sono barriere"],
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

function physicalNavigationActionDefinition(definition) {
  const terms = [...new Set([
    definition?.label,
    ...(definition?.localizations || []).flatMap((localization) => [localization.label, ...(localization.aliases || [])]),
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  return {
    actionId: `navigation.place.${definition.definitionId}`,
    type: "NAVIGATE_TO_PHYSICAL_FEATURE",
    family: "navigation",
    label: `Trova ${definition.label}`,
    controlledVoiceAliases: terms.flatMap((term) => {
      const spokenTerm = term.toLocaleLowerCase("it-IT");
      return [`trova ${spokenTerm}`, `dov'è ${spokenTerm}`];
    }),
  };
}

function publicAction(definition) {
  return {
    actionId: definition.actionId,
    type: definition.type,
    family: definition.family,
    label: definition.label,
    controlledVoiceAliases: [...(definition.controlledVoiceAliases || [])],
    ...(definition.runtimeScope ? { runtimeScope: definition.runtimeScope } : {}),
    ...(definition.runtimeVersion ? { runtimeVersion: definition.runtimeVersion } : {}),
  };
}

module.exports = {
  ACTION_DEFINITIONS,
  physicalNavigationActionDefinition,
  publicAction,
};
