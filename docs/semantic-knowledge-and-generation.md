# Knowledge graph semantico e generazione adattiva

## Principi

ArtAround separa quattro livelli:

1. il **knowledge graph locale del museo**, formato da Item generici e relazioni configurabili;
2. la **presentazione editoriale**, che decide quali parti del grafo approfondire e con quale taglio;
3. il **modello adattivo dell'utente**, che conserva preferenze esplicite e segnali appresi con confidence/recency;
4. il **planner deterministico**, che seleziona insieme tappe, presentation variant, representation e percorso.

Nessuna tipologia artistica e codificata nel backend. Un Item puo rappresentare un'opera fisica, una persona, un periodo, un evento, una tecnica o qualunque concetto previsto dal vocabolario locale del museo.

## Vocabolario revisionato

Il vocabolario semantico non viene piu modificato direttamente come configurazione pubblicata del `Museum`.

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

Il workflow e lo stesso degli altri contenuti revisionati:

```text
draft -> in_review -> published
                  -> changes_requested -> draft
```

Operator crea/modifica e richiede review; manager pubblica. Il manager puo pubblicare direttamente il proprio draft integro.

`Museum.config` rimane temporaneamente come formato legacy/bootstrap per database precedenti. Se esiste una `MuseumVocabularyRevision` pubblicata, questa e sempre la fonte autorevole.

### ItemType

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

Capability macchina supportate inizialmente:

- `visit_stop`: il tipo puo essere usato come tappa fisica;
- `spatial_placement`: il tipo puo essere localizzato nel layout;
- `semantic_context`: il tipo puo essere usato come nodo concettuale.

Le capability non stabiliscono che cosa sia un Item: descrivono soltanto cosa il runtime puo farci. Un Item con placement esplicito rimane visitabile durante la migrazione dei vocabolari legacy.

## Semantic references

Una semantic reference collega opzionalmente un concetto locale a un identificatore condiviso:

```json
{
  "scheme": "wikidata",
  "id": "Q...",
  "matchType": "exact"
}
```

`matchType` puo essere `exact`, `close`, `broader` o `narrower`.

Le semantic reference sono supportate almeno su:

- ItemRevision;
- ItemType;
- RelationType;
- PresentationAspect;
- PlaceType.

Non sono necessarie per il funzionamento locale. Servono soprattutto a trasferire significato e affinità fra musei con vocabolari diversi. Non sostituiscono le semantiche operative interne come i canonical routing attributes o i global place intents.

## Item knowledge graph

L'Item stabile conserva identita, museo e itemType. Il contenuto semantico revisionabile vive in `ItemRevision`:

```text
ItemRevision
├── semanticRefs
├── tags
├── relations
└── presentationVariants
```

Le relazioni puntano a Item dello stesso museo e usano RelationType configurati con domain/range, directionality, strength e semanticRefs.

Il knowledge graph e la fonte primaria per rispondere alla domanda **di che cosa parla o a che cosa e collegato un Item**.

## PresentationVariant

La vecchia struttura piatta `representations[]` viene sostituita progressivamente da varianti editoriali:

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

La `key` identifica soltanto la variante locale. Non e una categoria di interesse cross-museum.

### Semantic focus

`semanticFocus` descrive **che cosa** viene approfondito dalla variante. Puo riferirsi a:

- Item;
- ItemType;
- RelationType;
- semantic reference canonica.

Ogni focus ha un peso editoriale 0..1.

### PresentationAspect

I PresentationAspect descrivono **come** viene raccontato il contenuto (per esempio taglio aneddotico, tecnico o comparativo), senza trasformare obbligatoriamente ogni taglio editoriale in un nuovo Item.

Se una curiosita e una vera entita autonoma, con propri contenuti e relazioni, deve invece poter essere modellata come Item. Gli aspect sono quindi complementari, non sostitutivi del knowledge graph.

### Representation

Dentro una variante resta unica la coppia duration/language. La stessa coppia puo comparire in varianti differenti.

Il fallback viene espresso in modo esplicito:

```json
{
  "defaultPresentation": {
    "variantKey": "standard",
    "durationKey": "medium",
    "languageLevelKey": "simple"
  }
}
```

Il vecchio `representations[].isDefault` resta leggibile solo per migrazione/compatibilita.

## Learning degli interessi

`UserAdaptiveProfile` contiene due famiglie di affinità:

```text
semanticAffinities
presentationAspectAffinities
```

Ogni affinità conserva valore, confidence, sample count e ultimo aggiornamento. Il valore effettivo decade nel tempo per evitare che interessi molto vecchi dominino permanentemente il profilo.

Gli eventi di sessione che possono fornire evidenza includono:

- `more_detail`;
- `less_detail`;
- `related_opened`;
- `stop_completed`;
- `stop_skipped`;
- `manual_add`;
- `manual_remove`.

L'evidenza puo propagarsi di un passo nel knowledge graph, pesata da strength del RelationType e weight della relazione. Le semanticRefs di Item, ItemType e RelationType permettono anche di produrre affinità canoniche riutilizzabili in altri musei.

## ExperienceContext

Prima della generazione tutte le sorgenti vengono risolte per dimensione:

```text
hard constraint fisico/integrita
-> richiesta esplicita corrente
-> default dichiarato dall'utente
-> storico appreso con confidence
-> profilo collettivo
-> cold-start fallback
```

Le dimensioni non vengono fuse in un'unica intensita. Sono almeno:

- movement pace;
- content depth;
- language complexity;
- observation emphasis;
- visit density;
- discovery preference;
- time-risk tolerance.

La richiesta esplicita sostituisce lo storico soltanto nella dimensione interessata.

## GenerationRequest

Il planner riceve un oggetto strutturato. La UI manuale e un futuro interprete LLM devono produrre lo stesso formato.

L'LLM non e una dipendenza del planner. In futuro potra trasformare linguaggio naturale in una `GenerationRequestProposal`, che deve essere validata e confermata dall'utente prima di diventare richiesta effettiva.

Sono supportati almeno:

- time budget;
- hard/soft time budget;
- interessi semantici correnti;
- must-see/excluded Item;
- start/end Place;
- preferenze adattive;
- routing requirements.

## GeneratedVisitPlan

Una generazione personale non e una Visit editoriale/community.

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

Ogni tappa congela ItemRevision, PresentationVariant e representation usate nella proposta, oltre alle ragioni principali della scelta.

## Ottimizzazione

La prima implementazione usa **beam search con miglioramento locale dell'ordine**.

L'algoritmo valuta congiuntamente:

- affinità esplicite correnti;
- affinità apprese e recency;
- semanticFocus;
- PresentationAspect;
- profondita/linguaggio desiderati;
- discovery;
- ridondanza/diversita;
- coerenza del knowledge graph;
- observation time previsto;
- logistica adattiva e routing constraints;
- time budget e riserva prudenziale.

Le richieste correnti ricevono peso superiore ai segnali storici. I must-see sono constraint: se non sono compatibili con tempo/layout il backend restituisce un conflitto esplicito invece di eliminarli silenziosamente.

Il costo logistico partecipa sia alla fattibilita temporale sia alla utility. Dopo la beam search viene eseguito un miglioramento locale 2-opt/reversal sull'ordine selezionato, mantenendo invariati Item e representation ma cercando un ordine semanticamente/logisticamente migliore.

## Pause e replanning

`VisitSession` supporta `active`, `paused`, `completed`, `abandoned`. Gli intervalli di pausa sono esclusi dal tempo effettivo di visita e non alimentano movimento, observation time o deviazione temporale.

Il sistema puo calcolare un `ReplanProposal` quando il comportamento reale produce un anticipo/ritardo significativo. Il proposal non modifica mai automaticamente il piano:

```text
compute proposal -> mostra all'utente -> accept/reject
```

Solo l'accettazione crea un nuovo GeneratedVisitPlan e marca il precedente come superseded.

## Semantic authoring copilot (futuro)

L'architettura e predisposta per:

```text
linguaggio naturale
-> LLM
-> SemanticAuthoringProposal
-> validazione deterministica
-> diff/preview
-> conferma umana
-> working revision
```

L'LLM non scrive direttamente nel database, non aggira i ruoli e non deve inventare identificatori Wikidata o di altri provider. Un futuro semantic-reference resolver dovra interrogare il provider reale e mostrare i candidati all'editor.

Ogni operazione proposta dall'LLM deve avere un equivalente nella UI manuale.

## Migrazione

Lo script:

```text
npm run migrate:semantic-model
```

crea in modo idempotente il vocabolario revisionato a partire dal vecchio `Museum.config` e converte le ItemRevision legacy con `representations[]` in una PresentationVariant `standard` con `defaultPresentation`.

La compatibilita di lettura del formato legacy viene mantenuta durante la transizione.

## Estensione futura: runtime layout state

E intenzionalmente fuori da questa implementazione ma resta prevista una struttura separata:

```text
MuseumLayoutRevision + MuseumLayoutRuntimeState
```

per chiusure temporanee, ascensori indisponibili, congestione e altre condizioni operative. Dovra essere consumata trasversalmente da routing, visite official/community, generated plans e comandi Navigator.
