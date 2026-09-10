const crypto = require("crypto");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const EditorialRelease = require("../models/editorialRelease.model");
const { validatePresentationAgainstNamespace } = require("../services/itemV2Presentation.service");
const { resolveInitialPresentation, findAdjacentPresentation } = require("../services/presentationRuntimeV2.service");
const { IDS, DEF, PERIODS, WORKS } = require("./examDatasetV2");

const DURATION_AXIS = Object.freeze([
  { key: "short", definitionId: DEF.durationShort },
  { key: "medium", definitionId: DEF.durationMedium },
  { key: "long", definitionId: DEF.durationLong },
]);

const LANGUAGE_AXIS = Object.freeze([
  { key: "simple", definitionId: DEF.languageSimple },
  { key: "standard", definitionId: DEF.languageStandard },
  { key: "advanced", definitionId: DEF.languageAdvanced },
]);

function demoId(name) {
  return new (require("mongoose").Types.ObjectId)(
    crypto.createHash("sha1").update(`artaround-exam:${name}`).digest("hex").slice(0, 24),
  );
}

function periodLabel(work) {
  return work.period === "rinascimento" ? "Rinascimento" : "Seicento";
}

function semanticContextSentences(content, languageKey, variantKey) {
  const title = content.title || content.label;
  const description = content.description || "Contesto storico-artistico della Raccolta.";
  if (languageKey === "simple") {
    const base = [
      `${title} è un contesto storico-artistico usato dalla Raccolta.`,
      description,
    ];
    if (variantKey === "context") {
      return [
        ...base,
        "Serve a collegare opere che condividono riferimenti storici e culturali.",
        "Puoi usarlo per confrontare le tappe senza confondere il tema con un luogo fisico del museo.",
        "Le relazioni del grafo aiutano a passare dalle opere al contesto e poi tornare alle opere collegate.",
        "Osserva quali caratteristiche ricorrono e quali cambiano da una tappa all'altra.",
      ];
    }
    if (variantKey === "advanced") {
      return [
        ...base,
        "Il periodo funziona come Subject editoriale autonomo e non come tappa fisica.",
        "Le relazioni semantiche rendono esplicito perché più opere possono essere lette nello stesso quadro storico.",
        "Confronta continuità e differenze senza trasformare il periodo in una spiegazione automatica di ogni scelta formale.",
        "Usa il contesto come guida per formulare domande verificabili sulle opere collegate.",
      ];
    }
    return [
      ...base,
      "Non è una tappa fisica: è un contenuto di approfondimento.",
      "Dal grafo puoi raggiungere le opere collegate a questo contesto.",
      "Confronta almeno due opere e cerca una somiglianza e una differenza.",
      "Poi torna alla visita mantenendo distinto il luogo dal contenuto editoriale.",
    ];
  }

  if (languageKey === "advanced") {
    const base = [
      `${title} è modellato come Subject editoriale di contesto nella Raccolta ArtAround.`,
      `${description} La sua funzione è semantica e interpretativa, non topologica.`,
    ];
    if (variantKey === "context") {
      return [
        ...base,
        "La modellazione separa il riferimento storico dalla presenza fisica delle opere e permette una navigazione semantica esplicita.",
        "Le relazioni verso le opere sono quindi strumenti di contestualizzazione e confronto, non scorciatoie per inferire automaticamente attribuzioni o significati.",
        "Il valore del nodo emerge dalla possibilità di confrontare più Item pubblicati che condividono lo stesso quadro storico-editoriale.",
        "La lettura resta verificabile perché ogni passaggio mostrato al visitatore deriva da contenuti e relazioni pinzati nella release.",
      ];
    }
    if (variantKey === "advanced") {
      return [
        ...base,
        "Il nodo consente di distinguere identità semantica, corpus editoriale e collocazione fisica mantenendo separati i rispettivi invarianti.",
        "Nel confronto tra opere, il periodo opera come categoria interpretativa fallibile: orienta l'analisi ma non sostituisce le evidenze formali e iconografiche.",
        "La rete di relazioni permette di esplicitare convergenze e scarti tra opere senza appiattirle su una tassonomia unica.",
        "Questa struttura resta estendibile a interrogazioni, traduzione e generazione assistita senza introdurre contenuti fantasma nel grafo della Raccolta.",
      ];
    }
    return [
      ...base,
      "La release conserva separatamente Item, grafo semantico e riferimenti fisici, così il contesto può essere fruito senza diventare una tappa autonoma.",
      "Le opere collegate costituiscono esempi concreti attraverso cui verificare il significato operativo della categoria.",
      "Il confronto deve distinguere osservazioni direttamente ricavabili dalle opere da interpretazioni dipendenti dal quadro storico.",
      "Il ritorno alla sequenza di visita mantiene il contenuto contestuale disponibile come approfondimento senza alterare il routing.",
    ];
  }

  const base = [
    `${title} è un contenuto storico-artistico della Raccolta ArtAround.`,
    `${description} Nel grafo semantico è distinto dalle singole opere e dalla loro collocazione fisica.`,
  ];
  if (variantKey === "context") {
    return [
      ...base,
      "Il nodo permette di collegare più opere allo stesso quadro storico e di confrontarne le diverse soluzioni figurative.",
      "Questa relazione non sostituisce l'osservazione delle opere: fornisce invece un contesto esplicito per interpretare somiglianze e differenze.",
      "La navigazione può passare dall'opera al periodo e dal periodo alle altre opere senza inventare tappe o posizioni nel museo.",
      "Il risultato è un approfondimento coerente con la Raccolta pubblicata e con i contenuti realmente disponibili.",
    ];
  }
  if (variantKey === "advanced") {
    return [
      ...base,
      "Come Subject di contesto, il periodo organizza relazioni editoriali che possono essere percorse e interrogate indipendentemente dal layout della Venue.",
      "L'analisi comparativa deve usare la categoria storica come ipotesi interpretativa e confrontarla con composizione, luce, gestualità e iconografia delle opere.",
      "La distinzione fra nodo semantico e Item consente inoltre di associare più presentazioni dello stesso contesto senza duplicarne l'identità concettuale.",
      "La release pinzata garantisce che sia il contenuto sia le relazioni consultate dal Navigator appartengano allo stesso snapshot editoriale.",
    ];
  }
  return [
    ...base,
    "Il contenuto serve a introdurre il quadro storico prima di esplorare le opere collegate.",
    "Le relazioni del grafo rendono esplicito quali tappe della Raccolta sono pertinenti a questo contesto.",
    "Confrontando due opere si possono riconoscere continuità e differenze senza ridurle a una semplice etichetta.",
    "Il contesto resta disponibile come approfondimento, mentre il percorso fisico continua a essere governato dalla Venue.",
  ];
}

function simpleSentences(work, variantKey) {
  if (work.contentKind === "period") return semanticContextSentences(work, "simple", variantKey);
  const base = [
    `${work.title} è un'opera di ${work.artist}.`,
    `Guarda soprattutto ${work.focus}.`,
  ];
  if (variantKey === "context") {
    return [
      ...base,
      `L'opera appartiene al percorso dedicato al ${periodLabel(work)}.`,
      "Osserva come le figure e lo spazio aiutano a raccontare la scena.",
      "Confrontala con le opere vicine e cerca somiglianze e differenze nel modo di usare luce, gesti e colori.",
      "Non serve ricordare tutte le definizioni: l'obiettivo è capire quali scelte dell'artista cambiano il modo in cui guardiamo l'opera.",
    ];
  }
  if (variantKey === "advanced") {
    return [
      ...base,
      "Prova a distinguere il soggetto rappresentato dal modo in cui l'artista organizza la scena.",
      "Nota quali elementi attirano subito lo sguardo e quali invece si scoprono osservando più a lungo.",
      "La posizione delle figure, la luce e la profondità possono suggerire movimento, calma o tensione.",
      "Confrontando questi elementi con altre tappe puoi costruire una lettura personale, purché resti collegata a ciò che vedi.",
    ];
  }
  return [
    ...base,
    "Individua il personaggio o la zona che attira per prima la tua attenzione.",
    "Poi sposta lo sguardo sui dettagli vicini e verifica come aiutano a capire la scena.",
    "Osserva anche luce e colori: possono separare le figure importanti dallo sfondo oppure collegarle tra loro.",
    "Prima di passare alla tappa successiva prova a descrivere con una frase che cosa rende riconoscibile quest'opera.",
  ];
}

function standardSentences(work, variantKey) {
  if (work.contentKind === "period") return semanticContextSentences(work, "standard", variantKey);
  const base = [
    `${work.title}, di ${work.artist}, è una delle opere considerate nel percorso ArtAround della Pinacoteca Nazionale di Bologna.`,
    `Il primo elemento da osservare è ${work.focus}.`,
  ];
  if (variantKey === "context") {
    return [
      ...base,
      `La tappa viene letta nel contesto del ${periodLabel(work)}, mettendo in relazione l'opera con il linguaggio figurativo e con le scelte narrative del periodo.`,
      "La disposizione delle figure e l'organizzazione dello spazio guidano lo sguardo e stabiliscono una gerarchia fra gli elementi della scena.",
      "Il confronto con le opere vicine permette di riconoscere continuità e differenze nell'uso della luce, del gesto e della costruzione compositiva.",
      "Questi confronti non servono a ridurre l'opera a un'etichetta, ma a capire come uno stesso problema figurativo possa ricevere soluzioni differenti.",
    ];
  }
  if (variantKey === "advanced") {
    return [
      ...base,
      "Conviene separare almeno tre livelli di lettura: soggetto rappresentato, organizzazione formale e funzione espressiva delle scelte visive.",
      "Direzioni, masse e intervalli fra le figure costruiscono un ritmo che può rafforzare o rallentare la narrazione.",
      "Anche la luce va letta come elemento compositivo: non illumina soltanto, ma seleziona zone, crea profondità e stabilisce rapporti gerarchici.",
      "Una lettura comparativa diventa quindi più solida quando collega osservazioni verificabili nell'immagine a ipotesi sul contesto e sulle intenzioni dell'opera.",
    ];
  }
  return [
    ...base,
    "La composizione distribuisce l'attenzione attraverso figure, gesti e direzioni dello sguardo, evitando che tutti gli elementi abbiano lo stesso peso visivo.",
    "Osservando la relazione fra primo piano e sfondo si può capire come l'artista costruisca profondità e successione narrativa.",
    "Luce e colore contribuiscono a rendere riconoscibili i nuclei principali e a collegare fra loro parti distanti della scena.",
    "Prima di proseguire, prova a individuare quale scelta formale incide maggiormente sul modo in cui percepisci l'opera.",
  ];
}

function advancedSentences(work, variantKey) {
  if (work.contentKind === "period") return semanticContextSentences(work, "advanced", variantKey);
  const base = [
    `${work.title} di ${work.artist} può essere analizzata distinguendo struttura iconografica, articolazione spaziale e organizzazione compositiva.`,
    `Il focus della tappa è ${work.focus}, assunto come punto di partenza per una lettura formale verificabile sull'opera.`,
  ];
  if (variantKey === "context") {
    return [
      ...base,
      `Nel quadro del ${periodLabel(work)}, questo elemento consente di discutere il rapporto fra convenzioni figurative condivise e scelte specifiche dell'autore.`,
      "La gerarchia visiva nasce dall'interazione fra assi compositivi, gestualità, densità delle masse e distribuzione dei vuoti, più che da un singolo dettaglio isolato.",
      "Il confronto sincronico con altre opere del percorso permette di valutare continuità, scarti e riformulazioni di problemi analoghi senza assumere lo stile come categoria esplicativa autosufficiente.",
      "In questa prospettiva il contesto storico-editoriale funziona come strumento interpretativo: orienta le domande, ma deve restare subordinato alle evidenze osservabili nella costruzione dell'immagine.",
    ];
  }
  if (variantKey === "advanced") {
    return [
      ...base,
      "L'impianto può essere letto attraverso rapporti di equilibrio e tensione fra direttrici, masse figurative e profondità, considerando come tali relazioni producano una specifica temporalità della visione.",
      "Il chiaroscuro e la distribuzione cromatica assumono valore strutturale quando selezionano i nuclei semantici, modulano le distanze e controllano la continuità fra primo piano e spazio retrostante.",
      "La gestualità non va considerata esclusivamente in termini espressivi: partecipa alla sintassi compositiva, crea vettori e può stabilire rimandi interni fra zone non contigue dell'opera.",
      "Una lettura critica dovrebbe quindi formulare ipotesi graduabili, distinguendo ciò che è direttamente osservabile da ciò che dipende dal confronto storico, dalla tradizione iconografica o da interpretazioni successive.",
    ];
  }
  return [
    ...base,
    "La distribuzione delle masse e dei vuoti definisce una gerarchia percettiva che orienta l'accesso dello spettatore alla scena e ne regola i tempi di lettura.",
    "Le direttrici implicite prodotte da pose, gesti e sguardi possono essere considerate vettori compositivi, capaci di collegare nuclei figurativi distinti.",
    "Luce e colore partecipano alla costruzione dello spazio attraverso differenze di intensità, continuità tonali e cesure che articolano i diversi piani dell'immagine.",
    "L'analisi diventa più significativa quando queste osservazioni vengono confrontate con altre tappe, evitando sia la pura descrizione sia l'attribuzione automatica di ogni caratteristica a una generica etichetta stilistica.",
  ];
}

function representationText(work, variantKey, durationKey, languageKey) {
  const sentences = languageKey === "simple"
    ? simpleSentences(work, variantKey)
    : languageKey === "advanced"
      ? advancedSentences(work, variantKey)
      : standardSentences(work, variantKey);
  const sentenceCount = durationKey === "short" ? 2 : durationKey === "medium" ? 4 : 6;
  return sentences.slice(0, sentenceCount).join(" ");
}

function buildRepresentations(work, variantKey) {
  return DURATION_AXIS.flatMap((duration) => LANGUAGE_AXIS.map((language) => ({
    _id: demoId(`representation:${work.key}:${variantKey}:${duration.key}:${language.key}`),
    durationTypeDefinitionId: duration.definitionId,
    languageLevelDefinitionId: language.definitionId,
    locale: "it-IT",
    text: representationText(work, variantKey, duration.key, language.key),
  })));
}

function buildVariantMatrix(work, variant) {
  return {
    _id: variant._id,
    key: variant.key,
    label: variant.label,
    description: variant.description,
    semanticFocus: variant.semanticFocus || [],
    presentationAspects: variant.presentationAspects || [],
    audienceSuitability: variant.audienceSuitability || null,
    knowledgeRequirements: variant.knowledgeRequirements || [],
    representations: buildRepresentations(work, variant.key),
  };
}

function presentationContentByRevisionId() {
  return new Map([
    ...WORKS.map((work) => [
      String(demoId(`item-revision:${work.key}`)),
      { ...work, contentKind: "work" },
    ]),
    ...PERIODS.map((period) => [
      String(demoId(`item-revision:period:${period.key}`)),
      {
        key: `period:${period.key}`,
        title: period.label,
        description: period.description,
        period: period.key,
        contentKind: "period",
      },
    ]),
  ]);
}

function expectedCombinationKeys() {
  return new Set(DURATION_AXIS.flatMap((duration) => LANGUAGE_AXIS.map((language) => `${duration.definitionId}|${language.definitionId}|it-it`)));
}

function verifyRevisionMatrix(revision, namespaceRevision) {
  const failures = [];
  const expected = expectedCombinationKeys();
  for (const variant of revision.presentationVariants || []) {
    const actual = new Set((variant.representations || []).map((representation) =>
      `${representation.durationTypeDefinitionId}|${representation.languageLevelDefinitionId}|${String(representation.locale).toLowerCase()}`));
    if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
      failures.push(`Variant ${variant.key} non contiene la matrice completa 3x3`);
      continue;
    }
    const middle = (variant.representations || []).find((representation) =>
      String(representation.durationTypeDefinitionId) === String(DEF.durationMedium)
      && String(representation.languageLevelDefinitionId) === String(DEF.languageStandard)
      && String(representation.locale).toLowerCase() === "it-it");
    if (!middle) {
      failures.push(`Variant ${variant.key} priva della Representation Media + Standard`);
      continue;
    }
    const current = {
      variantId: variant._id,
      representationId: middle._id,
      durationTypeDefinitionId: middle.durationTypeDefinitionId,
      languageLevelDefinitionId: middle.languageLevelDefinitionId,
      locale: middle.locale,
    };
    for (const [axis, direction, label] of [
      ["duration", "up", "Dimmi di più"],
      ["duration", "down", "Dimmi di meno"],
      ["language", "up", "Più specialistico"],
      ["language", "down", "Più semplice"],
    ]) {
      if (!findAdjacentPresentation({ revision, namespaceRevision, current, axis, direction })) {
        failures.push(`Variant ${variant.key}: azione ${label} non risolvibile dal centro della matrice`);
      }
    }
  }
  return failures;
}

async function enrichExamPresentationMatrix() {
  const [namespaceRevision, editorialRelease] = await Promise.all([
    NamespaceRevision.findById(IDS.namespaceRevision).lean(),
    EditorialRelease.findById(IDS.editorialRelease).lean(),
  ]);
  if (!namespaceRevision) throw new Error("NamespaceRevision demo non disponibile");
  if (!editorialRelease) throw new Error("EditorialRelease demo non disponibile");

  const contentByRevisionId = presentationContentByRevisionId();
  const revisionIds = (editorialRelease.itemBindings || []).map((binding) => binding.itemRevisionId);
  const revisions = await ItemRevisionV2.find({ _id: { $in: revisionIds } });
  if (revisions.length !== revisionIds.length) throw new Error("Una o più ItemRevision demo non sono disponibili");

  for (const revision of revisions) {
    const content = contentByRevisionId.get(String(revision._id));
    if (!content) throw new Error(`Impossibile associare il contenuto alla ItemRevision ${revision._id}`);
    const variants = (revision.presentationVariants || []).map((variant) => buildVariantMatrix(content, variant.toObject ? variant.toObject() : variant));
    const essential = variants.find((variant) => variant.key === "essential") || variants[0];
    const defaultRepresentation = essential?.representations.find((representation) =>
      String(representation.durationTypeDefinitionId) === String(DEF.durationShort)
      && String(representation.languageLevelDefinitionId) === String(DEF.languageSimple));
    if (!essential || !defaultRepresentation) throw new Error(`Default presentation demo non costruibile per ${revision._id}`);

    revision.presentationVariants = variants;
    revision.defaultPresentation = { variantId: essential._id, representationId: defaultRepresentation._id };
    await revision.save();

    const leanRevision = revision.toObject();
    const validationIssues = validatePresentationAgainstNamespace(leanRevision, namespaceRevision);
    if (validationIssues.length) {
      throw new Error(`Matrice presentation non valida per ${revision._id}: ${JSON.stringify(validationIssues)}`);
    }
    const matrixFailures = verifyRevisionMatrix(leanRevision, namespaceRevision);
    if (matrixFailures.length) throw new Error(`${revision._id}: ${matrixFailures.join("; ")}`);

    const initial = resolveInitialPresentation({
      revision: leanRevision,
      namespaceRevision,
      visitBaseline: { depthPreference: 0.55, languageComplexityPreference: 0.5, locale: "it-IT" },
    });
    if (String(initial.durationTypeDefinitionId) !== String(DEF.durationMedium)
      || String(initial.languageLevelDefinitionId) !== String(DEF.languageStandard)) {
      throw new Error(`La baseline demo intermedia non risolve Media + Standard per ${revision._id}`);
    }
  }

  return { itemRevisions: revisions.length, representationsPerVariant: 9 };
}

async function verifyExamPresentationMatrix() {
  const [namespaceRevision, editorialRelease] = await Promise.all([
    NamespaceRevision.findById(IDS.namespaceRevision).lean(),
    EditorialRelease.findById(IDS.editorialRelease).lean(),
  ]);
  if (!namespaceRevision || !editorialRelease) {
    return { ok: false, failures: ["Dataset demo di base non disponibile"] };
  }
  const revisionIds = (editorialRelease.itemBindings || []).map((binding) => binding.itemRevisionId);
  const revisions = await ItemRevisionV2.find({ _id: { $in: revisionIds }, status: "published" }).lean();
  const failures = [];
  if (revisions.length !== revisionIds.length) failures.push("Non tutte le ItemRevision pubblicate della release demo sono disponibili");
  for (const revision of revisions) failures.push(...verifyRevisionMatrix(revision, namespaceRevision).map((message) => `${revision._id}: ${message}`));
  return {
    ok: failures.length === 0,
    failures,
    summary: {
      itemRevisions: revisions.length,
      variants: revisions.reduce((sum, revision) => sum + (revision.presentationVariants || []).length, 0),
      representations: revisions.reduce((sum, revision) => sum + (revision.presentationVariants || []).reduce((variantSum, variant) => variantSum + (variant.representations || []).length, 0), 0),
    },
  };
}

module.exports = {
  DURATION_AXIS,
  LANGUAGE_AXIS,
  representationText,
  buildRepresentations,
  enrichExamPresentationMatrix,
  verifyExamPresentationMatrix,
};
