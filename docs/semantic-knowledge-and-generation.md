# Knowledge graph semantico e generazione adattiva

## Principi

ArtAround mantiene separati dominio museale, presentazione editoriale, profilo adattivo e pianificazione. Il backend non contiene una tassonomia artistica globale obbligatoria: Item, ItemType, RelationType, PresentationAspect e SelectionSignal sono definiti dal museo; le `semanticRefs` sono mapping opzionali verso identificatori condivisi.

Il progetto non ha dati reali da migrare: il codice supporta direttamente il modello corrente, senza adapter dei vecchi `stops`, `representations[]` diretti o `visit_stop`.

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

## SelectionSignal

`SelectionSignal` rappresenta criteri editoriali generici di selezione, non popolarita appresa. Esempi locali possibili sono `highlight`, `representative`, `rare` o `historical_significance`.

```json
{
  "key": "highlight",
  "label": "Highlight",
  "semanticRefs": []
}
```

`ItemRevision.selectionSignals` applica il segnale all'Item con un peso 0..1. In questo modo richieste come "mostrami le cose piu importanti" sono risolvibili solo se il museo ha espresso un criterio editoriale pertinente; il planner non inventa importanza usando numero di relazioni o popolarita.

## SemanticGraphService

Il knowledge graph operativo e materializzato da un unico servizio. Partendo dalle relazioni editoriali memorizzate, espone:

- outgoing;
- incoming/reverse;
- relazioni symmetric;
- `RelationType.strength` e peso della singola relazione;
- lookup canonico;
- neighbors;
- path query multi-hop limitata.

Una relazione memorizzata `Opera --created_by--> Artista` e quindi percorribile logicamente anche dalla vista inversa dell'Artista senza duplicare dati editoriali.

## Semantic references

`semanticRefs` possono essere associate almeno a ItemRevision, ItemType, RelationType, PresentationAspect, SelectionSignal e PlaceType. `matchType` distingue `exact`, `close`, `broader`, `narrower`.

Nel learning cross-museum vengono proiettate automaticamente soltanto equivalenze `exact` e `close` della feature che l'utente ha realmente selezionato o fruito. Non si propagano interessi a tutte le relazioni di un Item. `broader` e `narrower` restano informazioni utili al reasoning/matching, ma non diventano automaticamente identita di preferenza.

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

`semanticFocus` descrive che cosa tratta la variante. `PresentationAspect` descrive come lo racconta. `audienceSuitability` puo esprimere limiti di eta/maturita editorialmente rilevanti; `knowledgeRequirements` dichiara il livello di competenza richiesto su feature semantiche. Questi metadati sono opzionali: un museo semplice puo continuare a pubblicare varianti senza annotazione avanzata.

Dentro una variante, `durationKey + languageLevelKey` resta unico. La stessa coppia puo esistere in variant differenti.

## Interest, Knowledge ed Exposure

Non sono lo stesso fenomeno e non vengono piu incorporati in un unico documento adattivo.

```text
UserAdaptiveProfile
    movement / observation / presentation / behavior compatti

UserSemanticAffinity
    cosa interessa all'utente

UserKnowledgeState
    che cosa conosce e con quale confidence

UserContentExposure
    Item + variant + aspetti/focus gia fruiti
```

`UserContentExposure` permette di distinguere un Item nuovo, una nuova variant dello stesso Item, un nuovo taglio semantico/editoriale e una representation gia familiare.

## GenerationRequest

Il planner riceve un contratto strutturato comune alla UI e al futuro interprete LLM.

Elementi principali:

- `semanticGoals[]`: feature `required`, `preferred` oppure `avoid`;
- `relationGoals[]`: `relationship`, `follow_relation`, `compare`;
- `mustIncludeItemIds` e `mustVisitItemIds`;
- `spatialConstraints[]` per preservare `target|context` quando necessario;
- `coverageGoal`: `balanced | all | custom`;
- `audience` e `knowledge`;
- `historyMode`: `full | declared_only | current_request_only`;
- tempo, profondita, linguaggio, observation, density, discovery, rischio-tempo e routing requirements.

`current_request_only` ignora sia storico appreso sia default dichiarati dell'utente; rimangono soltanto richiesta corrente, profili collettivi dove appropriato e fallback algoritmici.

I goal richiesti non risolvibili producono un errore esplicito. I goal preferiti non risolvibili producono warning. Il sistema non finge di avere informazioni che il museo non possiede.

Le stesse preferenze strutturate possono essere gestite senza LLM tramite:

```text
GET    /users/me/generation-preferences
PUT    /users/me/generation-preferences
DELETE /users/me/generation-preferences
```

## Itinerario contenutistico e percorso fisico

`contentEntries` e la sequenza narrativa. `physicalRoute` e derivato soltanto dalle entry `spatialMode=target`.

```text
Opera A        target
Bedoli         context
Manierismo     context
Opera B        target
```

puo avere un percorso fisico `start -> Opera A -> Opera B`. I context ricevono un `deliveryAnchorId` e non introducono movimento o observation time fisico.

## Ranking e fattibilita

Il ranking e gerarchico, non una semplice somma di pesi:

```text
hard constraints
> copertura dei goal current required
> preferenze correnti
> storico adattivo
> qualita editoriale / novelty / coerenza / logistica
```

Uno storico ricco non puo comprare il mancato rispetto della richiesta corrente. Lo scoring appreso e normalizzato per famiglie di feature per evitare di favorire automaticamente Item con piu metadata.

Il planner usa beam search + local improvement per cercare il piano migliore. Se il beam non trova una soluzione con hard constraints, viene eseguito un feasibility fallback sui vincoli obbligatori; solo il fallimento di questa ricerca autorizza il sistema a dichiarare il conflitto non soddisfacibile.

`coverageGoal=all` rimuove il limite semantico delle 24 entry: tutti gli Item eleggibili diventano must-include; se il budget hard non basta, viene restituito un conflitto invece di presentare un sottoinsieme come "tutto".

## Learning contestuale

Gli eventi semantici devono indicare il ramo realmente seguito. In particolare sono supportati `semantic_drilldown`, `semantic_relation_followed`, refocus, add/remove, selection/rejection di PresentationAspect e `knowledge_feedback`.

Uno skip non significa automaticamente disinteresse. `not_interested` produce evidenza negativa; `time_pressure`, `accessibility` e `interrupted` non modificano l'interesse; `already_known`, `too_simple` e `too_difficult` aggiornano principalmente il modello di conoscenza.

Le exposure vengono aggiornate dalle content experience realmente concluse, includendo ItemRevision, variant, duration, language level, semantic focus e PresentationAspect.

## GeneratedVisitPlan e runtime

`GeneratedVisitPlan` e privato e separato dalle Visit official/community:

```text
GeneratedVisitPlan
├── requestSnapshot
├── contextSnapshot
├── contentEntries
├── physicalRoute
├── estimatedTiming
└── explanation
```

Durante una sessione il future tail puo essere rigenerato con lo stesso `GenerationRequest`. Il prefisso eseguito resta immutabile e una `PlanChangeProposal` deve essere accettata esplicitamente prima di sostituire la revisione runtime.

## Estensioni future gia approvate

Restano intenzionalmente fuori da questo core:

1. LLM visitor interpreter, sempre upstream allo stesso GenerationRequest della UI;
2. LLM semantic-authoring copilot con proposta, validazione deterministica e approvazione umana;
3. resolver reale delle semanticRefs, per esempio Wikidata;
4. `MuseumLayoutRuntimeState` per chiusure/congestione/ascensori indisponibili;
5. generazione cross-museo con routing/tempi inter-venue reali;
6. modalita Sandbox / Explorer;
7. funzionalita del punto 9 rinviato: group presentation tracks, locale/lingue complete e altre estensioni AI di presentazione.
