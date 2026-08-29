const DEFINITION_FIELDS = ["durationTypes", "languageLevels", "subjectClasses", "relationTypes", "presentationAspects", "selectionSignals"];

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function starterDefinitions(source = {}) {
  const definitions = Object.fromEntries(DEFINITION_FIELDS.map((field) => [field, JSON.parse(JSON.stringify(source[field] || []))]));
  const legacyPresentationKeys = new Set(["contesto-storico-culturale", "tecnica-esecuzione"]);
  definitions.presentationAspects = definitions.presentationAspects.filter((entry) => !legacyPresentationKeys.has(entry.key));
  const add = (field, key, values) => {
    const existing = definitions[field].find((entry) => entry.key === key || String(entry.label || "").trim().toLocaleLowerCase("it") === String(values.label || "").trim().toLocaleLowerCase("it"));
    if (existing) return existing;
    const definition = { definitionId: uuid(), key, label: values.label, description: values.description, semanticRefs: [], ...values };
    definitions[field].push(definition);
    return definition;
  };
  const seconds = new Set(definitions.durationTypes.map((entry) => Number(entry.targetSeconds) || 0));
  const addDuration = (key, label, preferredSeconds, description) => {
    const existing = definitions.durationTypes.find((entry) => entry.key === key || String(entry.label || "").trim().toLocaleLowerCase("it") === label.toLocaleLowerCase("it"));
    if (existing) return existing;
    let targetSeconds = preferredSeconds;
    while (seconds.has(targetSeconds)) targetSeconds += 60;
    seconds.add(targetSeconds);
    return add("durationTypes", key, { label, description, targetSeconds });
  };
  addDuration("breve", "Breve", 60, "Per una lettura rapida davanti all'opera, con le informazioni essenziali.");
  addDuration("media", "Media", 180, "Per una spiegazione completa ma accessibile durante la visita.");
  addDuration("approfondita", "Approfondita", 360, "Per chi desidera soffermarsi e conoscere dettagli, confronti e contesto.");
  definitions.durationTypes.sort((left, right) => Number(left.targetSeconds) - Number(right.targetSeconds));
  add("languageLevels", "semplice", { label: "Semplice", description: "Frasi brevi, termini comuni e nessuna conoscenza pregressa richiesta." });
  add("languageLevels", "divulgativo", { label: "Divulgativo", description: "Linguaggio chiaro con i termini disciplinari necessari sempre spiegati." });
  add("languageLevels", "specialistico", { label: "Specialistico", description: "Lessico disciplinare e riferimenti adatti a un pubblico già competente." });
  const culturalWork = add("subjectClasses", "opera-bene-culturale", { label: "Opera o bene culturale", description: "Dipinti, sculture, manufatti e altri beni culturali raccontati nei contenuti." });
  const author = add("subjectClasses", "persona-autore", { label: "Persona o autore", description: "Persone, gruppi o botteghe che hanno ideato o realizzato un'opera." });
  const historicalContext = add("subjectClasses", "contesto-storico-culturale", { label: "Periodo, luogo o contesto culturale", description: "Periodi storici, luoghi, movimenti artistici e condizioni geopolitiche collegati a un'opera." });
  const materialOrTechnique = add("subjectClasses", "materiale-tecnica", { label: "Materiale o tecnica", description: "Materiali, supporti, strumenti e tecniche impiegati per realizzare un'opera." });

  const overview = add("selectionSignals", "panoramica", { label: "Panoramica", description: "Contenuto adatto a introdurre il soggetto o a rispondere a una richiesta generale." });
  const biography = add("selectionSignals", "biografia", { label: "Biografia", description: "Contenuto centrato sulla vita, il percorso e il profilo di una persona o autore." });
  add("selectionSignals", "curiosita", { label: "Curiosità", description: "Contenuto adatto a richieste di dettagli insoliti, curiosi o sorprendenti." });
  add("selectionSignals", "aneddoto", { label: "Aneddoto", description: "Contenuto centrato su episodi, racconti o aneddoti specifici relativi al soggetto." });

  add("relationTypes", "creata-da", {
    label: "Creata da",
    description: "Risponde alla domanda “Chi è l'autore?” e collega l'opera alla persona o al gruppo che l'ha realizzata.",
    domainDefinitionIds: [culturalWork.definitionId],
    rangeDefinitionIds: [author.definitionId],
    category: "semantic",
    strength: "strong",
    directionality: "directed",
    userIntents: ["chi è l'autore", "chi ha creato l'opera"],
    targetSelectionSignals: [
      { definitionId: overview.definitionId, weight: 1 },
      { definitionId: biography.definitionId, weight: 0.9 },
    ],
    reverse: {
      label: "Autore di",
      description: "Collega una persona alle opere che ha realizzato.",
      userIntents: ["quali opere ha realizzato"],
      targetSelectionSignals: [{ definitionId: overview.definitionId, weight: 1 }],
    },
    validationRules: { allowMultiple: true, targetRequired: true },
  });
  add("relationTypes", "contesto-storico-culturale", {
    label: "Contesto storico e culturale",
    description: "Risponde alla domanda “Quando e dove è stata realizzata?” e collega l'opera al periodo storico, al luogo, al movimento artistico e alle condizioni geopolitiche del momento.",
    domainDefinitionIds: [culturalWork.definitionId],
    rangeDefinitionIds: [historicalContext.definitionId],
    category: "contextual",
    strength: "strong",
    directionality: "directed",
    userIntents: ["quando è stata realizzata", "dove è stata realizzata", "qual è il contesto storico e culturale"],
    targetSelectionSignals: [{ definitionId: overview.definitionId, weight: 1 }],
    reverse: {
      label: "Contesto di",
      description: "Collega un periodo, un luogo o un contesto culturale alle opere pertinenti.",
      userIntents: ["quali opere appartengono a questo contesto"],
      targetSelectionSignals: [{ definitionId: overview.definitionId, weight: 1 }],
    },
    validationRules: { allowMultiple: true, targetRequired: true },
  });
  add("relationTypes", "tecnica-esecuzione", {
    label: "Tecnica e esecuzione",
    description: "Risponde alla domanda “Quali materiali e tecniche sono stati impiegati?” e collega l'opera ai materiali, agli strumenti e ai procedimenti usati per realizzarla.",
    domainDefinitionIds: [culturalWork.definitionId],
    rangeDefinitionIds: [materialOrTechnique.definitionId],
    category: "semantic",
    strength: "strong",
    directionality: "directed",
    userIntents: ["quali materiali sono stati impiegati", "quale tecnica è stata usata", "come è stata realizzata"],
    targetSelectionSignals: [{ definitionId: overview.definitionId, weight: 1 }],
    reverse: {
      label: "Impiegata in",
      description: "Collega un materiale o una tecnica alle opere in cui è stato impiegato.",
      userIntents: ["in quali opere è stata impiegata"],
      targetSelectionSignals: [{ definitionId: overview.definitionId, weight: 1 }],
    },
    validationRules: { allowMultiple: true, targetRequired: true },
  });
  return definitions;
}
