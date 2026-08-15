# Knowledge graph semantico e generazione adattiva

## Principi

ArtAround mantiene separati dominio museale, presentazione editoriale, profilo adattivo e pianificazione. Il backend non contiene una tassonomia artistica globale obbligatoria: Item, ItemType, RelationType, PresentationAspect e SelectionSignal sono definiti dal museo; le `semanticRefs` sono mapping opzionali verso identificatori condivisi.

Il progetto non ha dati reali da migrare: il codice supporta direttamente il modello corrente. Non esistono adapter o conversioni runtime per i precedenti `relations[]` embedded, `stops`, `representations[]` diretti o `visit_stop`.

## Grafo semantico persistente: fonte unica di verita

Il knowledge graph non e una proiezione ricostruita da campi embedded. E una struttura persistente graph-first in MongoDB:

```text
Item
= identita stabile del nodo

ItemRevision
= proprieta editoriali/presentazionali revisionate del nodo

SemanticEdge
= topologia persistente e autorevole del grafo
```

`ItemRevision` non contiene `relations`. Ogni arco e un documento `SemanticEdge`:

```text
SemanticEdge
├── museumId
├── sourceItemId
├── sourceItemRevisionId
├── targetItemId
├── relationTypeKey
└── weight
```

Gli outgoing edge appartengono semanticamente alla revisione sorgente. Il pointer stabile dell'Item seleziona quindi contemporaneamente payload del nodo e topologia:

```text
Item.publishedRevisionId = R7
→ ItemRevision R7
→ SemanticEdge con sourceItemRevisionId = R7
```

Quando viene creata una working revision, gli outgoing edge della revisione pubblicata vengono clonati nella nuova revisione e poi modificati direttamente come `semanticEdges`. La pubblicazione cambia il solo pointer `publishedRevisionId`: non esiste un workflow indipendente per ogni arco.

Le relazioni cross-museum dirette restano vietate. L'interoperabilita fra musei passa dalle `semanticRefs` e dal resolver/query layer.

## Relazioni inverse e simmetriche

Nel database viene persistito un solo fatto autorevole. Per esempio:

```text
Primavera --created_by--> Botticelli
```

non viene duplicato come arco inverso. `RelationType` contiene directionality, reverse label/description/user intents, domain/range, strength e semanticRefs. `relationSemantics.service` e l'unico componente che materializza le viste direct/reverse/symmetric.

`SemanticGraphService` usa queste regole per esporre sia outgoing sia incoming. Anche l'API delle relazioni degli Item usa lo stesso servizio: il precedente scanner N+1 delle revisioni e il vecchio `relationView.utils` sono stati eliminati.

## SemanticGraphService

`SemanticGraphService` e il gateway del grafo persistente. Non inventa ne duplica fatti: legge `Item`, la revisione selezionata e `SemanticEdge`, quindi costruisce soltanto indici runtime utili a query e planning:

- nodi per Item;
- adjacency direct/reverse/symmetric;
- incoming/outgoing;
- canonical index dalle semanticRefs;
- neighbors;
- path query multi-hop limitata;
- lookup per RelationType;
- accesso agli edge di una specifica revisione storica.

Il grafo `published` puo essere mantenuto in una cache LRU in memoria, perche un edge set associato a una revisione pubblicata e immutabile. Il grafo `working` non viene cacheato: la revisione di lavoro puo cambiare mantenendo lo stesso pointer e deve essere sempre riletta in modo autorevole.

La cache non e mai fonte di verita. Un miss o un'invalidazione ricostruiscono gli indici direttamente dal grafo persistente.

## Vocabolario semantico revisionato

```text
MuseumVocabularyRevision
├── languageLevels
├── durationTypes
├── itemTypes
├── relationTypes
├── presentationAspects
└── selectionSignals
```

Gli ItemType hanno capability macchina piccole e indipendenti dal dominio:

- `navigation_target`: un'occorrenza dell'Item puo essere una destinazione fisica;
- `spatial_placement`: il tipo puo essere posizionato nel layout;
- `semantic_context`: l'Item puo comparire come contenuto contestuale non fisico.

`navigation_target` richiede `spatial_placement`.

`RelationType` descrive lo schema degli archi; non e un normale Item. Domain e range vengono validati sia durante authoring sia prima della pubblicazione.

## SelectionSignal

`SelectionSignal` rappresenta criteri editoriali generici di selezione, non popolarita appresa. Esempi locali possibili sono `highlight`, `representative`, `rare` o `historical_significance`.

`ItemRevision.selectionSignals` applica il segnale all'Item con un peso 0..1. Richieste come "mostrami le cose piu importanti" sono risolvibili solo se il museo ha espresso un criterio editoriale pertinente; il planner non inventa importanza usando numero di archi o popolarita.

## Semantic references

`semanticRefs` possono essere associate almeno a ItemRevision, ItemType, RelationType, PresentationAspect, SelectionSignal e PlaceType. `matchType` distingue `exact`, `close`, `broader`, `narrower`.

Nel learning cross-museum vengono proiettate automaticamente soltanto equivalenze `exact` e `close` della feature che l'utente ha realmente selezionato o fruito. `broader` e `narrower` possono essere usate per reasoning/matching ma non diventano automaticamente identita di preferenza.

## PresentationVariant

```text
PresentationVariant
├── key
├── semanticFocus
├── presentationAspects
├── audienceSuitability
├── knowledgeRequirements
└── representations
    ├── durationKey
    ├── languageLevelKey
    └── text
```

`semanticFocus` descrive che cosa tratta la variante. `PresentationAspect` descrive come lo racconta. `audienceSuitability` puo esprimere eta/maturita editorialmente rilevanti; `knowledgeRequirements` dichiara il livello di competenza richiesto su feature semantiche.

Dentro una variante, `durationKey + languageLevelKey` e unico. La stessa coppia puo esistere in variant differenti.

## Interest, Knowledge ed Exposure

```text
UserAdaptiveProfile
    movimento / observation / presentation / behavior compatti

UserSemanticAffinity
    cosa interessa all'utente

UserKnowledgeState
    che cosa conosce e con quale confidence

UserContentExposure
    Item + variant + aspetti/focus gia fruiti
```

Interest, competence ed esposizione restano fenomeni indipendenti. Per novelty e learning, le feature relazionali vengono ottenute dal grafo persistente tramite `SemanticGraphService`, non da copie dentro la revisione.

## GenerationRequest

Il planner riceve un contratto strutturato comune alla UI e al futuro interprete LLM:

- `semanticGoals[]`: feature `required`, `preferred` oppure `avoid`;
- `relationGoals[]`: `relationship`, `follow_relation`, `compare`;
- `mustIncludeItemIds` e `mustVisitItemIds`;
- `spatialConstraints[]` per `target|context`;
- `coverageGoal`: `balanced | all | custom`;
- `audience` e `knowledge`;
- `historyMode`: `full | declared_only | current_request_only`;
- tempo, profondita, language complexity, observation, density, discovery, rischio-tempo e routing requirements.

I goal relazionali e la narrative coherence interrogano direttamente il grafo persistente. Goal richiesti non risolvibili producono errore; goal preferiti non risolvibili producono warning.

`current_request_only` ignora storico appreso e default personali dichiarati.

## Itinerario contenutistico e percorso fisico

`contentEntries` e la sequenza narrativa. `physicalRoute` deriva soltanto dalle entry `spatialMode=target`.

```text
Opera A        target
Bedoli         context
Manierismo     context
Opera B        target
```

puo avere un percorso fisico `start -> Opera A -> Opera B`. I context ricevono un `deliveryAnchorId` e non introducono movimento o observation time fisico.

## Ranking e fattibilita

Il ranking e gerarchico:

```text
hard constraints
> copertura dei goal current required
> preferenze correnti
> storico adattivo
> qualita editoriale / novelty / coerenza / logistica
```

Il planner usa beam search + local improvement. Se il beam non trova una soluzione con hard constraints, viene eseguito un feasibility fallback; solo il fallimento di questa ricerca autorizza un conflitto.

`coverageGoal=all` rende tutti gli Item eleggibili must-include e non usa il limite operativo delle 24 entry come falsa semantica di "tutto".

## Learning contestuale

Gli eventi semantici indicano il ramo realmente seguito: `semantic_drilldown`, `semantic_relation_followed`, refocus, add/remove, PresentationAspect e `knowledge_feedback`.

Uno skip non significa automaticamente disinteresse. `not_interested` produce evidenza negativa; `time_pressure`, `accessibility` e `interrupted` non modificano l'interesse; `already_known`, `too_simple` e `too_difficult` alimentano principalmente knowledge.

Le exposure vengono aggiornate dalle content experience realmente concluse, includendo ItemRevision, variant, duration, language level, semantic focus, PresentationAspect e le feature del grafo valide per la revisione fruita.

## Presentation runtime: due assi ortogonali

DurationType e LanguageLevel sono assi indipendenti della stessa Representation:

```text
PRESENTATION_DEPTH_UP/DOWN
→ cambia duration, mantiene variant + language

PRESENTATION_LANGUAGE_UP/DOWN
→ cambia languageLevel, mantiene variant + duration
```

Le richieste di language adaptation aggiornano gradualmente `languageComplexityPreference`; non implicano automaticamente un cambiamento di `UserKnowledgeState`. `too_difficult/too_simple` restano feedback di comprensione distinti.

## GeneratedVisitPlan e runtime

`GeneratedVisitPlan` resta privato e separato dalle Visit official/community. Durante una sessione il future tail puo essere rigenerato con lo stesso GenerationRequest. Il prefisso eseguito resta immutabile e una `PlanChangeProposal` deve essere accettata prima di sostituire il piano runtime.

## Estensioni future approvate

Restano intenzionalmente fuori da questo core:

1. LLM visitor interpreter, upstream allo stesso GenerationRequest della UI;
2. LLM semantic-authoring copilot con proposta, validazione deterministica e approvazione umana;
3. resolver reale delle semanticRefs, per esempio Wikidata;
4. `MuseumLayoutRuntimeState`;
5. generazione cross-museo con routing/tempi inter-venue reali;
6. modalita Sandbox / Explorer;
7. group presentation tracks, locale/lingue complete e altre estensioni rinviate al punto 9.
