const FIELD_LABELS = Object.freeze({
  durationTypes: "Durata",
  languageLevels: "Livello di linguaggio",
  subjectClasses: "Tipo di soggetto",
  relationTypes: "Relazione",
  presentationAspects: "Aspetto di presentazione",
  selectionSignals: "Criterio di selezione",
  presentationVariants: "Variante del contenuto",
  representations: "Testo",
  label: "Nome visibile",
  key: "Chiave tecnica",
  definitionId: "Identificatore interno",
  targetSeconds: "Durata in secondi",
  languageLevelDefinitionId: "Livello di linguaggio",
  durationTypeDefinitionId: "Durata",
  locale: "Lingua",
  text: "Testo",
  license: "Licenza",
  name: "Nome",
  description: "Descrizione",
  primarySubjectId: "Soggetto principale",
  relatedSubjectIds: "Soggetti collegati",
  authorCredits: "Autore",
  metadata: "Informazioni aggiuntive",
  semanticRefs: "Collegamenti esterni",
  scheme: "Fonte esterna",
  ownerType: "Tipo di proprietario",
  ownerId: "Proprietario",
  message: "Motivazione",
});

const CODE_MESSAGES = Object.freeze({
  DUPLICATE_KEY: "Usa una chiave tecnica diversa da quelle già presenti.",
  DUPLICATE_DEFINITION_ID: "Questa voce usa lo stesso identificatore interno di un'altra. Rimuovila e aggiungila di nuovo.",
  DUPLICATE_TARGET_SECONDS: "Scegli un numero di secondi diverso da quello delle altre durate.",
  NON_INCREASING_TARGET_SECONDS: "Le durate devono andare dalla più breve alla più lunga.",
  INVALID_NUMBER: "Inserisci un numero intero maggiore di zero.",
  INVALID_UUID: "L'identificatore interno non è valido. Rimuovi questa voce e aggiungila di nuovo.",
  EMPTY_ARRAY: "Aggiungi almeno una voce prima di continuare.",
  EMPTY_REPRESENTATIONS: "Aggiungi almeno un testo completo prima di pubblicare.",
  REQUIRED: "Compila questo campo.",
  INVALID_ENUM: "Scegli uno dei valori disponibili.",
  INVALID_TYPE: "Il valore inserito non è nel formato corretto.",
  UNKNOWN_FIELD: "Questa informazione non è supportata.",
  UNKNOWN_DURATION_TYPE: "La durata scelta non è disponibile nelle regole editoriali selezionate.",
  UNKNOWN_LANGUAGE_LEVEL: "Il livello di linguaggio scelto non è disponibile nelle regole editoriali selezionate.",
  DEFAULT_PRESENTATION_REQUIRED: "Scegli almeno un testo principale.",
  UNKNOWN_DEFAULT_REPRESENTATION: "Il testo principale non è più disponibile. Salva nuovamente il contenuto.",
  INVALID_OBJECT_ID: "Il valore selezionato non è valido o non è più disponibile.",
  INVALID_VALUE: "Il valore inserito non è valido.",
  INVALID_STRING: "Inserisci un testo valido.",
  DUPLICATE_VALUE: "Questo valore è già presente.",
  DUPLICATE_SEMANTIC_REF: "Questo collegamento esterno è già presente.",
  FORBIDDEN_FIELD: "Questa informazione viene calcolata automaticamente e non deve essere inserita.",
  OUT_OF_RANGE: "Il valore è fuori dall'intervallo consentito.",
  UNKNOWN_SUBJECT_CLASS: "Il tipo di soggetto scelto non è disponibile.",
  MONGOOSE_VALIDATION_ERROR: "Il valore inserito non rispetta il formato richiesto.",
  ACTIVE_OFFER_REQUIRED: "Pubblica almeno un'offerta prima di rendere visibile la risorsa nel Catalogo.",
  LISTING_NOT_PUBLISHABLE: "La pubblicazione non può essere completata nello stato corrente.",
});

function sentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function userFacingFieldLabel(field = "") {
  const raw = String(field || "").trim();
  if (!raw) return "";
  const segments = raw.split(".");
  const labels = segments.map((segment) => {
    const match = segment.match(/^([^[]+)\[(\d+)\]$/);
    if (match) return `${FIELD_LABELS[match[1]] || match[1]} ${Number(match[2]) + 1}`;
    return FIELD_LABELS[segment] || segment;
  });
  return labels.join(" · ");
}

export function replaceTechnicalTerms(message = "") {
  return String(message || "")
    .replaceAll("NamespaceRevision", "versione delle regole editoriali")
    .replaceAll("Namespace", "regole editoriali")
    .replaceAll("ItemRevision", "versione del contenuto")
    .replaceAll("ItemEdition", "versione editoriale")
    .replaceAll("Item", "contenuto")
    .replaceAll("PresentationVariant", "variante del contenuto")
    .replaceAll("Representation", "testo")
    .replaceAll("DurationType", "durata")
    .replaceAll("LanguageLevel", "livello di linguaggio")
    .replaceAll("SubjectClassDefinition", "tipo di soggetto")
    .replaceAll("Subject", "soggetto")
    .replaceAll("VenueRelease", "versione della sede")
    .replaceAll("VenueTarget", "oggetto della sede")
    .replaceAll("LayoutRevision", "configurazione degli spazi")
    .replaceAll("Venue", "sede")
    .replaceAll("VisitRevision", "versione della visita")
    .replaceAll("VisitSession", "visita in corso")
    .replaceAll("Visit", "visita")
    .replaceAll("EditorialRelease", "pubblicazione editoriale")
    .replaceAll("EditorialContext", "contesto editoriale")
    .replaceAll("GraphRevision", "versione dei collegamenti")
    .replaceAll("Graph", "collegamenti")
    .replaceAll("MarketplaceOffer", "offerta")
    .replaceAll("MarketplaceListing", "scheda del Catalogo")
    .replaceAll("Listing", "scheda del Catalogo")
    .replaceAll("Entitlement", "autorizzazione")
    .replaceAll("defaultPresentation", "testo principale")
    .replaceAll("definitionId", "identificatore interno")
    .replaceAll("targetSeconds", "durata in secondi")
    .replaceAll("payload", "dati inseriti")
    .replaceAll("Payload", "Dati inseriti")
    .replaceAll("principal", "area di lavoro")
    .replaceAll("ObjectId", "identificatore")
    .replace(/\be (?=obbligator)/gi, "è ")
    .replace(/\bgia\b/gi, "già")
    .replace(/\bworkflow\b/gi, "flusso editoriale")
    .replace(/\breview\b/gi, "revisione")
    .replace(/\bworking\b/gi, "di lavoro")
    .replace(/\brelease-ready\b/gi, "pronta per la pubblicazione")
    .trim();
}

export function userFacingIssueMessage(issue = {}) {
  const field = userFacingFieldLabel(issue.field);
  const message = CODE_MESSAGES[issue.code] || replaceTechnicalTerms(issue.message || "");
  if (!message) return field ? `${field}: controlla il valore inserito.` : "Controlla i dati inseriti.";
  return field ? `${field}: ${sentence(message)}` : sentence(message);
}

export function userFacingErrorMessage(message, { status = null, details = [] } = {}) {
  const issues = [...new Set((Array.isArray(details) ? details : [])
    .filter((issue) => CODE_MESSAGES[issue?.code] || issue?.message || issue?.field)
    .map(userFacingIssueMessage)
    .filter(Boolean))];
  if (issues.length) {
    const summary = String(message || "").includes("Namespace")
      ? "Non è stato possibile salvare le regole editoriali."
      : "Controlla i dati inseriti.";
    const visible = issues.slice(0, 4).join(" ");
    const remaining = issues.length > 4 ? ` Ci sono altri ${issues.length - 4} campi da correggere.` : "";
    return `${summary} ${visible}${remaining}`.trim();
  }
  if (status === 401) return "La sessione è scaduta. Accedi di nuovo per continuare.";
  if (status === 403) return "Non hai i permessi necessari per questa operazione.";
  if (status === 404 && (!message || /^HTTP\s/i.test(message))) return "La risorsa richiesta non è stata trovata.";
  if (status >= 500 && (!message || /^HTTP\s/i.test(message))) return "Si è verificato un problema temporaneo. Riprova tra poco.";
  const friendly = replaceTechnicalTerms(message || "");
  return friendly || "L'operazione non è riuscita. Controlla i dati e riprova.";
}
