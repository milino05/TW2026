# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali e strutturali **approvate** per le due applicazioni client di ArtAround: Navigator e Marketplace/Editor.

L'obiettivo è completare correttamente la fascia 18–24 predisponendo il sistema per 18–27 e 18–33 senza implementare prematuramente le estensioni e senza introdurre scelte che richiedano una riscrittura futura.

## Regola di manutenzione

Questo file è un registro architetturale vivo. Ogni nuova decisione approvata relativa ai due client, ai loro contratti con il backend o alle predisposizioni 18–27/18–33 deve essere aggiunta qui.

Le proposte non ancora approvate non devono essere presentate come decisioni definitive. Possono comparire soltanto in una sezione esplicitamente indicata come aperta.

## Principio fondamentale: integrazione con il backend

Ogni nuova soluzione frontend o decisione architetturale deve essere verificata rispetto al **backend reale già presente nel repository** prima di essere approvata.

Sono vincolanti i seguenti principi:

- una proposta frontend deve integrarsi con i modelli, servizi, revisioni, autorizzazioni e workflow già implementati nel backend;
- quando il backend offre già una capacità utile, il client deve sfruttarla invece di duplicarne la logica;
- il progetto deve sfruttare pienamente i servizi backend rilevanti disponibili, evitando implementazioni parallele lato client;
- la business logic autorevole deve rimanere nel backend quando appartiene al dominio ArtAround;
- se l'architettura frontend ideale mette in evidenza un limite reale del backend, va valutata esplicitamente una modifica del backend;
- se una modifica backend produce una soluzione complessivamente più semplice, coerente, riutilizzabile o predisposta alle estensioni future, deve essere proposta invece di introdurre workaround nel frontend;
- ogni nuova progettazione deve quindi includere una verifica di compatibilità backend e, quando necessario, l'indicazione dei cambiamenti backend richiesti.

Questo principio vale sia per Navigator sia per Marketplace/Editor.

## Principi generali approvati

- Un solo repository per il progetto.
- Un solo backend Node/Express condiviso da Navigator e Marketplace/Editor.
- Nessun backend separato per ciascun client.
- Lo scheletro 18–24 deve essere progettato conoscendo già i requisiti 18–27 e 18–33, senza implementarli prematuramente.
- Le estensioni future devono entrare principalmente come nuove capability, provider, action family o trasporti, non come riscritture del nucleo del Navigator.
- La generalità di ArtAround è prioritaria: il frontend non deve hardcodare semantiche specifiche di un museo.
- Non viene trattata come problema architetturale da risolvere la differenza terminologica tra la definizione di Item nelle specifiche e il modello Item attuale del progetto.

# Tecnologie dei due client

## Navigator

Decisioni approvate:

- Vue;
- Vite;
- TypeScript;
- Vue Router;
- Pinia per lo stato applicativo condiviso.

Pinia deve rimanere principalmente uno state container. La business logic e l'orchestrazione non devono essere concentrate negli store.

## Marketplace/Editor

Decisioni approvate:

- Vanilla JavaScript con ES Modules;
- Web Components per componenti riutilizzabili;
- nessun framework UI come Vue, React o Svelte.

Marketplace/Editor deve rimanere tecnologicamente indipendente dal Navigator.

# Codice condiviso

È ammesso un livello `shared/` tra i due client con vincoli rigidi:

- nessuna dipendenza da Vue;
- nessuna dipendenza dai Web Components specifici del Marketplace;
- nessun componente UI condiviso;
- solo codice framework-agnostic, contratti, primitive HTTP, schemi di configurazione e concetti realmente comuni.

I due client non devono essere obbligati ad avere lo stesso modello interno soltanto perché utilizzano lo stesso backend.

Quando opportuno il backend DTO può essere adattato separatamente:

```text
backend DTO
  -> Navigator adapter -> Navigator model
  -> Marketplace adapter -> Marketplace model
```

# Organizzazione logica del Navigator

È approvata una separazione concettuale leggera ispirata a `domain / application / capabilities / infrastructure / UI`, senza imporre una Clean Architecture pesante.

## Domain

Contiene concetti puri del Navigator e non deve dipendere da Vue, Pinia, fetch, WebSocket, Web Speech API, QR scanner, geolocation o LLM.

## Application

Contiene use case e orchestrazione applicativa.

La UI esprime intenzioni all'application layer; l'application layer coordina domain, repository, capability, adapter e aggiornamento degli store.

## Capabilities

Descrivono cosa il Navigator sa fare indipendentemente dalla tecnologia concreta.

Esempi concettuali:

- command/intent resolution;
- visit control;
- location;
- speech output;
- realtime;
- content resolution;
- translation/generation future.

## Infrastructure

Contiene implementazioni concrete verso il mondo esterno, ad esempio HTTP, browser storage, Web Speech API, camera, QR, geolocation e futuro trasporto realtime.

## UI

Views e components devono occuparsi principalmente di rendering e interazione. Non devono contenere business logic di dominio né dipendere direttamente dalla forma grezza delle risposte backend.

# API adapter layer client-side

È approvato un livello di adapter tra application layer e API HTTP:

```text
UI
  -> Application
  -> Port / Repository
  -> API Adapter
  -> HTTP Client
  -> Express API
```

Obiettivi:

- isolare il frontend dai cambiamenti tecnici nelle API;
- evitare che components e stores conoscano URL, shape HTTP e DTO grezzi;
- permettere ai due client di avere projection differenti;
- assorbire cambi di endpoint, nomi campo, paginazione, error format o DTO quando il significato funzionale rimane invariato.

Questo layer è client-side e non introduce un nuovo server intermedio.

Non deve esistere un unico gigantesco `ApiService` chiamato direttamente dalle view. Sono preferibili repository/port specifici per responsabilità.

# Sistema Action

## Principio generale

È scartata l'idea di un enum globale di canonical commands come `AUTHOR`, `STYLE`, `TOILET`, ecc.

ArtAround è museum-defined: relation types, presentation aspects, place types e vocabolari possono essere definiti dal singolo museo.

Il protocollo approvato è basato su:

```text
ActionDefinition
  -> AvailableAction
  -> ActionRequest
  -> ActionResult
  -> InteractionEvent
```

## Action families

Le action family descrivono meccanismi strutturali relativamente stabili, mentre la semantica concreta rimane dinamica.

Esempi concettuali:

```text
relation.query
place.navigate
visit.move
presentation.adjust
```

Esempio di binding dinamico:

```text
family = relation.query
relationTypeKey = historical_context
```

Una nuova relation museum-defined non richiede nuovo codice nel Navigator. Una nuova classe fondamentale di comportamento ArtAround può invece introdurre una nuova family e il relativo handler.

Le family devono avere contratti tipizzati. Non è approvato un modello indiscriminato `parameters: any`.

## ActionDefinition

`ActionDefinition` descrive una capacità esistente nel dominio.

Può essere derivata da vocabolario, relation types, place types/layout, runtime della visita, capability della piattaforma e future estensioni.

Le Domain ActionDefinition sono autorevoli nel backend e non devono necessariamente essere persistite in una collection Mongo dedicata: possono essere derivate dinamicamente dai dati già autorevoli.

## AvailableAction

`AvailableAction` è la projection client di una capacità concretamente disponibile per un determinato utente nel contesto corrente.

```text
ActionDefinition
= la capacità esiste

AvailableAction
= la capacità è disponibile qui e ora
```

La availability può dipendere da utente, sessione, entry corrente, presentation, posizione, modalità di controllo, dati del museo e future condizioni sincronizzate.

Il Navigator riceve principalmente `AvailableAction[]`, non il catalogo completo delle ActionDefinition.

`AvailableAction[]` è parte integrante e versionata del `NavigatorRuntimeState`.

Non deve essere duplicata da un generico blocco `permissions` con booleani equivalenti.

## Identità delle azioni

È approvata una doppia identità:

- `definitionKey`: identità semantica relativamente stabile, utile per logging, analytics ed eventi;
- `availableActionId`: identità contestuale dell'azione disponibile nel runtime corrente.

L'`ActionRequest` usa principalmente `availableActionId`.

Il backend non si fida della semantica rimandata dal client: deve ricostruire o verificare definizione autorevole, availability, autorizzazione e contesto.

## ActionRequest

Contiene concettualmente almeno:

- `availableActionId`;
- `expectedRuntimeVersion`;
- eventuali input realmente necessari e non già ricavabili dalla sessione.

Il client deve inviare meno contesto duplicato possibile. Se user, museum, entry, posizione o presentation sono già noti al backend tramite sessione, non devono essere rimandati inutilmente.

`expectedRuntimeVersion` consente al backend di riconoscere richieste generate su uno stato stale.

## ActionResult e RuntimeUpdate

`ActionResult` rappresenta il risultato semantico dell'azione ed è distinto dal `RuntimeUpdate`.

Le family possono avere result tipizzati differenti.

La runtime version cambia soltanto quando cambia lo stato runtime autorevole; non ogni ActionRequest deve necessariamente incrementarla.

## InteractionEvent

Sono scartati eventi semanticamente hardcoded come `AUTHOR_REQUESTED` o `STYLE_REQUESTED`.

È approvata la distinzione fra:

- platform events strutturali e relativamente stabili;
- interaction events generici che referenziano azione e binding dinamici.

Questo deve consentire al futuro monitoraggio docente di osservare qualsiasi museo senza conoscerne in anticipo l'ontologia.

## Domain Action, Client Action e UIIntent

Sono approvate tre categorie:

- **Domain Action**: azione applicativa/domain autorevole lato backend;
- **Client Action**: azione significativa per l'esperienza ma realmente locale al dispositivo quando appropriato;
- **UIIntent**: comportamento puramente grafico come aprire un pannello, chiudere una modale o cambiare tab.

Gli UIIntent non devono essere trasformati artificiosamente in ActionDefinition.

## Origine delle ActionDefinition

È approvato un modello ibrido:

- backend autorevole per Domain ActionDefinition;
- Navigator può possedere Client ActionDefinition per capability realmente locali;
- l'application layer unifica le azioni disponibili per la UI;
- la UI non deve conoscere l'origine concreta di ogni AvailableAction.

# Action Gateway del Navigator

È approvato un Action Gateway limitato al runtime delle `visit-session`, non un mega-endpoint globale per ArtAround.

Forma concettuale:

```text
POST /api/visit-sessions/:sessionId/actions
```

Il Marketplace/Editor continua a utilizzare endpoint specifici per CRUD, editing e amministrazione.

Internamente il gateway delega a dispatcher e handler tipizzati che **riusano i servizi di dominio backend esistenti**.

```text
Action Gateway
  -> Action Dispatcher
     -> RelationQueryHandler
     -> PlaceNavigationHandler
     -> PresentationAdjustmentHandler
     -> VisitMoveHandler
     -> ...
```

Il gateway non deve diventare un God service e non deve duplicare la business logic già presente nei servizi backend.

Gli endpoint runtime specifici esistenti possono essere utilizzati durante una migrazione, ma l'architettura finale approvata prevede il gateway come interfaccia uniforme del runtime quando questo porta vantaggio e gli handler come ponte verso i servizi esistenti.

Questo modello deve permettere in futuro di trasportare gli stessi ActionRequest anche via realtime senza introdurre una seconda semantica applicativa.

# Pausa e resume

La pausa rimane un **vero stato persistente di dominio della VisitSession**, non uno stato puramente grafico.

Il backend già mantiene semanticamente:

```text
active -> paused -> active
```

insieme agli intervalli di pausa e al calcolo del tempo attivo della visita.

La progettazione frontend deve valorizzare questo modello, non sostituirlo.

Pause/resume devono quindi essere trattati come Domain Action strutturali del runtime e, nell'architettura Action finale, i relativi handler devono riusare i servizi backend di pausa e resume esistenti.

La decisione di non creare `/sessions/:id/paused` riguarda esclusivamente Vue Router e non elimina né modifica il significato delle API/backend operations di pausa e resume.

# NavigatorRuntimeState

È approvato come projection autonoma, minima e autorevole del runtime del Navigator.

Non è la serializzazione di `VisitSession` e non deve diventare una copia completa del dominio backend.

Struttura concettuale:

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

## runtimeVersion

È distinta dalle versioni di piano, vocabolario, layout e altre revisioni.

Serve per ordinamento update, rilevazione di update vecchi, rilevazione di gap, resync e futura sincronizzazione realtime.

## session

Projection minima, ad esempio identità, status e source type. Non include tutto lo storico di observation, interaction events o learning.

## control

Esiste già concettualmente nel 18–24 con modalità `individual` ed è predisposto per il futuro controllo sincronizzato 18–27.

Non deve duplicare le AvailableAction con liste di `canX`.

## plan

Nel runtime rimangono solo riferimenti e posizione essenziale rispetto al piano, ad esempio revision id, version e current entry index.

## currentEntry

Rappresenta dove si trova logicamente la sessione nella sequenza e non incorpora l'intero Item.

## currentPresentation

Contiene la presentation effettivamente scelta dal server, compreso il testo necessario al Navigator.

UI e TTS usano la stessa `currentPresentation` per evitare divergenze tra testo mostrato e pronunciato.

## location

Posizione logica normalizzata, ad esempio `placeId`, source e status.

Dati grezzi GPS, QR o sensori rimangono fuori dal runtime e appartengono ai provider/device layer.

L'osservazione può nascere sul client, ma la posizione logica accettata è parte dello stato autorevole del runtime/backend.

## availableActions

Sono parte integrante e versionata del runtime.

# VisitPlanProjection

Il piano completo rimane separato dal RuntimeState.

`VisitPlanProjection` rappresenta ciò che il Navigator necessita della revisione corrente del piano, ad esempio:

- plan revision id;
- version;
- entries necessarie al Navigator;
- route/timing summary utili.

Se il RuntimeState passa a una nuova plan revision, il client invalida o aggiorna la projection del piano.

# Navigation

La navigazione è approvata come vero stato runtime persistente minimo, non soltanto come ActionResult effimero.

Nel `NavigatorRuntimeState` rimane una projection minima:

```text
navigation
  status
  routeId
  routeVersion
  destinationPlaceId
  currentLegIndex
```

La route completa rimane separata.

## NavigationProjection

Può contenere concettualmente:

- route id;
- version;
- layout revision id;
- origin;
- destination;
- legs;
- instructions;
- warnings.

Se una route viene ricalcolata mantenendo la stessa destinazione, è approvato mantenere lo stesso `routeId` incrementando `routeVersion`.

Il modello deve consentire a futuri LocationProvider QR/geolocation di aggiornare progressivamente posizione e navigazione senza cambiare il contratto consumato dalla UI.

# Stato Pinia

Sono approvati sei store concettuali principali:

- `authStore`;
- `runtimeStore`;
- `planStore`;
- `navigationStore`;
- `museumStore`;
- `uiStore`.

Non si creano preventivamente store separati per speech, TTS, camera, GPS o altre capability device. Si parte da composable/capability locali e si promuove lo stato a store soltanto quando esiste un reale bisogno di condivisione/persistenza client.

## runtimeStore

Mantiene il `NavigatorRuntimeState` e sa installare snapshot e applicare `RuntimeUpdate` versionati.

Deve rilevare gap o incoerenze di versione e segnalare la necessità di resync.

Non implementa la business logic delle Action.

## planStore

Mantiene la `VisitPlanProjection` corrente ed eventualmente una piccola cache per revisione.

## navigationStore

Mantiene la `NavigationProjection` corrente, separata dallo stato minimo di navigazione contenuto nel runtime.

## museumStore

Rappresenta il contesto relativamente statico necessario al Navigator senza diventare una copia indiscriminata di Museum, Vocabulary, Layout e Items completi.

## uiStore

Contiene esclusivamente stato grafico condiviso e non autorevole, ad esempio pannelli/modalità visuali.

Non deve duplicare current entry, current presentation, location o AvailableAction.

## Orchestrazione degli store

Gli store non devono orchestrarsi direttamente fra loro in modo nascosto.

L'orchestrazione passa dall'application layer.

```text
UI
  -> use case/application service
  -> repository/capability
  -> backend
  -> result/runtime update
  -> store
```

Pinia conserva e rende reattivo lo stato; non implementa la business logic.

# Routing del Navigator

È approvato il modello **routing per lifecycle + VisitShellView per il runtime attivo**.

Regola generale:

> Una route rappresenta un cambio di lifecycle, identità primaria o workflow dell'utente; non ogni variazione visiva o capability della stessa visita.

## Identità Visit vs VisitSession

Sono concetti e route distinte:

```text
/visits/:visitId
```

rappresenta la visita prima dell'esecuzione, mentre:

```text
/sessions/:sessionId
```

rappresenta la sessione runtime concreta dell'utente.

Durante la visita l'identità primaria è la `VisitSession`, non la Visit astratta.

## VisitShellView

`/sessions/:sessionId` è la shell del runtime attivo.

Mappa, presentation, navigation UI, speech, AvailableAction, pausa e variazioni della presentation non diventano route separate. Sono aspetti dello stesso runtime o UI state interno alla VisitShell.

La VisitShell è un composition root UI, non un componente monolitico. Deve essere composta da regioni/componenti specializzati.

## Pausa

La pausa non crea una route Vue `/paused`.

La URL rimane:

```text
/sessions/:sessionId
```

mentre `NavigatorRuntimeState.session.status` passa da `active` a `paused` e la UI reagisce allo stato autorevole ricevuto dal backend.

Questo evita di duplicare lo stesso stato in URL e runtime e si integra con il modello persistente di pausa già presente nel backend.

## Summary

La conclusione definitiva della visita rappresenta invece un cambio di lifecycle e può utilizzare:

```text
/sessions/:sessionId/summary
```

`route_completed` non implica automaticamente una route separata; può rimanere uno stato della VisitShell finché la sessione non è realmente completata.

## Preparazione visita

Una eventuale route:

```text
/visits/:visitId/start
```

non è approvata automaticamente. Verrà introdotta soltanto se la futura progettazione UX dimostrerà l'esistenza di una fase di preparazione realmente distinta dal dettaglio visita.

## Catalogo mobile

Il catalogo/marketplace visibile nel Navigator è una UI Vue propria, ottimizzata per smartphone e selezione/acquisto/esecuzione delle visite.

Non riusa il client Marketplace/Editor desktop, pur utilizzando gli stessi servizi backend rilevanti.

## Bootstrap e resume

Il bootstrap di `/sessions/:sessionId` passa da un application use case concettuale come `ResumeVisitSession`, non da business logic o `fetch()` inseriti nei router guard.

Lo use case recupera il runtime snapshot e coordina le projection necessarie tramite repository/adapters.

Un refresh della pagina deve poter ricostruire l'esperienza dal backend autorevole usando il `sessionId`.

Se la sessione è già completata, l'applicazione può normalizzare la navigazione verso la summary.

## Predisposizione 18–27

Il normale participant/student runtime continua a usare `/sessions/:sessionId`; la modalità sincronizzata deriva dal runtime (`control` e AvailableAction), non da una nuova variante della route.

Nuovi workflow realmente distinti possono aggiungere in futuro route dedicate, ad esempio join o teacher control.

## Predisposizione 18–33

LLM, QR, geolocation e translation/generation non ottengono automaticamente nuove route. Sono capability/provider che operano dentro il runtime esistente.

# Realtime futuro

HTTP e futuro realtime devono trasportare lo stesso modello applicativo di `RuntimeUpdate`.

Il `runtimeStore` non deve avere una semantica diversa a seconda che l'update provenga da risposta HTTP o trasporto realtime.

Questo permette al 18–27 di aggiungere sincronizzazione senza introdurre una seconda architettura dello stato.

# Decisioni volutamente ancora aperte

Non sono ancora fissati in modo definitivo:

- schema TypeScript finale di `ActionDefinition`, `AvailableAction`, `ActionRequest`, `ActionResult` e `InteractionEvent`;
- nomi definitivi di tutte le action family strutturali;
- forma esatta degli status della navigation;
- comportamento UX preciso delle relation query rispetto a `currentPresentation`;
- eventuale presenza della route `/visits/:visitId/start`;
- struttura finale delle schermate e dei componenti Vue;
- routing e flussi dettagliati del Marketplace/Editor;
- forma esatta dei DTO/API introdotti dall'Action Gateway e dal NavigatorRuntimeState.

Questi punti devono essere progettati e approvati prima dell'implementazione corrispondente.
