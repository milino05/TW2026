# Runtime adaptive planning

Il generatore e il planner della parte futura dell'esperienza, non soltanto il generatore iniziale. `VisitRevision` official/community e `GeneratedVisitPlan` restano immutabili; all'avvio vengono materializzati in `VisitSession -> SessionPlanRevision`. Ogni modifica accettata crea una nuova revisione e il prefisso gia eseguito non viene mai riscritto.

## Comandi distinti

- `PRESENTATION_DEPTH_UP/DOWN`: significato di "Dimmi di piu/meno" delle specifiche. Cambia duration della representation mantenendo Item, PresentationVariant e language level; non cambia itinerario.
- `SEMANTIC_DRILLDOWN`: esplora un Item del knowledge graph senza cambiare tappa fisica.
- `REFOCUS_FUTURE`: cambia gli interessi espliciti della coda futura e richiede una PlanChangeProposal.
- `EXTEND_VISIT`: da `route_completed` aggiunge un nuovo tail usando altro tempo indicato dall'utente.

## Stati

`active -> paused -> active`, oppure `active -> route_completed -> active` se l'utente estende la visita, oppure `route_completed -> completed` quando decide di terminare. Le pause non contribuiscono alle stime comportamentali.

## Stop roles

Gli stop editoriali usano `core | recommended | optional`. `core` e preservato nel livello adapt, `recommended` riceve priorita di stabilita, `optional` e il primo candidato a essere rimosso in ritardo o attivato quando rimane tempo. Il precedente booleano `optional` non appartiene al modello.

## Fidelity

- `preserve`: conserva tutte le tappe future della sezione museale corrente come must-see;
- `adapt`: conserva come must-see gli stop core e tratta gli altri come prior di stabilita;
- `regenerate`: massima liberta sul future tail, preservando prefisso eseguito e must-see espliciti.

Official/community usano `preserve` come default; generated usa `adapt`. Nessuna nuova sequenza viene applicata automaticamente: il backend crea una `PlanChangeProposal`, la UI mostra una preview e solo l'accettazione sposta `VisitSession.currentPlanRevisionId`.

## Adattamento parametrico

La richiesta runtime puo aggiornare tempo, movement pace, depth, language complexity, observation emphasis, visit density, discovery, routing requirements, interessi, must-see ed esclusioni. I valori correnti vengono fusi col request snapshot, gli Item gia visitati vengono esclusi e il routing parte dalla posizione corrente.

Per community multi-museo il planner modifica il segmento del museo corrente e mantiene il resto come suffix bloccato: il generatore indoor resta intenzionalmente intra-museo e i trasferimenti inter-venue restano manuali.

Una richiesta puo specificare `remember: true`: soltanto i campi esplicitamente presenti vengono salvati in `UserGenerationPreference` come default dichiarati. Le normali richieste runtime rimangono specifiche della sessione.

## Learning events

Gli eventi sono `presentation_depth_increased`, `presentation_depth_decreased`, `semantic_drilldown`, `visit_refocus_requested`, `visit_extension_requested`, `stop_completed`, `stop_skipped`, `manual_add`, `manual_remove`. Un refocus e fortissimo nella sessione corrente ma diventa storico solo gradualmente tramite learning.

## Roadmap

Restano future: LLM visitor interpreter, LLM semantic-authoring copilot, resolver reale delle semanticRefs (es. Wikidata), e `MuseumLayoutRuntimeState` per chiusure/congestione/indisponibilita temporanee applicato trasversalmente a official, community, generated e Navigator.
