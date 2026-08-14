# Runtime adaptive planning

Il generatore pianifica anche la parte futura di una sessione, non soltanto la visita iniziale. `VisitRevision` official/community e `GeneratedVisitPlan` restano immutabili; all'avvio vengono materializzati in `VisitSession -> SessionPlanRevision`. Ogni modifica accettata crea una nuova revisione e il prefisso gia eseguito non viene riscritto.

## Content entry e physical route

La sequenza primaria e `contentEntries`. Ogni entry ha `role: core|recommended|optional` e `spatialMode: target|context`. Soltanto i target producono anchor fisici e observation time; i context vengono fruiti sull'anchor di delivery appropriato. `physicalRoute` e quindi un derivato navigazionale, non la definizione della visita.

## Comandi distinti

- `PRESENTATION_DEPTH_UP/DOWN`: "Dimmi di piu/meno" sullo stesso Item/PresentationVariant; cambia duration senza cambiare itinerario.
- `SEMANTIC_DRILLDOWN`: esplora un ramo del knowledge graph senza implicare automaticamente una nuova destinazione fisica.
- `REFOCUS_FUTURE`: modifica i `semanticGoals/relationGoals` della coda futura e crea una PlanChangeProposal.
- `EXTEND_VISIT`: da `route_completed` genera un nuovo tail con il tempo aggiuntivo dichiarato.
- `route_only`: rigenera soltanto il percorso fisico mantenendo l'itinerario contenutistico; e il punto di integrazione previsto per il futuro `MuseumLayoutRuntimeState`.

## Stati e pause

`active -> paused -> active`, oppure `active -> route_completed -> active` se l'utente estende la visita, oppure `route_completed -> completed`. Gli intervalli di pausa sono sottratti dal tempo attivo e non vengono interpretati come lentezza, observation o schedule deviation.

## Fidelity

- `preserve`: conserva tutte le content entry future del segmento corrente, incluso il loro `spatialMode`;
- `adapt`: conserva le entry core e il loro ruolo fisico/contestuale, usando le altre come prior di stabilita;
- `regenerate`: massima liberta sulla coda, preservando prefisso eseguito e hard constraints espliciti.

Nessuna proposta ordinaria viene applicata automaticamente. Il flusso e sempre:

```text
compute proposal -> preview -> accept/reject
```

## Parametri runtime

Una richiesta di adattamento puo modificare:

- tempo residuo o tempo aggiuntivo;
- `semanticGoals` e `relationGoals`;
- must-include, must-visit, exclusions e spatial constraints;
- `coverageGoal`;
- `audience` e `knowledge`;
- `historyMode`;
- movement pace, depth, language complexity, observation emphasis, visit density, discovery, time risk;
- routing requirements e start/end.

`remember: true` salva soltanto i campi dichiarati come `UserGenerationPreference`. Le normali richieste restano specifiche della sessione.

## Learning events

Il runtime distingue contenuto, osservazione fisica e movimento:

```text
contentEntryExperiences
physicalTargetObservations
a transitionObservations
interactionEvents
```

Gli eventi semantici principali sono:

- `semantic_drilldown`;
- `semantic_relation_followed`;
- `visit_refocus_requested`;
- `content_entry_completed/skipped`;
- `manual_add/remove`;
- `knowledge_feedback`;
- `presentation_aspect_selected/rejected`;
- depth increase/decrease.

Gli skip hanno una reason contestuale. Solo `not_interested` viene trattato come evidenza negativa forte; tempo, accessibilita e interruzioni non diventano dislike. `already_known`, `too_simple` e `too_difficult` alimentano il modello di conoscenza.

## Learning stores

La sessione aggiorna, se il consenso personale lo consente:

- `UserAdaptiveProfile` per movimento, observation, presentation/behavior compatti;
- `UserSemanticAffinity` per interessi;
- `UserKnowledgeState` per competenza;
- `UserContentExposure` per Item/variant/focus/aspetti gia fruiti.

Il reset personale elimina questi store e la telemetria delle sessioni gia concluse/abbandonate; non modifica una sessione ancora attiva, in pausa o estendibile.

## Multi-museo attuale

Le Visit editoriali possono contenere piu musei, ma un trasferimento inter-venue richiede `estimatedTransferSeconds > 0`: un trasferimento sconosciuto non viene mai trattato come istantaneo. Il generatore automatico resta intenzionalmente intra-museo finche non verra implementato il planner cross-museo.

## Implementazioni future approvate

- generazione cross-museo con stima/routing inter-venue reale;
- modalita Sandbox / Explorer basata sulle stesse sessioni, exposure e affinita;
- LLM visitor interpreter che produce lo stesso GenerationRequest strutturato della UI;
- LLM semantic-authoring copilot;
- resolver reale delle `semanticRefs`, per esempio Wikidata;
- `MuseumLayoutRuntimeState` trasversale a routing, Navigator, official/community/generated/Explorer;
- funzionalita di presentazione di gruppo, locale/lingue e altre estensioni rinviate al punto 9.
