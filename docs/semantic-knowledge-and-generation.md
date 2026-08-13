# Knowledge graph semantico e generazione adattiva

## Principi

ArtAround separa quattro livelli:

1. **knowledge graph locale del museo**: Item generici, ItemType e RelationType configurabili;
2. **presentazione editoriale**: PresentationVariant, semanticFocus, PresentationAspect, duration e language;
3. **modello adattivo dell'utente**: preferenze esplicite e segnali appresi con confidence/recency;
4. **planner deterministico**: selezione congiunta di tappe, variant, representation e percorso.

Nessuna tipologia artistica e codificata nel backend. Un Item puo rappresentare un'opera fisica, una persona, un periodo, un evento, una tecnica o qualunque concetto previsto dal vocabolario locale.

## Un solo modello dati

Il progetto non ha dati reali da preservare. Il backend supporta direttamente e soltanto il modello semantico corrente:

- `Museum` non contiene `config` ne `vocabularyRevision`;
- gli ItemType sono direttamente oggetti strutturati;
- `ItemRevision` non contiene un array `representations` diretto;
- non esistono `representations[].isDefault`;
- non esiste uno script di conversione del semantic model.

Gli eventuali database usati nelle prove di sviluppo possono essere ricreati/riseminati.

## Vocabolario revisionato

```text
MuseumVocabulary
├── publishedRevisionId
└── workingRevisionId
    └── MuseumVocabularyRevision
        ├── languageLevels
        ├── durationTypes
        ├── itemTypes
        ├── relationTypes
        └── presentationAspects
```

Quando viene creato un museo viene creato anche un `MuseumVocabulary` con una revisione `draft`. Il draft puo essere inizialmente incompleto ed essere costruito progressivamente da UI o, in futuro, dal semantic-authoring copilot. La validazione completa e obbligatoria solo per check-consistency, review e publication.

Il workflow e:

```text
draft -> in_review -> published
                  -> changes_requested -> draft
```

Operator modifica e richiede review; manager pubblica. Un manager puo pubblicare direttamente il proprio draft integro.

## ItemType

Gli ItemType sono oggetti configurabili:

```json
{
  "key": "artist",
  "label": "Artista",
  "description": "Persona collegata alla produzione delle opere",
  "capabilities": ["semantic_context"],
  "semanticRefs": []
}
```

Capability macchina iniziali:

- `visit_stop`;
- `spatial_placement`;
- `semantic_context`.

Le capability descrivono cio che il runtime puo fare con un tipo; non definiscono il dominio museale.

## Semantic references

Una `semanticRef` collega opzionalmente un concetto locale a un identificatore condiviso:

```json
{
  "scheme": "wikidata",
  "id": "Q...",
  "matchType": "exact"
}
```

`matchType` puo essere `exact`, `close`, `broader`, `narrower`.

Sono supportate almeno su:

- ItemRevision;
- ItemType;
- RelationType;
- PresentationAspect;
- PlaceType.

Non sono necessarie per il funzionamento locale. Migliorano interoperabilita e trasferimento delle affinita fra musei con vocabolari differenti. Non sostituiscono semantiche operative interne come canonical routing attributes e global place intents.

## Item knowledge graph

L'Item stabile conserva identita, museo e itemType. La semantica revisionabile vive in `ItemRevision`:

```text
ItemRevision
├── semanticRefs
├── tags
├── relations
└── presentationVariants
```

Le relazioni puntano a Item dello stesso museo e usano RelationType configurati con domain/range, directionality, strength e semanticRefs.

## PresentationVariant

```text
PresentationVariant
├── key
├── label
├── semanticFocus
├── presentationAspects
└── representations
    ├── durationKey
    ├── languageLevelKey
    └── text
```

La `key` identifica solo la variante editoriale locale e non entra direttamente nel profilo cross-museum.

### semanticFocus

Descrive **che cosa** viene approfondito dalla variante e puo riferirsi a:

- Item;
- ItemType;
- RelationType;
- semanticRef.

### PresentationAspect

Descrive **come** viene raccontato il contenuto: per esempio taglio aneddotico, tecnico, biografico o comparativo. Se una curiosita e una vera entita autonoma con propri contenuti e relazioni, puo invece essere modellata come Item.

### Representation

Dentro una stessa variant la coppia `durationKey + languageLevelKey` e unica. La stessa coppia puo comparire in variant differenti.

Il fallback editoriale e esplicito:

```json
{
  "defaultPresentation": {
    "variantKey": "standard",
    "durationKey": "medium",
    "languageLevelKey": "simple"
  }
}
```

## Learning degli interessi

`UserAdaptiveProfile` distingue:

```text
semanticAffinities
presentationAspectAffinities
```

Ogni affinita conserva valore, confidence, sample count e recency. L'evidenza puo propagarsi di un passo nel knowledge graph pesata da strength del RelationType e weight della relazione. Le semanticRefs di Item, ItemType e RelationType permettono di produrre affinita riutilizzabili cross-museum.

## ExperienceContext

Prima della generazione le fonti vengono risolte per dimensione:

```text
hard constraint
-> richiesta esplicita corrente
-> default dichiarato
-> storico appreso con confidence/recency
-> profilo collettivo
-> cold-start fallback
```

Le dimensioni comprendono almeno movement pace, content depth, language complexity, observation emphasis, visit density, discovery preference e time-risk tolerance.

## GenerationRequest e LLM

Il planner riceve sempre un `GenerationRequest` strutturato. UI manuale e un futuro interprete LLM devono produrre lo stesso formato.

```text
Structured UI --------------------┐
                                 v
                          GenerationRequest
                                 ^
Natural language -> LLM proposal -┘
```

L'LLM non e una dipendenza del planner e non seleziona direttamente il percorso.

## GeneratedVisitPlan

Una generazione personale non e una Visit official/community:

```text
GeneratedVisitPlan
├── requestSnapshot
├── contextSnapshot
├── sourceVocabularyRevisionId
├── sourceLayoutRevisionId
├── stops
├── transitions
├── estimatedTiming
├── utilityScore
└── explanation
```

## Ottimizzazione

La prima implementazione usa beam search + miglioramento locale dell'ordine. Valuta congiuntamente:

- affinita esplicite correnti;
- affinita apprese;
- semanticFocus;
- PresentationAspect;
- profondita e linguaggio;
- discovery/diversita;
- observation time;
- routing e accessibility requirements;
- learned edge delays;
- time budget e margine prudenziale.

I must-see sono constraint: un conflitto viene esposto, non risolto eliminandoli silenziosamente.

## Pause e replanning

`VisitSession` supporta `active`, `paused`, `completed`, `abandoned`. Gli intervalli di pausa sono esclusi dal tempo effettivo e dal learning di movimento/observation/schedule deviation.

Un `ReplanProposal` non modifica mai automaticamente il piano:

```text
compute proposal -> mostra all'utente -> accept/reject
```

## Semantic authoring copilot — futuro

```text
linguaggio naturale
-> LLM
-> SemanticAuthoringProposal
-> validazione deterministica
-> diff/preview
-> conferma umana
-> working revision
```

L'LLM non scrive direttamente nel database, non aggira i ruoli e non inventa identificatori esterni. Un semantic-reference resolver dovra interrogare realmente provider come Wikidata e mostrare i candidati.

Ogni funzione del copilot deve avere un equivalente nella UI manuale.

## Estensioni future gia previste

Restano intenzionalmente separati dal core attuale:

1. interprete LLM lato visitatore e semantic-authoring copilot;
2. semantic-reference resolver reale, ad esempio Wikidata;
3. `MuseumLayoutRuntimeState` per chiusure temporanee, ascensori indisponibili, congestione e altre condizioni operative, consumato trasversalmente da routing, Visit official/community, GeneratedVisitPlan e Navigator.
