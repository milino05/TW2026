# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali e strutturali **approvate** per le due applicazioni client di ArtAround: Navigator e Marketplace/Editor.

L'obiettivo è costruire correttamente la fascia 18–24 senza introdurre scelte che costringano a riscrivere l'architettura quando verranno affrontate le estensioni 18–27 e 18–33.

## Regola di manutenzione

Questo file è un registro architetturale vivo. Ogni nuova decisione approvata relativa ai due client, ai loro contratti con il backend o alle predisposizioni 18–27/18–33 deve essere aggiunta qui. Le proposte non ancora approvate non vanno presentate come decisioni definitive; possono comparire solo in una sezione esplicitamente marcata come aperta.

## Principi generali approvati

- Un solo repository per il progetto.
- Un solo backend Node/Express condiviso da Navigator e Marketplace/Editor.
- Nessun backend separato per ciascun client.
- Lo scheletro 18–24 deve essere progettato conoscendo già i requisiti 18–27 e 18–33, senza implementare prematuramente quelle estensioni.
- Le estensioni future devono entrare principalmente come nuove capability, nuovi provider, nuove action family o nuovi trasporti, non come riscritture del nucleo del Navigator.
- La generalità del sistema è prioritaria: il frontend non deve hardcodare semantiche specifiche di un museo.
- Non viene considerata un problema architetturale da risolvere la differenza terminologica tra la definizione di Item nelle specifiche e il modello Item attuale del progetto.

## Tecnologie dei due client

### Navigator

Decisioni approvate:

- Vue come framework.
- Vite come build tool.
- TypeScript.
- Vue Router.
- Pinia per lo stato applicativo condiviso.

Pinia deve rimanere principalmente uno state container. La business logic e l'orchestrazione non devono essere concentrate negli store.

### Marketplace/Editor

Decisioni approvate:

- Vanilla JavaScript con ES Modules.
- Web Components per i componenti riutilizzabili.
- Nessun framework UI come Vue, React o Svelte.

Marketplace/Editor deve rimanere tecnologicamente indipendente dal Navigator.

## Codice condiviso

È ammesso un livello shared tra i due client, ma con vincoli rigidi:

- nessuna dipendenza da Vue;
- nessuna dipendenza dai Web Components specifici del Marketplace;
- nessun componente UI condiviso;
- solo codice framework-agnostic, contratti, primitive HTTP, schemi di configurazione e concetti realmente comuni.

I due client non devono essere obbligati ad avere lo stesso modello interno solo perché usano lo stesso backend.

## Organizzazione logica del Navigator

È approvata una separazione concettuale leggera ispirata a domain/application/capabilities/infrastructure/UI, senza imporre una Clean Architecture pesante.

### Domain

Contiene concetti puri del Navigator e non deve dipendere da:

- Vue;
- Pinia;
- fetch;
- WebSocket;
- Speech API;
- QR scanner;
- geolocation;
- LLM.

### Application

Contiene gli use case e l'orchestrazione applicativa.

La UI invia intenzioni all'application layer; l'application layer coordina domain, repository, capability e adapter.

### Capabilities

Descrivono cosa il Navigator sa fare, indipendentemente dalla tecnologia concreta usata per farlo.

Esempi concettuali:

- command/intent resolution;
- visit control;
- location;
- speech output;
- realtime;
- content resolution;
- translation/generation future.

### Infrastructure

Contiene le implementazioni concrete verso il mondo esterno, ad esempio:

- HTTP;
- browser storage;
- Web Speech API;
- camera;
- QR;
- geolocation;
- WebSocket o altro trasporto realtime futuro.

### UI

Views e components devono occuparsi principalmente di rendering e interazione. Non devono contenere direttamente la business logic né dipendere dalla forma grezza delle risposte backend.

## Visit control predisposto per 18–27

È approvato il concetto di una capability di controllo della visita.

Nel 18–24 la modalità è individuale. Nel 18–27 potrà essere introdotta una modalità sincronizzata in cui la disponibilità delle azioni dipende dal ruolo e dal controllo docente.

La UI non deve hardcodare condizioni come `if synchronized student then disable next`; la possibilità concreta di eseguire un'azione deve derivare dalle AvailableAction autorevoli.

## Location predisposta per 18–33

È approvato un modello a provider intercambiabili.

Possibili implementazioni future:

- manual location per 18–24;
- QR location;
- geolocation;
- teleport/demo provider.

I provider producono osservazioni che vengono normalizzate in una posizione logica del dominio. QR, GPS e dati sensore grezzi non devono diventare il modello centrale del Navigator.

## API adapter layer client-side

È approvato un livello di adapter tra application layer e API HTTP.

Schema concettuale:

```text
UI
  -> Application
  -> Port/Repository
  -> API Adapter
  -> HTTP Client
  -> Express API
```

Obiettivi:

- isolare il frontend da cambiamenti tecnici nelle API;
- evitare che components o stores conoscano URL, shape HTTP o DTO backend grezzi;
- permettere al Navigator e al Marketplace di avere projection/modelli interni differenti;
- assorbire cambi di endpoint, nomi campi, paginazione, error format o DTO quando il significato funzionale non cambia.

Questo layer non è un nuovo server intermedio.

## Sistema Action: principio generale

È stata scartata l'idea di un enum globale di canonical commands come `AUTHOR`, `STYLE`, `TOILET`, ecc.

Motivazione: ArtAround è museum-defined. Ogni museo può definire relation types, presentation aspects, place types e vocabolari propri. Una lista semantica globale ridurrebbe la generalità del sistema.

La soluzione approvata usa invece un protocollo generico basato su:

- `ActionDefinition`;
- `AvailableAction`;
- `ActionRequest`;
- `ActionResult`;
- `InteractionEvent`.

## Action families e semantica dinamica

Sono approvate action family strutturali relativamente stabili, con binding e parametri dinamici.

Esempi concettuali:

```text
relation.query
place.navigate
visit.move
presentation.adjust
```

Una nuova relation definita dal museo non richiede una nuova action family.

Esempio:

```text
family = relation.query
relationTypeKey = historical_context
```

oppure:

```text
family = relation.query
relationTypeKey = dominant_color
```

La family descrive il meccanismo; la semantica concreta rimane definita dal museo.

Le nuove classi fondamentali di comportamento, ad esempio future capacità di generazione o traduzione, possono introdurre nuove action family e relativi handler.

Le family devono avere contratti tipizzati. Non è approvato un modello generico `parameters: any` privo di struttura.

## ActionDefinition

`ActionDefinition` descrive una capacità esistente nel dominio.

Può essere derivata da:

- vocabolario del museo;
- relation types;
- place types e layout;
- runtime della visita;
- capability della piattaforma;
- future estensioni.

Le ActionDefinition di dominio sono autorevoli nel backend e non devono necessariamente essere persistite in una collection Mongo dedicata. Possono essere derivate dinamicamente.

Il Navigator non deve dipendere direttamente dalle ActionDefinition complete del backend.

## AvailableAction

`AvailableAction` è la projection client di una capacità concretamente disponibile per un determinato utente nel contesto corrente.

La distinzione approvata è:

```text
ActionDefinition
= la capacità esiste

AvailableAction
= la capacità è disponibile qui e ora
```

La availability può dipendere da:

- utente;
- sessione;
- item/entry corrente;
- presentation corrente;
- posizione;
- modalità di controllo;
- stato sincronizzato futuro;
- dati realmente disponibili nel museo.

Il Navigator riceve principalmente `AvailableAction[]`, non l'intero catalogo teorico delle ActionDefinition.

`AvailableAction[]` deve essere parte del `NavigatorRuntimeState`.

Non va duplicato con un generico blocco `permissions` contenente booleani equivalenti.

## Identità delle azioni

È approvata una doppia identità:

- `definitionKey`: identità semantica relativamente stabile, utile per logging, analytics ed eventi;
- `availableActionId`: identità contestuale dell'azione disponibile nel runtime corrente.

L'`ActionRequest` usa principalmente `availableActionId`.

Il client non deve poter definire arbitrariamente family e binding fidandosi che il backend li esegua. Il backend deve ricostruire/verificare la definizione autorevole, availability, autorizzazione e contesto.

## ActionRequest

È approvato che contenga almeno concettualmente:

- `availableActionId`;
- `expectedRuntimeVersion`;
- eventuali input realmente necessari e non già ricavabili dalla sessione.

Il client deve inviare meno contesto duplicato possibile. Se il backend conosce già user, museum, current entry, current place o current presentation dalla sessione, questi dati non devono essere rimandati inutilmente dal client.

`expectedRuntimeVersion` permette di riconoscere richieste generate su uno stato ormai stale.

## ActionResult

`ActionResult` rappresenta il risultato semantico dell'azione.

È distinto dal `RuntimeUpdate`.

Le diverse family possono avere result tipizzati differenti, ad esempio relation result, navigation result o presentation adjustment result.

Non ogni ActionRequest deve necessariamente incrementare la runtime version: la versione cambia solo quando cambia lo stato runtime autorevole.

## InteractionEvent

Sono stati scartati eventi semanticamente hardcoded come `AUTHOR_REQUESTED` o `STYLE_REQUESTED`.

È approvata la distinzione tra:

- platform events strutturali e relativamente stabili;
- interaction events generici che referenziano l'azione eseguita e i suoi binding dinamici.

Questo deve permettere al futuro pannello docente 18–27 di osservare interazioni di qualsiasi museo senza conoscere in anticipo le sue relations.

## Action, Client Action e UIIntent

Sono approvate tre categorie concettuali:

### Domain Action

Azione applicativa/domain autorevole lato backend.

### Client Action

Azione significativa per l'esperienza ma eseguita localmente sul device quando appropriato.

### UIIntent

Interazione puramente grafica, ad esempio aprire un menu, chiudere una modale o cambiare tab.

Gli UIIntent non devono essere trasformati artificiosamente in ActionDefinition.

## Origine delle ActionDefinition

È approvato un modello ibrido:

- backend autorevole per Domain ActionDefinition;
- Navigator può avere Client ActionDefinition per capability realmente locali;
- l'application layer unifica le azioni disponibili per la UI;
- la UI non deve sapere se una AvailableAction deriva dal backend, dal museo o da una capability locale.

## Action Gateway del Navigator

È approvato un Action Gateway **limitato al runtime delle visit-session**, non un mega-endpoint globale per tutto ArtAround.

Forma concettuale:

```text
POST /api/visit-sessions/:sessionId/actions
```

Il Marketplace continua a utilizzare endpoint specifici per CRUD/editor/amministrazione.

Internamente il gateway deve delegare a dispatcher e handler tipizzati, che riusano i servizi di dominio esistenti. Il gateway non deve diventare un God service contenente la business logic.

Esempio concettuale:

```text
Action Gateway
  -> Action Dispatcher
     -> RelationQueryHandler
     -> PlaceNavigationHandler
     -> PresentationAdjustmentHandler
     -> VisitMoveHandler
```

Questo modello deve consentire in futuro di trasportare gli stessi ActionRequest anche attraverso un canale realtime senza introdurre una seconda semantica applicativa.

## NavigatorRuntimeState

È approvato come projection autonoma, minima e autorevole del runtime del Navigator.

Non è la serializzazione di `VisitSession` e non deve diventare una copia dell'intero dominio backend.

Struttura concettuale approvata:

```text
NavigatorRuntimeState
  runtimeVersion
  session
  control
  plan
  currentEntry
  currentPresentation
  location
  navigation
  availableActions[]
```

### runtimeVersion

Versione dello stato runtime della sessione. È distinta dalla versione del piano, del vocabolario, del layout e delle altre revisioni di dominio.

Serve per:

- applicare aggiornamenti in ordine;
- riconoscere update vecchi;
- riconoscere gap di versione;
- effettuare resync;
- predisporre il realtime 18–27.

### session

Projection minima della sessione, ad esempio identità, status e source type. Non deve includere tutto lo storico di osservazioni, interaction events o dati di learning.

### control

Deve esistere già nel 18–24 con modalità `individual`.

È predisposto per future modalità sincronizzate 18–27. Non deve duplicare le AvailableAction con una lunga lista di `canX`.

### plan

Nel runtime devono stare solo riferimenti e posizione essenziale rispetto al piano, ad esempio revision id/version/current entry index.

Il piano completo rimane separato.

### currentEntry

Rappresenta dove si trova logicamente la sessione nella sequenza. Non deve incorporare l'intero Item.

### currentPresentation

Contiene la presentation effettivamente scelta dal server, compreso il testo necessario al Navigator.

UI e TTS devono usare la stessa fonte `currentPresentation`, evitando divergenze tra testo mostrato e testo pronunciato.

### location

Posizione logica normalizzata, ad esempio `placeId`, source e status.

Dati grezzi GPS, QR o sensore restano fuori dal runtime e appartengono ai provider/device layer.

### availableActions

Parte integrante e versionata del runtime.

## VisitPlanProjection

È approvata come risorsa separata dal runtime.

Il backend possiede già un piano di sessione revisionato; il Navigator deve consumarne una projection specifica invece di incorporare tutto il piano nel RuntimeState.

Concettualmente contiene:

- plan revision id;
- version;
- entries necessarie al Navigator;
- route/timing summary utili.

Se il RuntimeState passa da una plan revision a un'altra, il client invalida/aggiorna la projection del piano.

## Navigation

È approvato che la navigazione sia vero stato runtime persistente minimo e non solo un ActionResult effimero.

Nel `NavigatorRuntimeState` deve stare una projection minima, concettualmente:

```text
navigation
  status
  routeId
  routeVersion
  destinationPlaceId
  currentLegIndex
```

La forma esatta degli status non è ancora fissata.

## NavigationProjection

La route completa deve stare in una risorsa separata, analoga alla `VisitPlanProjection`.

Concettualmente può contenere:

- route id;
- version;
- layout revision id;
- origin;
- destination;
- legs;
- instructions;
- warnings.

Se una route viene ricalcolata mantenendo la stessa destinazione, è approvato mantenere lo stesso `routeId` e incrementare `routeVersion`.

Questo modello deve consentire future location observation via QR/geolocation senza cambiare il consumatore della navigazione.

## Snapshot e RuntimeUpdate

È approvato un modello versionato con:

- snapshot completo per bootstrap/resync;
- `RuntimeUpdate` incrementali durante la visita.

Esempio concettuale:

```text
fromVersion = 21
toVersion = 22
changes = ...
```

Il modello deve poter essere usato sia dalle normali risposte HTTP 18–24 sia dal futuro transport realtime 18–27.

In caso di gap di versione il client deve considerare il runtime non affidabile e richiedere un nuovo snapshot.

## Stato che NON appartiene al NavigatorRuntimeState

Non devono essere inseriti nel runtime solo perché il Navigator li conosce:

- user completo;
- profilo adattivo completo;
- museum completo;
- vocabulary revision completa;
- layout revision completa;
- ItemRevision complete;
- intero SessionPlanRevision;
- storico completo InteractionEvent;
- osservazioni di movimento e learning;
- configurazione grafica completa del museo;
- GPS/QR grezzi;
- stato del microfono;
- stato TTS;
- menu, modali e tab;
- loading/error temporanei;
- cache generiche API.

## Stato locale del client

Stati come listening, transcript, speaking, map expanded, dialog aperti, loading o reconnecting sono client-local e non incrementano la runtime version.

Speech e device state non devono avere store Pinia dedicati finché non emerge una reale necessità di condivisione persistente tra più view.

Composable/capability come `useSpeechInput`, `useSpeechOutput` o provider di localizzazione sono preferibili all'introduzione preventiva di molti store.

## Store Pinia approvati

Sono approvati sei store concettuali principali:

- `authStore`;
- `runtimeStore`;
- `planStore`;
- `navigationStore`;
- `museumStore`;
- `uiStore`.

I nomi esatti possono essere affinati in implementazione, ma la separazione di responsabilità è approvata.

### authStore

Stato dell'utente autenticato e del login.

### runtimeStore

Conserva il `NavigatorRuntimeState` e applica snapshot/update versionati.

Responsabilità concettuali:

- install snapshot;
- apply runtime update;
- invalidate;
- rilevare necessità di resync.

Non contiene la business logic delle Action.

### planStore

Conserva la `VisitPlanProjection` corrente e, se utile, una cache limitata per revision.

### navigationStore

Conserva la `NavigationProjection` corrente e, se utile, una cache limitata per route/version.

### museumStore

Contesto relativamente statico del museo e riferimenti alle risorse necessarie al Navigator. Non deve diventare una copia integrale di Museum + Vocabulary + Layout + Items.

### uiStore

Solo stato grafico condiviso e non autorevole.

## Regola sulle dipendenze tra store

Gli store non devono orchestrarsi reciprocamente in modo nascosto.

Se un RuntimeUpdate cambia plan revision o route version, è l'application layer a coordinare aggiornamento/invalidation di `planStore` o `navigationStore`.

## Esecuzione delle Action nel frontend

L'esecuzione rimane nell'application layer.

Schema approvato:

```text
UI
  -> ExecuteAction use case
  -> Action repository/adapter
  -> backend Action Gateway
  -> ActionResult + RuntimeUpdate
  -> runtimeStore.applyRuntimeUpdate()
```

Pinia conserva e rende reattivo lo stato risultante; non implementa la business logic.

## Predisposizione 18–27

L'architettura deve consentire di aggiungere in seguito:

- modalità di visita sincronizzata;
- ruoli docente/partecipante;
- controllo centralizzato dell'avanzamento;
- monitoraggio delle interazioni;
- quiz;
- transport realtime.

HTTP e realtime devono poter trasportare lo stesso modello di RuntimeUpdate, evitando una seconda architettura parallela.

## Predisposizione 18–33

L'architettura deve consentire di aggiungere in seguito:

- QR location provider;
- geolocation provider;
- eventuale teleport/demo provider;
- LLM intent resolver;
- traduzione;
- generazione di contenuti;
- generazione di visite.

Il futuro LLM deve operare come resolver/selector delle `AvailableAction` offerte dal sistema, non come componente libero di inventare endpoint o operazioni backend.

## Decisioni ancora aperte

Al momento non sono ancora fissati definitivamente:

- albero fisico finale delle directory dei due client;
- schema TypeScript esatto di ActionDefinition, AvailableAction, ActionRequest, ActionResult e RuntimeUpdate;
- forma esatta degli status della navigation;
- forma finale delle projection di museum/layout/vocabulary lato Navigator;
- comportamento UX preciso delle relation query e dei semantic drill-down rispetto a `currentPresentation`;
- routing e flusso utente delle view Vue;
- struttura definitiva delle schermate e dei componenti;
- dettagli del futuro transport realtime;
- schema definitivo di configurazione del Navigator per museo.

Questi punti devono essere progettati e approvati prima di essere registrati come definitivi.
