const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user");
const Organization = require("../models/organization.model");
const OrganizationRole = require("../models/organizationRole.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrganizationAuthorizationEvent = require("../models/organizationAuthorizationEvent.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const ExhibitSlot = require("../models/exhibitSlot.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");

const { hashPassword, verifyPassword } = require("../services/auth.service");
const { validateNamespaceRevisionSnapshot } = require("../services/validation/namespace.validation");
const { validatePresentationAgainstNamespace } = require("../services/itemV2Presentation.service");
const { validateEditorialReleaseCoherence } = require("../services/editorialReleaseIntegrity.service");
const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
const { computeVisitV2Integrity } = require("../services/visitV2Integrity.service");
const { assertSelfContainedOffer } = require("../services/marketplaceOfferIntegrity.service");
const { ensureStarterRoles, replaceMembershipWithStarterRole } = require("../services/organizationBootstrap.service");
const { createDemoPhysicalVocabulary, physicalAttributeValues } = require("./demoPhysicalVocabulary");

const REQUIRED_USERNAMES = Object.freeze(["autore1", "autore2", "visitatore1", "visitatore2"]);
const REQUIRED_PASSWORD = "12345678";
const FIXED_NOW = new Date("2026-09-12T14:00:00.000Z");
const PINACOTECA_VENUE_ID = "496f78e51b8861a9800749a7";

function demoId(name) {
  return new mongoose.Types.ObjectId(crypto.createHash("sha1").update(`artaround-demo-v3:${name}`).digest("hex").slice(0, 24));
}
function reviewApproved(userId) {
  return {
    requestedAt: FIXED_NOW, requestedBy: userId, reviewedAt: FIXED_NOW, reviewedBy: userId,
    decision: "approved", message: null,
    events: [
      { action: "review_requested", actorUserId: userId, at: FIXED_NOW, message: null },
      { action: "published", actorUserId: userId, at: FIXED_NOW, message: null },
    ],
  };
}
function assertNoBlocking(label, issues = []) {
  const blocking = issues.filter((entry) => entry.severity !== "warning");
  if (blocking.length) throw new Error(`${label}: ${JSON.stringify(blocking)}`);
}

const ART_DEF = Object.freeze({
  work: "10000000-0000-4000-8000-000000000001", author: "10000000-0000-4000-8000-000000000002",
  context: "10000000-0000-4000-8000-000000000003", technique: "10000000-0000-4000-8000-000000000004",
  relAuthor: "10000000-0000-4000-8000-000000000101", relContext: "10000000-0000-4000-8000-000000000102", relTechnique: "10000000-0000-4000-8000-000000000103",
  durationShort: "10000000-0000-4000-8000-000000000201", durationMedium: "10000000-0000-4000-8000-000000000202", durationLong: "10000000-0000-4000-8000-000000000203",
  languageSimple: "10000000-0000-4000-8000-000000000301", languagePopular: "10000000-0000-4000-8000-000000000302", languageSpecialist: "10000000-0000-4000-8000-000000000303",
  signalOverview: "10000000-0000-4000-8000-000000000401", signalBiography: "10000000-0000-4000-8000-000000000402", signalCuriosity: "10000000-0000-4000-8000-000000000403", signalAnecdote: "10000000-0000-4000-8000-000000000404",
});
const ARCHAEOLOGY_DEF = Object.freeze({
  artifact: "20000000-0000-4000-8000-000000000001", culture: "20000000-0000-4000-8000-000000000002", material: "20000000-0000-4000-8000-000000000003",
  relCulture: "20000000-0000-4000-8000-000000000101", relMaterial: "20000000-0000-4000-8000-000000000102", relRelated: "20000000-0000-4000-8000-000000000103",
  durationShort: "20000000-0000-4000-8000-000000000201", durationDeep: "20000000-0000-4000-8000-000000000202",
  languageAccessible: "20000000-0000-4000-8000-000000000301", languageSpecialist: "20000000-0000-4000-8000-000000000302",
  signalOverview: "20000000-0000-4000-8000-000000000401", signalContext: "20000000-0000-4000-8000-000000000402",
});

function baseDef(definitionId, key, label, description) { return { definitionId, key, label, description, semanticRefs: [] }; }
function relation(definitionId, key, label, description, domain, range, extra = {}) {
  return {
    ...baseDef(definitionId, key, label, description), domainDefinitionIds: [domain], rangeDefinitionIds: [range],
    category: extra.category || "semantic", strength: extra.strength || "strong", directionality: extra.directionality || "directed",
    userIntents: extra.userIntents || [], targetSelectionSignals: extra.targetSelectionSignals || [],
    reverse: { label: extra.reverseLabel || label, description: extra.reverseDescription || description, userIntents: extra.reverseIntents || [], targetSelectionSignals: extra.reverseSignals || [] },
    validationRules: { allowMultiple: true, targetRequired: true },
  };
}
function artNamespaceSnapshot() {
  const overview = [{ definitionId: ART_DEF.signalOverview, weight: 1 }];
  return {
    durationTypes: [
      { ...baseDef(ART_DEF.durationShort, "breve", "Breve", "Per una lettura rapida davanti all'opera, con le informazioni essenziali."), targetSeconds: 60 },
      { ...baseDef(ART_DEF.durationMedium, "media", "Media", "Per una spiegazione completa ma accessibile durante la visita."), targetSeconds: 180 },
      { ...baseDef(ART_DEF.durationLong, "approfondita", "Approfondita", "Per chi desidera soffermarsi e conoscere dettagli, confronti e contesto."), targetSeconds: 360 },
    ],
    languageLevels: [
      baseDef(ART_DEF.languageSimple, "semplice", "Semplice", "Frasi brevi, termini comuni e nessuna conoscenza pregressa richiesta."),
      baseDef(ART_DEF.languagePopular, "divulgativo", "Divulgativo", "Linguaggio chiaro con i termini disciplinari necessari sempre spiegati."),
      baseDef(ART_DEF.languageSpecialist, "specialistico", "Specialistico", "Lessico disciplinare e riferimenti adatti a un pubblico già competente."),
    ],
    subjectClasses: [
      baseDef(ART_DEF.work, "opera-bene-culturale", "Opera o bene culturale", "Dipinti, sculture, manufatti e altri beni culturali raccontati nei contenuti."),
      baseDef(ART_DEF.author, "persona-autore", "Persona o autore", "Persone, gruppi o botteghe che hanno ideato o realizzato un'opera."),
      baseDef(ART_DEF.context, "contesto-storico-culturale", "Periodo, luogo o contesto culturale", "Periodi storici, luoghi, movimenti artistici e condizioni geopolitiche collegati a un'opera."),
      baseDef(ART_DEF.technique, "materiale-tecnica", "Materiale o tecnica", "Materiali, supporti, strumenti e tecniche impiegati per realizzare un'opera."),
    ],
    selectionSignals: [
      baseDef(ART_DEF.signalOverview, "panoramica", "Panoramica", "Contenuto adatto a introdurre il soggetto o a rispondere a una richiesta generale."),
      baseDef(ART_DEF.signalBiography, "biografia", "Biografia", "Contenuto centrato sulla vita, il percorso e il profilo di una persona o autore."),
      baseDef(ART_DEF.signalCuriosity, "curiosita", "Curiosità", "Contenuto adatto a richieste di dettagli insoliti, curiosi o sorprendenti."),
      baseDef(ART_DEF.signalAnecdote, "aneddoto", "Aneddoto", "Contenuto centrato su episodi e racconti specifici relativi al soggetto."),
    ],
    relationTypes: [
      relation(ART_DEF.relAuthor, "creata-da", "Creata da", "Risponde alla domanda “Chi è l'autore?” e collega l'opera alla persona o al gruppo che l'ha realizzata.", ART_DEF.work, ART_DEF.author, { userIntents: ["chi è l'autore", "chi ha creato l'opera"], targetSelectionSignals: [...overview, { definitionId: ART_DEF.signalBiography, weight: .9 }], reverseLabel: "Autore di", reverseIntents: ["quali opere ha realizzato"], reverseSignals: overview }),
      relation(ART_DEF.relContext, "contesto-storico-culturale", "Contesto storico e culturale", "Collega l'opera al periodo, al luogo o al movimento culturale pertinente.", ART_DEF.work, ART_DEF.context, { category: "contextual", userIntents: ["quando è stata realizzata", "qual è il contesto storico e culturale"], targetSelectionSignals: overview, reverseLabel: "Contesto di", reverseIntents: ["quali opere appartengono a questo contesto"], reverseSignals: overview }),
      relation(ART_DEF.relTechnique, "tecnica-esecuzione", "Tecnica e esecuzione", "Collega l'opera ai materiali e ai procedimenti usati per realizzarla.", ART_DEF.work, ART_DEF.technique, { userIntents: ["quale tecnica è stata usata", "come è stata realizzata"], targetSelectionSignals: overview, reverseLabel: "Impiegata in", reverseIntents: ["in quali opere è stata impiegata"], reverseSignals: overview }),
    ],
    presentationAspects: [],
  };
}
function archaeologyNamespaceSnapshot() {
  const overview = [{ definitionId: ARCHAEOLOGY_DEF.signalOverview, weight: 1 }];
  return {
    durationTypes: [
      { ...baseDef(ARCHAEOLOGY_DEF.durationShort, "essenziale", "Essenziale", "Sintesi per riconoscere reperto, funzione e contesto."), targetSeconds: 75 },
      { ...baseDef(ARCHAEOLOGY_DEF.durationDeep, "approfondita", "Approfondita", "Lettura archeologica con contesto, tecnica e confronti."), targetSeconds: 240 },
    ],
    languageLevels: [
      baseDef(ARCHAEOLOGY_DEF.languageAccessible, "accessibile", "Accessibile", "Lessico chiaro, termini archeologici spiegati nel testo."),
      baseDef(ARCHAEOLOGY_DEF.languageSpecialist, "specialistico", "Specialistico", "Lessico disciplinare, cronologie e confronti tipologici."),
    ],
    subjectClasses: [
      baseDef(ARCHAEOLOGY_DEF.artifact, "reperto", "Reperto archeologico", "Oggetto o manufatto archeologico esposto."),
      baseDef(ARCHAEOLOGY_DEF.culture, "contesto-culturale", "Contesto culturale", "Periodo, cultura o area di provenienza utile a interpretare il reperto."),
      baseDef(ARCHAEOLOGY_DEF.material, "materiale", "Materiale", "Materia e tecnica costitutiva del reperto."),
    ],
    selectionSignals: [baseDef(ARCHAEOLOGY_DEF.signalOverview, "panoramica", "Panoramica", "Introduzione al reperto."), baseDef(ARCHAEOLOGY_DEF.signalContext, "contesto", "Contesto", "Approfondimento storico-archeologico.")],
    relationTypes: [
      relation(ARCHAEOLOGY_DEF.relCulture, "appartiene-al-contesto", "Appartiene al contesto", "Collega il reperto al periodo o alla cultura di riferimento.", ARCHAEOLOGY_DEF.artifact, ARCHAEOLOGY_DEF.culture, { category: "contextual", userIntents: ["da quale contesto proviene", "quando è stato prodotto"], targetSelectionSignals: [{ definitionId: ARCHAEOLOGY_DEF.signalContext, weight: 1 }], reverseLabel: "Comprende il reperto", reverseSignals: overview }),
      relation(ARCHAEOLOGY_DEF.relMaterial, "realizzato-in", "Realizzato in", "Collega il reperto al materiale principale.", ARCHAEOLOGY_DEF.artifact, ARCHAEOLOGY_DEF.material, { userIntents: ["di che materiale è fatto"], targetSelectionSignals: overview, reverseLabel: "Materiale di", reverseSignals: overview }),
      relation(ARCHAEOLOGY_DEF.relRelated, "reperto-correlato", "Reperto correlato", "Collega reperti utili per un confronto tipologico o culturale.", ARCHAEOLOGY_DEF.artifact, ARCHAEOLOGY_DEF.artifact, { category: "editorial", strength: "medium", directionality: "symmetric", userIntents: ["confronta con un altro reperto"], targetSelectionSignals: overview, reverseSignals: overview }),
    ],
    presentationAspects: [],
  };
}

const PINACOTECA_WORKS = Object.freeze([
  ["ludovico-annunciazione", "Annunciazione", "ludovico-carracci", "riforma-carracci", "pala-altare", "la chiarezza narrativa e il rapporto tra gesto, spazio e devozione"],
  ["ludovico-conversione-paolo", "Conversione di san Paolo", "ludovico-carracci", "riforma-carracci", "olio-tela", "il movimento della scena e la costruzione drammatica dell'episodio"],
  ["agostino-assunzione", "Assunzione della Vergine", "agostino-carracci", "riforma-carracci", "pala-altare", "la disposizione ascensionale delle figure e l'apertura dello spazio"],
  ["agostino-comunione-gerolamo", "Comunione di san Gerolamo", "agostino-carracci", "riforma-carracci", "olio-tela", "la regia degli sguardi e il carattere solenne della scena"],
  ["annibale-madonna-ludovico", "Madonna di san Ludovico", "annibale-carracci", "classicismo-bolognese", "pala-altare", "l'equilibrio tra monumentalità e naturalezza delle figure"],
  ["annibale-assunzione", "Assunzione della Vergine", "annibale-carracci", "classicismo-bolognese", "olio-tela", "la tensione verso l'alto e la sintesi tra colore e disegno"],
  ["reni-strage", "Strage degli innocenti", "guido-reni", "classicismo-seicento", "olio-tela", "la tensione narrativa controllata da una composizione rigorosa"],
  ["reni-sansone", "Sansone vittorioso", "guido-reni", "classicismo-seicento", "chiaroscuro", "la monumentalità della figura e il contrasto tra azione e posa"],
  ["domenichino-agnese", "Martirio di sant'Agnese", "domenichino", "classicismo-seicento", "pala-altare", "la distribuzione dei personaggi e la progressione del racconto"],
  ["domenichino-rosario", "Madonna del Rosario", "domenichino", "classicismo-seicento", "olio-tela", "la gerarchia delle figure e il ritmo della devozione"],
  ["guercino-san-guglielmo", "Vestizione di san Guglielmo", "guercino", "barocco-emiliano", "chiaroscuro", "la luce teatrale e la profondità costruita per piani"],
  ["guercino-san-bruno", "San Bruno in adorazione della Madonna", "guercino", "barocco-emiliano", "chiaroscuro", "il rapporto tra intensità luminosa, gesto e raccoglimento"],
].map(([key, label, author, context, technique, descriptor]) => ({ key, label, author, context, technique, descriptor })));
const PINACOTECA_AUX = Object.freeze({
  authors: [["ludovico-carracci", "Ludovico Carracci"], ["agostino-carracci", "Agostino Carracci"], ["annibale-carracci", "Annibale Carracci"], ["guido-reni", "Guido Reni"], ["domenichino", "Domenichino"], ["guercino", "Guercino"]],
  contexts: [["riforma-carracci", "Riforma dei Carracci"], ["classicismo-bolognese", "Classicismo bolognese tra Cinque e Seicento"], ["classicismo-seicento", "Classicismo bolognese del Seicento"], ["barocco-emiliano", "Barocco emiliano"]],
  techniques: [["olio-tela", "Pittura a olio su tela"], ["pala-altare", "Pala d'altare"], ["chiaroscuro", "Costruzione luministica e chiaroscuro"]],
});
const MAMBO_WORKS = Object.freeze([
  ["guttuso-funerali", "I funerali di Togliatti", "renato-guttuso", "arte-ideologia", "pittura-collage", "la scena corale, i ritratti e il rapporto fra immagine e memoria politica"],
  ["guttuso-comizio", "Il comizio – Omaggio a Giuseppe Di Vittorio", "renato-guttuso", "arte-ideologia", "pittura-collage", "la folla come struttura compositiva e il legame fra pittura e partecipazione civile"],
  ["schifano-cocacola", "Coca Cola (particolare)", "mario-schifano", "nuove-prospettive", "pittura-segno", "la trasformazione del marchio commerciale in superficie pittorica"],
  ["schifano-acquatico", "Acquatico dipinto", "mario-schifano", "nuove-prospettive", "pittura-segno", "la relazione fra immagine mediale, colore e frammentazione della visione"],
  ["zorio-stella93", "Stella di terracotta 93", "gilberto-zorio", "arte-povera", "installazione-materiale", "la stella come forma energetica costruita attraverso materia e tensione spaziale"],
  ["zorio-stella-bologna", "Stella di Bologna", "gilberto-zorio", "arte-povera", "installazione-materiale", "il rapporto tra forma simbolica, spazio museale e trasformazione dei materiali"],
  ["paladino-teste", "Teste", "mimmo-paladino", "ritorno-figura", "installazione-materiale", "la ripetizione della figura e il carattere arcaico delle forme"],
  ["paladino-visconte", "Il visconte dimezzato", "mimmo-paladino", "ritorno-figura", "pittura-segno", "la narrazione per frammenti e il dialogo fra immagine, letteratura e simbolo"],
  ["morandi-fiori", "Fiori", "giorgio-morandi", "ricerca-morandi", "olio-tela", "la concentrazione su pochi oggetti e le variazioni minime di luce, distanza e tono"],
  ["morandi-natura-morta", "Natura morta", "giorgio-morandi", "ricerca-morandi", "olio-tela", "l'equilibrio fra bottiglie, vuoti e passaggi tonali in uno spazio raccolto"],
  ["fontana-concetto", "Concetto spaziale", "lucio-fontana", "nuove-prospettive", "gesto-superficie", "il gesto che modifica fisicamente la superficie e apre l'opera allo spazio reale"],
  ["fontana-attese", "Concetto spaziale, Attese", "lucio-fontana", "nuove-prospettive", "gesto-superficie", "il taglio come atto capace di unire superficie, luce e spazio oltre il quadro"],
].map(([key, label, author, context, technique, descriptor]) => ({ key, label, author, context, technique, descriptor })));
const MAMBO_AUX = Object.freeze({
  authors: [["renato-guttuso", "Renato Guttuso"], ["mario-schifano", "Mario Schifano"], ["gilberto-zorio", "Gilberto Zorio"], ["mimmo-paladino", "Mimmo Paladino"], ["giorgio-morandi", "Giorgio Morandi"], ["lucio-fontana", "Lucio Fontana"]],
  contexts: [["arte-ideologia", "Arte e ideologia nel secondo Novecento"], ["nuove-prospettive", "Nuove prospettive e cultura dell'immagine"], ["arte-povera", "Arte Povera"], ["ritorno-figura", "Ritorno alla figura e nuova pittura"], ["ricerca-morandi", "La ricerca di Giorgio Morandi"]],
  techniques: [["pittura-collage", "Pittura, collage e assemblaggio"], ["pittura-segno", "Pittura e segno"], ["installazione-materiale", "Installazione e materia"], ["olio-tela", "Olio su tela"], ["gesto-superficie", "Intervento gestuale sulla superficie"]],
});
const ARCHAEOLOGY_ARTIFACTS = Object.freeze([
  ["levallois", "Nucleo e schegge della tecnica Levallois", "preistoria-bolognese", "pietra", "la pianificazione della scheggiatura e l'efficienza degli strumenti del Paleolitico medio"],
  ["bifacciale", "Strumento bifacciale preistorico", "preistoria-bolognese", "pietra", "la lavorazione bifacciale della pietra e l'adattamento degli strumenti alle attività quotidiane"],
  ["hydria-hadra", "Hydria di Hadra", "mondo-greco", "argilla", "la forma del vaso, la decorazione dipinta e la funzione funeraria"],
  ["oinochoe-campana", "Oinochoe campana a figure rosse", "mondo-greco", "argilla", "la testa di satiro e il rapporto fra decorazione figurata e forma del vaso"],
  ["cratere-figure-rosse", "Cratere a figure rosse", "mondo-greco", "argilla", "la funzione conviviale del vaso e la costruzione delle scene figurate"],
  ["stele-etrusca", "Stele funeraria etrusca", "etruria-padana", "pietra", "le immagini funerarie e la memoria delle comunità etrusche di Felsina"],
  ["situla-etrusca", "Situla decorata", "etruria-padana", "bronzo", "la lavorazione della lamina metallica e il linguaggio figurativo dell'Etruria padana"],
  ["fibula-etrusca", "Fibula in bronzo", "etruria-padana", "bronzo", "la funzione dell'oggetto personale e le tecniche della metallurgia antica"],
  ["naoforo", "Statua naofora egizia", "egitto-antico", "pietra", "la postura rituale, il piccolo naos e il valore delle iscrizioni nella cultura egizia"],
  ["statuetta-divinita", "Statuetta di divinità egizia", "egitto-antico", "bronzo", "la scala ridotta, gli attributi iconografici e la pratica devozionale"],
  ["sarcofago-frammento", "Frammento di sarcofago decorato", "egitto-antico", "legno", "la decorazione funeraria e il rapporto fra immagine, testo e protezione del defunto"],
  ["cofanetto-funerario", "Cofanetto funerario ligneo", "egitto-antico", "legno", "la funzione del contenitore rituale e la conservazione di immagini e simboli funerari"],
].map(([key, label, culture, material, descriptor]) => ({ key, label, culture, material, descriptor })));
const ARCHAEOLOGY_AUX = Object.freeze({
  cultures: [["preistoria-bolognese", "Preistoria del territorio bolognese"], ["mondo-greco", "Mondo greco e magnogreco"], ["etruria-padana", "Etruria padana e Felsina"], ["egitto-antico", "Egitto antico"]],
  materials: [["pietra", "Pietra e rocce lavorate"], ["argilla", "Argilla e ceramica"], ["bronzo", "Bronzo"], ["legno", "Legno dipinto"]],
});

const MUSEUM_PLANS = Object.freeze([
  { key: "pinacoteca", organizationName: "Pinacoteca Nazionale di Bologna — ArtAround", owner: "autore1", venueName: "Pinacoteca Nazionale di Bologna", venueId: new mongoose.Types.ObjectId(PINACOTECA_VENUE_ID), mapUrl: "/maps/pinacoteca-bologna-demo-v3.svg", mapName: "pinacoteca-bologna-demo-v3.svg", address: "Via delle Belle Arti 56, Bologna", kind: "art", works: PINACOTECA_WORKS, aux: PINACOTECA_AUX,
    visits: [
      { key: "capolavori", title: "Capolavori della Pinacoteca", description: "Dieci tappe per orientarsi tra Carracci, Reni, Domenichino e Guercino.", indexes: [0,1,2,3,4,5,6,7,8,10], depth: .35, complexity: .35, synchronized: false, paid: false },
      { key: "carracci-seicento", title: "Dai Carracci al Seicento", description: "Un percorso di confronto tra riforma carraccesca, classicismo e Barocco emiliano.", indexes: [0,1,2,3,4,5,6,7,8,9,10], depth: .62, complexity: .55, synchronized: false, paid: true },
      { key: "classe", title: "Classe alla Pinacoteca", description: "Visita sincronizzata pensata per una classe, con confronto guidato e quiz finale.", indexes: [0,2,3,4,5,6,7,8,9,11], depth: .45, complexity: .35, synchronized: true, alias: "FENICE ROSSA", paid: false },
    ] },
  { key: "mambo", organizationName: "MAMbo — Museo d'Arte Moderna di Bologna — ArtAround", owner: "autore1", venueName: "MAMbo — Museo d'Arte Moderna di Bologna", venueId: demoId("venue:mambo"), mapUrl: "/maps/mambo-bologna-demo-v3.svg", mapName: "mambo-bologna-demo-v3.svg", address: "Via Don Minzoni 14, Bologna", kind: "art", works: MAMBO_WORKS, aux: MAMBO_AUX,
    visits: [
      { key: "secondo-novecento", title: "Dal secondo Novecento al contemporaneo", description: "Dieci opere per leggere alcuni passaggi chiave della collezione MAMbo.", indexes: [0,1,2,3,4,5,6,7,8,10], depth: .45, complexity: .45, synchronized: false, paid: false },
      { key: "materia-politica", title: "Materia, gesto e politica", description: "Un percorso più analitico tra immagini politiche, Arte Povera e trasformazioni della superficie.", indexes: [0,1,2,4,5,6,7,8,9,10,11], depth: .82, complexity: .8, synchronized: false, paid: true },
    ] },
  { key: "archeologico", organizationName: "Museo Civico Archeologico di Bologna — ArtAround", owner: "autore2", venueName: "Museo Civico Archeologico di Bologna", venueId: demoId("venue:archeologico"), mapUrl: "/maps/archeologico-bologna-demo-v3.svg", mapName: "archeologico-bologna-demo-v3.svg", address: "Via dell'Archiginnasio 2, Bologna", kind: "archaeology", works: ARCHAEOLOGY_ARTIFACTS, aux: ARCHAEOLOGY_AUX,
    visits: [{ key: "laboratorio", title: "Bologna antica: laboratorio di archeologia", description: "Visita sincronizzata tra Preistoria, Etruria, mondo greco ed Egitto con quiz finale.", indexes: [0,1,2,3,4,5,6,7,8,9,10,11], depth: .55, complexity: .45, synchronized: true, alias: "ATENA BLU", paid: false }] },
]);

function namespaceFor(plan) { return plan.kind === "art" ? artNamespaceSnapshot() : archaeologyNamespaceSnapshot(); }
function defsFor(plan) { return plan.kind === "art" ? ART_DEF : ARCHAEOLOGY_DEF; }
function auxiliarySubjects(plan) {
  if (plan.kind === "art") return [
    ...plan.aux.authors.map(([key, label]) => ({ key, label, kind: "author", descriptor: `profilo di ${label}` })),
    ...plan.aux.contexts.map(([key, label]) => ({ key, label, kind: "context", descriptor: `quadro storico e culturale: ${label}` })),
    ...plan.aux.techniques.map(([key, label]) => ({ key, label, kind: "technique", descriptor: `materiali e procedimenti: ${label}` })),
  ];
  return [
    ...plan.aux.cultures.map(([key, label]) => ({ key, label, kind: "culture", descriptor: `contesto archeologico: ${label}` })),
    ...plan.aux.materials.map(([key, label]) => ({ key, label, kind: "material", descriptor: `materiale archeologico: ${label}` })),
  ];
}
function allSubjects(plan) { return [...plan.works.map((entry) => ({ ...entry, kind: plan.kind === "art" ? "work" : "artifact" })), ...auxiliarySubjects(plan)]; }
function subjectClassId(plan, kind) {
  const defs = defsFor(plan);
  return plan.kind === "art" ? { work: defs.work, author: defs.author, context: defs.context, technique: defs.technique }[kind] : { artifact: defs.artifact, culture: defs.culture, material: defs.material }[kind];
}
function textFor(plan, subject, durationIndex, languageIndex) {
  const ns = namespaceFor(plan); const simple = languageIndex === 0; const long = durationIndex === ns.durationTypes.length - 1;
  const intro = simple ? `${subject.label} è uno dei contenuti della raccolta ArtAround dedicata a ${plan.venueName}.` : `${subject.label} è presentato nella raccolta ArtAround di ${plan.venueName} come soggetto editoriale collegato agli altri contenuti attraverso relazioni esplicite.`;
  const focus = subject.descriptor || "gli elementi osservabili e il loro contesto";
  if (durationIndex === 0) return simple ? `${intro} Osserva ${focus}. Poi apri due collegamenti e confronta ciò che cambia.` : `${intro} Il focus è ${focus}. Le relazioni semantiche permettono approfondimenti senza confondere contenuto e logistica.`;
  const middle = simple ? `Parti da ${focus}. Confronta almeno due contenuti collegati e cerca una somiglianza, una differenza e una domanda utile.` : `La lettura parte da ${focus} e distingue osservazione, contesto e interpretazione. Il grafo rende espliciti i passaggi verso gli approfondimenti pertinenti.`;
  if (!long) return `${intro} ${middle} Prima di proseguire, riassumi in una frase quale elemento rende significativo questo soggetto.`;
  return `${intro} ${middle} ${simple ? "Soffermati sui dettagli e distingui ciò che vedi direttamente da ciò che ricavi dal contesto." : "L'approfondimento considera forma, funzione, cronologia e contesto come dimensioni distinte, formulando ipotesi graduate e verificabili."}`;
}

async function ensureRequiredUsers() {
  const passwordHash = await hashPassword(REQUIRED_PASSWORD); const users = {};
  for (const username of REQUIRED_USERNAMES) {
    let user = await User.findOne({ username }).select("+passwordHash");
    if (!user) user = await User.create({ username, passwordHash, status: "active" });
    else { user.passwordHash = passwordHash; user.status = "active"; await user.save(); }
    users[username] = user;
  }
  return users;
}
function idsForPlan(plan) {
  const p = plan.key;
  return { organization: demoId(`org:${p}`), namespace: demoId(`namespace:${p}`), namespaceRevision: demoId(`namespace-revision:${p}`), contentSpace: demoId(`content-space:${p}`), semanticGraph: demoId(`semantic-graph:${p}`), graphRevision: demoId(`graph-revision:${p}`), editorialContext: demoId(`editorial-context:${p}`), editorialRelease: demoId(`editorial-release:${p}`), physicalVocabulary: demoId(`physical-vocabulary:${p}`), physicalVocabularyRevision: demoId(`physical-vocabulary-revision:${p}`), layoutRevision: demoId(`layout-revision:${p}`), venueRelease: demoId(`venue-release:${p}`), venue: plan.venueId };
}
async function cleanupPlan(plan) {
  const ids = idsForPlan(plan); const subjects = allSubjects(plan);
  const subjectIds = subjects.map((entry) => demoId(`subject:${plan.key}:${entry.key}`));
  const itemIds = subjects.map((entry) => demoId(`item:${plan.key}:${entry.key}`));
  const editionIds = subjects.map((entry) => demoId(`edition:${plan.key}:${entry.key}`));
  const revisionIds = subjects.map((entry) => demoId(`item-revision:${plan.key}:${entry.key}`));
  const visitIds = plan.visits.map((entry) => demoId(`visit:${plan.key}:${entry.key}`));
  const visitRevisionIds = plan.visits.map((entry) => demoId(`visit-revision:${plan.key}:${entry.key}`));
  const listingIds = plan.visits.map((entry) => demoId(`listing:${plan.key}:${entry.key}`));
  const offerIds = plan.visits.map((entry) => demoId(`offer:${plan.key}:${entry.key}`));
  await MarketplaceOffer.deleteMany({ _id: { $in: offerIds } }); await MarketplaceListing.deleteMany({ _id: { $in: listingIds } });
  await VisitRevisionV2.deleteMany({ _id: { $in: visitRevisionIds } }); await VisitV2.deleteMany({ _id: { $in: visitIds } });
  await VenueRelease.deleteMany({ _id: ids.venueRelease }); await LayoutRevision.deleteMany({ _id: ids.layoutRevision });
  await ExhibitSlot.deleteMany({ venueId: ids.venue }); await VenueTarget.deleteMany({ venueId: ids.venue }); await Venue.deleteMany({ _id: ids.venue });
  await PhysicalVocabularyRevision.deleteMany({ _id: ids.physicalVocabularyRevision }); await PhysicalVocabulary.deleteMany({ _id: ids.physicalVocabulary });
  await EditorialRelease.deleteMany({ _id: ids.editorialRelease }); await CollectionItemMembership.deleteMany({ editorialContextId: ids.editorialContext });
  await SemanticEdgeV2.deleteMany({ graphRevisionId: ids.graphRevision }); await GraphSubjectBinding.deleteMany({ graphRevisionId: ids.graphRevision }); await SemanticGraphRevision.deleteMany({ _id: ids.graphRevision });
  await EditorialContext.deleteMany({ _id: ids.editorialContext }); await SemanticGraph.deleteMany({ _id: ids.semanticGraph });
  await ContentSpaceItemMembership.deleteMany({ contentSpaceId: ids.contentSpace }); await ContentSpaceSubjectMembership.deleteMany({ contentSpaceId: ids.contentSpace }); await ContentSpace.deleteMany({ _id: ids.contentSpace });
  await ItemRevisionV2.deleteMany({ _id: { $in: revisionIds } }); await ItemEdition.deleteMany({ _id: { $in: editionIds } }); await ItemV2.deleteMany({ _id: { $in: itemIds } });
  await NamespaceRevision.deleteMany({ _id: ids.namespaceRevision }); await Namespace.deleteMany({ _id: ids.namespace }); await Subject.deleteMany({ _id: { $in: subjectIds } });
  await OrganizationAuthorizationEvent.deleteMany({ organizationId: ids.organization }); await OrganizationMembership.deleteMany({ organizationId: ids.organization }); await OrganizationRole.deleteMany({ organizationId: ids.organization }); await Organization.deleteMany({ _id: ids.organization });
}
function graphEdgesFor(plan, ids) {
  const defs = defsFor(plan); const edges = [];
  if (plan.kind === "art") for (const work of plan.works) for (const [target, rel] of [[work.author, defs.relAuthor], [work.context, defs.relContext], [work.technique, defs.relTechnique]]) edges.push({ sourceSubjectId: ids.get(work.key), targetSubjectId: ids.get(target), relationTypeDefinitionId: rel, weight: 1, provenance: { origin: "human" } });
  else for (let i = 0; i < plan.works.length; i += 1) {
    const item = plan.works[i];
    edges.push({ sourceSubjectId: ids.get(item.key), targetSubjectId: ids.get(item.culture), relationTypeDefinitionId: defs.relCulture, weight: 1, provenance: { origin: "human" } });
    edges.push({ sourceSubjectId: ids.get(item.key), targetSubjectId: ids.get(item.material), relationTypeDefinitionId: defs.relMaterial, weight: 1, provenance: { origin: "human" } });
    edges.push({ sourceSubjectId: ids.get(item.key), targetSubjectId: ids.get(plan.works[(i + 1) % plan.works.length].key), relationTypeDefinitionId: defs.relRelated, weight: .75, provenance: { origin: "human" } });
  }
  return edges;
}

async function createNamespaceAndContent(plan, organization, owner) {
  const ids = idsForPlan(plan); const snapshot = namespaceFor(plan);
  assertNoBlocking(`${plan.key}: Namespace`, validateNamespaceRevisionSnapshot(snapshot, { requireCoreScales: true }));
  const namespace = await Namespace.create({ _id: ids.namespace, name: `${plan.venueName} — Regole editoriali`, description: plan.kind === "art" ? "Regole editoriali basate sul modello culturale di base di ArtAround." : "Regole editoriali archeologiche demo con due durate, due livelli e tre relazioni.", ownerType: "organization", ownerId: organization._id, createdBy: owner._id });
  const namespaceRevision = await NamespaceRevision.create({ _id: ids.namespaceRevision, namespaceId: namespace._id, version: 1, ...snapshot, status: "published", integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: owner._id }, review: reviewApproved(owner._id), publication: { publishedAt: FIXED_NOW, publishedBy: owner._id }, createdBy: owner._id, updatedBy: owner._id });
  namespace.publishedRevisionId = namespaceRevision._id; await namespace.save();

  const specs = allSubjects(plan); const subjectIdByKey = new Map(); const subjects = [];
  for (const spec of specs) {
    const subject = await Subject.create({ _id: demoId(`subject:${plan.key}:${spec.key}`), preferredLabel: spec.label, description: spec.descriptor || `${spec.label} — soggetto del dataset demo.`, externalIdentities: [], createdBy: owner._id });
    subjects.push({ spec, subject }); subjectIdByKey.set(spec.key, subject._id);
  }
  const itemRecords = []; const durations = snapshot.durationTypes; const languages = snapshot.languageLevels;
  for (const { spec, subject } of subjects) {
    const item = await ItemV2.create({ _id: demoId(`item:${plan.key}:${spec.key}`), primarySubjectId: subject._id, ownerType: "organization", ownerId: organization._id, provenance: { origin: "human", metadata: { dataset: "TW2026 demo v3", museum: plan.key } }, createdBy: owner._id });
    const edition = await ItemEdition.create({ _id: demoId(`edition:${plan.key}:${spec.key}`), itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
    const variantId = demoId(`variant:${plan.key}:${spec.key}:main`); const representations = [];
    for (let d = 0; d < durations.length; d += 1) for (let l = 0; l < languages.length; l += 1) representations.push({ _id: demoId(`representation:${plan.key}:${spec.key}:${d}:${l}`), durationTypeDefinitionId: durations[d].definitionId, languageLevelDefinitionId: languages[l].definitionId, locale: "it-IT", text: textFor(plan, spec, d, l) });
    let relatedKeys = [];
    if (plan.kind === "art" && spec.kind === "work") relatedKeys = [spec.author, spec.context, spec.technique];
    if (plan.kind === "archaeology" && spec.kind === "artifact") { const index = plan.works.findIndex((entry) => entry.key === spec.key); relatedKeys = [spec.culture, spec.material, plan.works[(index + 1) % plan.works.length].key]; }
    const revision = await ItemRevisionV2.create({ _id: demoId(`item-revision:${plan.key}:${spec.key}`), itemEditionId: edition._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id, label: spec.label, relatedSubjectIds: relatedKeys.map((key) => subjectIdByKey.get(key)).filter(Boolean), tags: [plan.key, spec.kind], authorCredits: ["Dataset dimostrativo ArtAround TW2026"], metadata: { license: "CC BY 4.0 — testo dimostrativo ArtAround" }, selectionSignals: [{ definitionId: plan.kind === "art" ? ART_DEF.signalOverview : ARCHAEOLOGY_DEF.signalOverview, weight: 1 }], presentationVariants: [{ _id: variantId, key: "main", label: "Presentazione adattiva", description: "Matrice completa durata × livello di linguaggio.", semanticFocus: [{ subjectId: subject._id, weight: 1 }], presentationAspects: [], audienceSuitability: { minAgeYears: 8, minMaturity: 0, maxMaturity: 1 }, knowledgeRequirements: [], representations }], defaultPresentation: { variantId, representationId: representations[0]._id }, provenance: { origin: "human", metadata: { dataset: "TW2026 demo v3", museum: plan.key } }, status: "published", integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: owner._id }, review: reviewApproved(owner._id), publication: { publishedAt: FIXED_NOW, publishedBy: owner._id }, createdBy: owner._id, updatedBy: owner._id });
    assertNoBlocking(`${plan.key}: ItemRevision ${spec.key}`, validatePresentationAgainstNamespace(revision, namespaceRevision)); edition.publishedRevisionId = revision._id; await edition.save(); itemRecords.push({ spec, subject, item, edition, revision });
  }
  const contentSpace = await ContentSpace.create({ _id: ids.contentSpace, name: `${plan.venueName} — Spazio contenuti demo`, description: "Inventario editoriale demo usato da collezione, visite e generazione.", ownerType: "organization", ownerId: organization._id, createdBy: owner._id });
  await ContentSpaceItemMembership.create(itemRecords.map(({ item }) => ({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: owner._id })));
  await ContentSpaceSubjectMembership.create(subjects.map(({ subject }) => ({ contentSpaceId: contentSpace._id, subjectId: subject._id, addedBy: owner._id })));
  const graph = await SemanticGraph.create({ _id: ids.semanticGraph, namespaceId: namespace._id, displayName: `${plan.venueName} — Grafo semantico`, description: "Grafo locale della collezione demo.", ownerType: "organization", ownerId: organization._id, createdBy: owner._id });
  const graphRevision = await SemanticGraphRevision.create({ _id: ids.graphRevision, semanticGraphId: graph._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id, createdBy: owner._id }); graph.workingRevisionId = graphRevision._id; graph.workingVersion = 1; await graph.save();
  await GraphSubjectBinding.create(subjects.map(({ spec, subject }) => ({ graphRevisionId: graphRevision._id, subjectId: subject._id, subjectClassDefinitionIds: [subjectClassId(plan, spec.kind)] })));
  await SemanticEdgeV2.create(graphEdgesFor(plan, subjectIdByKey).map((entry) => ({ ...entry, graphRevisionId: graphRevision._id })));
  const editorialContext = await EditorialContext.create({ _id: ids.editorialContext, contentSpaceId: contentSpace._id, namespaceId: namespace._id, semanticGraphId: graph._id, displayName: `${plan.venueName} — Collezione demo`, shortDescription: `Raccolta dimostrativa di ${plan.venueName}.`, description: "Contenuti, soggetti e relazioni pubblicati come snapshot coerente per il Navigator.", createdBy: owner._id });
  await CollectionItemMembership.create(itemRecords.map(({ item }) => ({ editorialContextId: editorialContext._id, itemId: item._id, curationSignals: [{ definitionId: plan.kind === "art" ? ART_DEF.signalOverview : ARCHAEOLOGY_DEF.signalOverview, weight: 1 }], addedBy: owner._id, updatedBy: owner._id })));
  const itemBindings = itemRecords.map(({ item, edition, revision, spec }) => ({ _id: demoId(`editorial-binding:${plan.key}:${spec.key}`), itemId: item._id, itemEditionId: edition._id, itemRevisionId: revision._id, curationSignals: [{ definitionId: plan.kind === "art" ? ART_DEF.signalOverview : ARCHAEOLOGY_DEF.signalOverview, weight: 1 }] }));
  assertNoBlocking(`${plan.key}: EditorialRelease`, await validateEditorialReleaseCoherence({ editorialContextId: editorialContext._id, namespaceRevisionId: namespaceRevision._id, graphRevisionId: graphRevision._id, itemBindings }));
  const editorialRelease = await EditorialRelease.create({ _id: ids.editorialRelease, editorialContextId: editorialContext._id, version: 1, namespaceRevisionId: namespaceRevision._id, graphRevisionId: graphRevision._id, itemBindings, integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: owner._id }, releasedAt: FIXED_NOW, releasedBy: owner._id }); editorialContext.publishedReleaseId = editorialRelease._id; await editorialContext.save();
  return { namespace, namespaceRevision, contentSpace, graph, graphRevision, editorialContext, editorialRelease, itemRecords };
}

async function createVenue(plan, organization, owner, editorial) {
  const ids = idsForPlan(plan);
  const physical = await createDemoPhysicalVocabulary({ physicalVocabularyId: ids.physicalVocabulary, revisionId: ids.physicalVocabularyRevision, organizationId: organization._id, userId: owner._id, name: `${plan.venueName} — Vocabolario fisico`, now: FIXED_NOW });
  const placeTypeId = (key) => physical.placeTypeByKey.get(key).definitionId; const connectionTypeId = (key) => physical.connectionTypeByKey.get(key).definitionId;
  const placeAttrs = (load = "low", quiet = false) => physicalAttributeValues(physical.physicalAttributeByKey, { sensory_load: load, quiet_area: quiet });
  const connectionAttrs = (extra = {}) => physicalAttributeValues(physical.physicalAttributeByKey, { step_free: true, minimum_width_cm: 120, sensory_load: "low", has_steps: false, narrow_passage: false, ...extra });
  const venue = await Venue.create({ _id: ids.venue, name: plan.venueName, description: `${plan.address}. La pianta del seed è una schematizzazione ArtAround dall'alto per la demo e non una planimetria ufficiale.`, ownerOrganizationId: organization._id, primaryEditorialContextId: editorial.editorialContext._id, createdBy: owner._id });
  const workRecords = editorial.itemRecords.filter((record) => plan.works.some((entry) => entry.key === record.spec.key)); const targets = [];
  for (const record of workRecords) targets.push(await VenueTarget.create({ _id: demoId(`venue-target:${plan.key}:${record.spec.key}`), venueId: venue._id, subjectId: record.subject._id, displayLabelOverride: record.spec.label, inventoryNote: `${record.spec.label} — posizione demo`, provenance: { origin: "imported", sourceId: `demo-v3:${plan.key}:${record.spec.key}` }, createdBy: owner._id }));
  const exhibitSlots = await ExhibitSlot.create(plan.works.map((work) => ({ _id: demoId(`exhibit-slot:${plan.key}:${work.key}`), venueId: venue._id, publicCode: `as_${demoId(`slot-code:${plan.key}:${work.key}`).toHexString()}`, createdBy: owner._id })));
  const floorId = demoId(`floor:${plan.key}:ground`); const f = Object.fromEntries(["entrance", "exit", "info", "toilet", "stairs", "elevator"].map((key) => [key, demoId(`place:${plan.key}:${key}`)]));
  const workPlaceIds = plan.works.map((work) => demoId(`place:${plan.key}:${work.key}`)); const positions = [[.15,.18],[.31,.18],[.47,.18],[.63,.18],[.79,.18],[.83,.39],[.68,.48],[.52,.48],[.36,.48],[.20,.48],[.27,.68],[.66,.68]];
  const places = [
    { _id: f.entrance, placeTypeDefinitionId: placeTypeId("entrance"), label: "Ingresso", floorId, position: { x: .06, y: .82 }, attributeValues: placeAttrs() },
    { _id: f.info, placeTypeDefinitionId: placeTypeId("information_point"), label: "Informazioni", floorId, position: { x: .18, y: .82 }, attributeValues: placeAttrs() },
    ...plan.works.map((work, index) => ({ _id: workPlaceIds[index], placeTypeDefinitionId: placeTypeId("room"), label: `Sala ${index + 1} · ${work.label}`, floorId, position: { x: positions[index][0], y: positions[index][1] }, attributeValues: placeAttrs(index % 4 === 0 ? "medium" : "low", index % 3 === 0) })),
    { _id: f.toilet, placeTypeDefinitionId: placeTypeId("toilets"), label: "Servizi igienici", floorId, position: { x: .38, y: .82 }, attributeValues: placeAttrs() },
    { _id: f.elevator, placeTypeDefinitionId: placeTypeId("elevator"), label: "Ascensore", floorId, position: { x: .49, y: .82 }, attributeValues: placeAttrs() },
    { _id: f.stairs, placeTypeDefinitionId: placeTypeId("stairs"), label: "Scale", floorId, position: { x: .60, y: .82 }, attributeValues: placeAttrs() },
    { _id: f.exit, placeTypeDefinitionId: placeTypeId("exit"), label: "Uscita", floorId, position: { x: .92, y: .82 }, attributeValues: placeAttrs() },
  ];
  const routeNodes = [f.entrance, ...workPlaceIds, f.exit]; const connections = [];
  for (let index = 0; index < routeNodes.length - 1; index += 1) connections.push({ _id: demoId(`connection:${plan.key}:main:${index}`), fromPlaceId: routeNodes[index], toPlaceId: routeNodes[index + 1], directionality: "bidirectional", connectionTypeDefinitionId: connectionTypeId("passage"), metricMode: "manual_override", distanceMeters: 10 + (index % 4) * 3, attributeValues: connectionAttrs(), instructions: { forward: "Prosegui verso la sala successiva indicata dalla mappa.", backward: "Ritorna verso la sala precedente." } });
  for (const [key, placeId, type] of [["info", f.info, "passage"], ["toilet", f.toilet, "passage"], ["elevator", f.elevator, "elevator"], ["stairs", f.stairs, "stairs"]]) connections.push({ _id: demoId(`connection:${plan.key}:facility:${key}`), fromPlaceId: f.entrance, toPlaceId: placeId, directionality: "bidirectional", connectionTypeDefinitionId: connectionTypeId(type), metricMode: "manual_override", distanceMeters: 8 + connections.length, attributeValues: type === "stairs" ? connectionAttrs({ step_free: false, has_steps: true }) : connectionAttrs(), instructions: { forward: `Raggiungi ${key} dall'ingresso.`, backward: "Torna all'ingresso." } });
  const layout = await LayoutRevision.create({ _id: ids.layoutRevision, venueId: venue._id, version: 1, authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id, floors: [{ _id: floorId, label: "Piano demo", mapAsset: { url: plan.mapUrl, mimeType: "image/svg+xml", width: 1200, height: 760, originalName: plan.mapName } }], places, exhibitSlots: exhibitSlots.map((slot, index) => ({ exhibitSlotId: slot._id, placeId: workPlaceIds[index], label: `${plan.works[index].label} · slot demo`, order: index, approachGuidance: { defaultInstruction: `Cerca ${plan.works[index].label} nella sala indicata.`, overrides: [] } })), connections, status: "published", createdBy: owner._id, updatedBy: owner._id });
  const release = await VenueRelease.create({ _id: ids.venueRelease, venueId: venue._id, version: 1, layoutRevisionId: layout._id, targetBindings: targets.map((target, index) => ({ venueTargetId: target._id, exhibitSlotId: exhibitSlots[index]._id, availability: "active", recognitionMedia: [] })), preVisitInformation: [`Sede reale: ${plan.address}.`, "La pianta ArtAround inclusa nel seed è una schematizzazione didattica dall'alto, non una planimetria ufficiale."], status: "published", integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: owner._id }, review: reviewApproved(owner._id), publication: { publishedAt: FIXED_NOW, publishedBy: owner._id }, createdBy: owner._id, updatedBy: owner._id });
  venue.publishedReleaseId = release._id; await venue.save(); assertNoBlocking(`${plan.key}: VenueRelease`, await computeVenueReleaseIssues({ venue, release, layout }));
  return { venue, targets, exhibitSlots, layout, venueRelease: release, workRecords };
}
function quizFor(plan) {
  if (plan.key === "pinacoteca") return [
    { question: "Quale elemento aiuta a confrontare opere diverse senza confondere contenuti e percorso fisico?", options: ["Le relazioni tra i soggetti", "Il numero della sala", "Il prezzo del biglietto"], correctOptionIndex: 0, points: 2 },
    { question: "Guido Reni è presentato soprattutto in relazione a quale tendenza?", options: ["Classicismo bolognese del Seicento", "Futurismo", "Arte Povera"], correctOptionIndex: 0, points: 2 },
    { question: "Che cosa conviene distinguere quando si interpreta un'opera?", options: ["Osservazione e contesto", "Solo il titolo", "Solo la posizione nella sala"], correctOptionIndex: 0, points: 2 },
    { question: "Quale famiglia di artisti è centrale all'avvio del percorso?", options: ["Carracci", "Macchiaioli", "Futuristi"], correctOptionIndex: 0, points: 2 },
    { question: "La logistica della visita è modellata come Item?", options: ["No", "Sì", "Solo nelle visite sincronizzate"], correctOptionIndex: 0, points: 2 },
  ];
  return [
    { question: "A che cosa serve la tecnica Levallois?", options: ["A pianificare la scheggiatura della pietra", "A fondere il bronzo", "A dipingere la ceramica"], correctOptionIndex: 0, points: 2 },
    { question: "L'Hydria di Hadra è principalmente un oggetto di quale materiale?", options: ["Argilla", "Bronzo", "Legno"], correctOptionIndex: 0, points: 2 },
    { question: "Felsina è collegata nel percorso a quale contesto?", options: ["Etruria padana", "Egitto antico", "Roma imperiale"], correctOptionIndex: 0, points: 2 },
    { question: "Che cosa collega la relazione “Realizzato in”?", options: ["Reperto e materiale", "Sala e uscita", "Visita e account"], correctOptionIndex: 0, points: 2 },
    { question: "Perché confrontiamo reperti correlati?", options: ["Per riconoscere analogie e differenze tipologiche o culturali", "Per cambiare museo", "Per calcolare il prezzo"], correctOptionIndex: 0, points: 2 },
  ];
}
async function createVisits(plan, organization, owner, editorial, venueData) {
  const records = [];
  for (const definition of plan.visits) {
    const visit = await VisitV2.create({ _id: demoId(`visit:${plan.key}:${definition.key}`), ownerType: "organization", ownerId: organization._id, createdBy: owner._id }); const sourceId = demoId(`visit-source:${plan.key}:${definition.key}`);
    const visitAnchors = definition.indexes.map((workIndex, index) => ({ _id: demoId(`visit-anchor:${plan.key}:${definition.key}:${index}`), venueTargetId: venueData.targets[workIndex]._id }));
    const contentEntries = definition.indexes.map((workIndex, index) => ({ _id: demoId(`visit-entry:${plan.key}:${definition.key}:${index}`), editorialSourceId: sourceId, itemId: venueData.workRecords[workIndex].item._id, itemEditionId: venueData.workRecords[workIndex].edition._id, itemRevisionId: venueData.workRecords[workIndex].revision._id, deliveryAnchorId: visitAnchors[index]._id, role: "core" }));
    const revision = await VisitRevisionV2.create({ _id: demoId(`visit-revision:${plan.key}:${definition.key}`), visitId: visit._id, version: 1, title: definition.title, description: definition.description, editorialSources: [{ _id: sourceId, editorialReleaseId: editorial.editorialRelease._id }], contentEntries, visitAnchors, deliveryMode: definition.synchronized ? "synchronized" : "self_guided", synchronization: definition.synchronized ? { joinAlias: definition.alias } : {}, quiz: definition.synchronized ? { questions: quizFor(plan) } : { questions: [] }, presentationBaseline: { depthPreference: definition.depth, languageComplexityPreference: definition.complexity, locale: "it-IT" }, logistics: { preVisitNotes: [`Percorso nella sede ${plan.venueName}.`], routeHints: [] }, status: "published", integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: owner._id }, review: reviewApproved(owner._id), publication: { publishedAt: FIXED_NOW, publishedBy: owner._id }, createdBy: owner._id, updatedBy: owner._id });
    assertNoBlocking(`${plan.key}: Visit ${definition.key}`, (await computeVisitV2Integrity(revision.toObject())).issues); visit.publishedRevisionId = revision._id; await visit.save();
    const listing = await MarketplaceListing.create({ _id: demoId(`listing:${plan.key}:${definition.key}`), sellerType: "organization", sellerId: organization._id, resourceType: "visit", resourceId: visit._id, title: definition.title, summary: definition.description, catalogMetadata: { demoVenueId: venueData.venue._id, demoDataset: "v3", synchronized: Boolean(definition.synchronized) }, status: "published", createdBy: owner._id, publishedAt: FIXED_NOW });
    const grants = [{ resourceType: "visit", resourceId: visit._id, capability: "visit.execute", versionPolicy: "follow_current" }]; const dependencyIntegrity = await assertSelfContainedOffer({ grants, sellerType: "organization", sellerId: organization._id });
    const offer = await MarketplaceOffer.create({ _id: demoId(`offer:${plan.key}:${definition.key}`), listingId: listing._id, label: definition.paid ? "Accesso demo — offerta simulata" : "Accesso demo gratuito", pricing: definition.paid ? { type: "paid", amountMinor: 490, currency: "EUR" } : { type: "free" }, grants, dependencyIntegrity, status: "active", createdBy: owner._id }); records.push({ definition, visit, revision, listing, offer });
  }
  return records;
}
async function seedMuseum(plan, users) {
  const ids = idsForPlan(plan); const owner = users[plan.owner];
  const organization = await Organization.create({ _id: ids.organization, name: plan.organizationName, description: `Organization dimostrativa associata alla sede reale ${plan.venueName}.`, createdBy: owner._id, owners: [{ userId: owner._id, grantedBy: owner._id, grantedAt: FIXED_NOW }] });
  await ensureStarterRoles({ organizationId: organization._id, actorUserId: owner._id }); await replaceMembershipWithStarterRole({ organizationId: organization._id, userId: owner._id, starterKey: "administrator", actorUserId: owner._id, assignedAt: FIXED_NOW });
  const editorial = await createNamespaceAndContent(plan, organization, owner); const venueData = await createVenue(plan, organization, owner, editorial); const visits = await createVisits(plan, organization, owner, editorial, venueData); return { plan, organization, editorial, venueData, visits };
}
async function seedExamDatasetV3() {
  const users = await ensureRequiredUsers(); for (const plan of MUSEUM_PLANS) await cleanupPlan(plan); const museums = []; for (const plan of MUSEUM_PLANS) museums.push(await seedMuseum(plan, users)); return { users, museums };
}

async function verifyExamDatasetV3() {
  const failures = []; const add = (code, message, context = {}) => failures.push({ code, message, context }); const users = {};
  for (const username of REQUIRED_USERNAMES) {
    const user = await User.findOne({ username, status: "active" }).select("+passwordHash");
    if (!user) { add("REQUIRED_USER_MISSING", `Account mancante: ${username}`); continue; }
    if (!await verifyPassword(REQUIRED_PASSWORD, user.passwordHash)) add("REQUIRED_PASSWORD_MISMATCH", `Password demo non valida per ${username}`); users[username] = user;
  }
  let totalVisits = 0; let synchronizedVisits = 0; let totalTargets = 0; let totalItems = 0;
  for (const plan of MUSEUM_PLANS) {
    const ids = idsForPlan(plan); const organization = await Organization.findById(ids.organization).lean();
    if (!organization) { add("ORGANIZATION_MISSING", `Organization mancante: ${plan.key}`); continue; }
    const expectedOwner = users[plan.owner]; if (!expectedOwner || !organization.owners?.some((entry) => String(entry.userId) === String(expectedOwner._id))) add("ORGANIZATION_OWNER_MISMATCH", `Owner non corretto per ${plan.key}`, { expected: plan.owner });
    const namespaceRevision = await NamespaceRevision.findById(ids.namespaceRevision).lean();
    if (!namespaceRevision) add("NAMESPACE_REVISION_MISSING", `NamespaceRevision mancante: ${plan.key}`);
    else {
      const snapshot = Object.fromEntries(["subjectClasses", "relationTypes", "durationTypes", "languageLevels", "presentationAspects", "selectionSignals"].map((field) => [field, namespaceRevision[field] || []])); const issues = validateNamespaceRevisionSnapshot(snapshot, { requireCoreScales: true });
      if (issues.length) add("NAMESPACE_INVALID", `Namespace non valido: ${plan.key}`, { issues }); const expectedDurations = plan.kind === "art" ? 3 : 2; const expectedLanguages = plan.kind === "art" ? 3 : 2;
      if ((namespaceRevision.durationTypes || []).length !== expectedDurations || (namespaceRevision.languageLevels || []).length !== expectedLanguages || (namespaceRevision.relationTypes || []).length !== 3) add("NAMESPACE_CARDINALITY_MISMATCH", `Cardinalità regole errata: ${plan.key}`);
    }
    const release = await EditorialRelease.findById(ids.editorialRelease).lean(); const revisionIds = release?.itemBindings?.map((entry) => entry.itemRevisionId) || []; const itemRevisions = await ItemRevisionV2.find({ _id: { $in: revisionIds }, status: "published" }).lean(); totalItems += itemRevisions.length; const expectedRepresentations = plan.kind === "art" ? 9 : 4;
    for (const revision of itemRevisions) {
      const reps = (revision.presentationVariants || []).flatMap((variant) => variant.representations || []); const pairs = new Set(reps.map((rep) => `${rep.durationTypeDefinitionId}:${rep.languageLevelDefinitionId}`));
      if (reps.length !== expectedRepresentations || pairs.size !== expectedRepresentations || reps.some((rep) => !String(rep.text || "").trim())) add("INCOMPLETE_PRESENTATION_MATRIX", `Matrice duration×language incompleta: ${plan.key}`, { revisionId: revision._id, count: reps.length, expected: expectedRepresentations });
      if (namespaceRevision) { const issues = validatePresentationAgainstNamespace(revision, namespaceRevision); if (issues.length) add("ITEM_PRESENTATION_INVALID", `Item incompatibile con Namespace: ${plan.key}`, { revisionId: revision._id, issues }); }
    }
    const graphEdges = await SemanticEdgeV2.find({ graphRevisionId: ids.graphRevision }).lean(); const degree = new Map(); for (const edge of graphEdges) for (const sid of [String(edge.sourceSubjectId), String(edge.targetSubjectId)]) degree.set(sid, (degree.get(sid) || 0) + 1);
    const allSubjectIds = allSubjects(plan).map((entry) => String(demoId(`subject:${plan.key}:${entry.key}`))); for (const subjectId of allSubjectIds) if ((degree.get(subjectId) || 0) < 2) add("SUBJECT_LINKS_TOO_FEW", `Subject con meno di due collegamenti: ${plan.key}`, { subjectId, degree: degree.get(subjectId) || 0 });
    const itemSubjectIds = new Set((await ItemV2.find({ _id: { $in: allSubjects(plan).map((entry) => demoId(`item:${plan.key}:${entry.key}`)) } }).select("primarySubjectId").lean()).map((entry) => String(entry.primarySubjectId))); for (const subjectId of allSubjectIds) if (!itemSubjectIds.has(subjectId)) add("SUBJECT_WITHOUT_ITEM", `Subject senza Item: ${plan.key}`, { subjectId });
    const venue = await Venue.findById(ids.venue).lean(); const venueRelease = await VenueRelease.findById(ids.venueRelease).lean(); const layout = await LayoutRevision.findById(ids.layoutRevision).lean();
    if (!venue || !venueRelease || !layout) add("VENUE_DATA_MISSING", `Venue/Layout/Release incompleti: ${plan.key}`); else {
      const activeBindings = (venueRelease.targetBindings || []).filter((entry) => entry.availability === "active"); totalTargets += activeBindings.length;
      if (activeBindings.length !== 12 || (layout.exhibitSlots || []).length !== 12) add("VENUE_TARGET_SLOT_COUNT", `La venue ${plan.key} deve avere 12 target e 12 slot`, { targets: activeBindings.length, slots: layout.exhibitSlots?.length || 0 }); if (!(layout.floors || []).some((floor) => floor.mapAsset?.url)) add("MAP_ASSET_MISSING", `Mappa mancante: ${plan.key}`);
      const issues = await computeVenueReleaseIssues({ venue, release: venueRelease, layout }); if (issues.some((entry) => entry.severity !== "warning")) add("VENUE_RELEASE_INVALID", `VenueRelease non valida: ${plan.key}`, { issues });
    }
    const visitIds = plan.visits.map((entry) => demoId(`visit:${plan.key}:${entry.key}`)); const visits = await VisitV2.find({ _id: { $in: visitIds }, lifecycleStatus: "active" }).lean(); totalVisits += visits.length;
    for (const visit of visits) {
      const revision = await VisitRevisionV2.findById(visit.publishedRevisionId).lean(); if (!revision || revision.status !== "published") { add("VISIT_NOT_PUBLISHED", `Visit non pubblicata: ${plan.key}`, { visitId: visit._id }); continue; }
      if ((revision.contentEntries || []).length < 10 || new Set((revision.contentEntries || []).map((entry) => String(entry.itemId))).size < 10) add("VISIT_TOO_SHORT", `Visit con meno di 10 contenuti: ${plan.key}`, { visitId: visit._id });
      if (revision.deliveryMode === "synchronized") { synchronizedVisits += 1; if (!String(revision.synchronization?.joinAlias || "").trim() || (revision.quiz?.questions || []).length < 3) add("SYNCHRONIZED_VISIT_INCOMPLETE", `Visita sincronizzata incompleta: ${plan.key}`, { visitId: visit._id }); }
      const integrity = await computeVisitV2Integrity(revision); if (integrity.issues.some((entry) => entry.severity !== "warning")) add("VISIT_INVALID", `Visit non coerente: ${plan.key}`, { visitId: visit._id, issues: integrity.issues });
    }
    const listings = await MarketplaceListing.find({ resourceType: "visit", resourceId: { $in: visitIds }, status: "published" }).lean(); const offers = await MarketplaceOffer.find({ listingId: { $in: listings.map((entry) => entry._id) }, status: "active" }).lean(); if (listings.length !== plan.visits.length || offers.length !== plan.visits.length) add("MARKETPLACE_INCOMPLETE", `Marketplace incompleto: ${plan.key}`, { listings: listings.length, offers: offers.length, expected: plan.visits.length });
  }
  const pinacotecaPlan = MUSEUM_PLANS.find((entry) => entry.key === "pinacoteca"); const pinacotecaVisits = await VisitV2.find({ _id: { $in: pinacotecaPlan.visits.map((entry) => demoId(`visit:pinacoteca:${entry.key}`)) }, lifecycleStatus: "active" }).lean();
  if (pinacotecaVisits.length < 3) add("PINACOTECA_THREE_VISITS_REQUIRED", "La Pinacoteca deve avere almeno tre visite demo"); if (totalVisits !== 6) add("TOTAL_VISITS_MISMATCH", "Il dataset deve contenere sei visite demo", { totalVisits }); if (synchronizedVisits !== 2) add("SYNCHRONIZED_VISITS_MISMATCH", "Il dataset deve contenere esattamente due visite sincronizzate", { synchronizedVisits });
  return { ok: failures.length === 0, failures, summary: { requiredUsers: Object.keys(users).length, organizations: MUSEUM_PLANS.length, venues: MUSEUM_PLANS.length, publishedItems: totalItems, activeVenueTargets: totalTargets, publishedVisits: totalVisits, synchronizedVisits } };
}

module.exports = { REQUIRED_USERNAMES, REQUIRED_PASSWORD, PINACOTECA_VENUE_ID, ART_DEF, ARCHAEOLOGY_DEF, MUSEUM_PLANS, artNamespaceSnapshot, archaeologyNamespaceSnapshot, allSubjects, ensureRequiredUsers, seedExamDatasetV3, verifyExamDatasetV3 };
