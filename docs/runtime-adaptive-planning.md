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

## Implementazioni future approvate

### Separazione tra itinerario contenutistico e percorso fisico

Il modello runtime deve distinguere esplicitamente la sequenza narrativa/contenutistica della visita dal sottografo delle sole tappe fisicamente localizzate. Item concettuali o non spaziali, per esempio un movimento artistico, una persona, una tecnica o un evento, devono poter comparire adattivamente nell'itinerario della visita senza creare una nuova destinazione di routing. Il percorso fisico deve essere derivato esclusivamente dagli elementi che richiedono movimento e hanno un placement valido. Gli Item non fisici possono essere contestualizzati rispetto alla tappa corrente, a una tappa fisica di riferimento o a un tratto narrativo della visita. Il generatore dovra selezionare congiuntamente contenuti fisici e non fisici in base a richiesta esplicita, profilo adattivo, knowledge graph, tempo e coerenza narrativa.

### Generazione cross-museo

Estendere il planner da intra-museo a cross-museo. La generazione dovra poter selezionare Item e tappe appartenenti a musei differenti, ottimizzare l'ordine fra venue, stimare o acquisire i trasferimenti inter-venue e mantenere separati routing indoor e trasferimento esterno. Il modello deve restare compatibile con official, community, generated e runtime replanning.

### Modalita Sandbox / Explorer

Aggiungere una modalita di visita libera basata su `VisitSession`, senza una `VisitRevision` o un `GeneratedVisitPlan` prefissato come sequenza da seguire. L'utente esplora autonomamente il museo; il Navigator riconosce o riceve l'Item fisico incontrato, ne presenta la representation piu adatta e permette semantic drilldown verso Item collegati anche non fisici. Il sistema puo produrre suggerimenti opzionali e non invasivi su opere, temi o zone coerenti con gli interessi espliciti e appresi. Un suggerimento accettato puo diventare una destinazione fisica temporanea e usare il routing normale, senza trasformare la modalita in una visita obbligata. Gli eventi della sessione devono alimentare lo stesso adaptive learning delle visite strutturate.

### Altre estensioni gia previste

- LLM visitor interpreter per trasformare richieste naturali in request strutturate senza rendere l'LLM dipendenza del planner deterministico.
- LLM semantic-authoring copilot per assistere la costruzione del knowledge graph e delle presentation variants.
- Resolver reale delle `semanticRefs` (per esempio Wikidata) per migliorare interoperabilita e trasferimento semantico cross-museo.
- `MuseumLayoutRuntimeState` per chiusure, congestione, ascensori fuori servizio e indisponibilita temporanee applicato trasversalmente a official, community, generated, Sandbox/Explorer e Navigator.
