# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali e strutturali **approvate** per le due applicazioni client di ArtAround: Navigator e Marketplace/Editor.

L'obiettivo è completare correttamente la fascia 18–24 predisponendo il sistema per 18–27 e 18–33 senza implementare prematuramente le estensioni e senza introdurre scelte che richiedano riscritture future.

## Regola di manutenzione

Questo file è un registro architetturale vivo. Ogni nuova decisione approvata relativa ai due client, ai loro contratti con il backend o alle predisposizioni 18–27/18–33 deve essere aggiunta qui.

Le proposte non ancora approvate non devono essere presentate come decisioni definitive. Le decisioni più recenti sostituiscono eventuali formulazioni precedenti incompatibili.

# Principio fondamentale: integrazione con il backend

Ogni nuova soluzione frontend o decisione architetturale deve essere verificata rispetto al **backend reale già presente nel repository** prima di essere approvata.

Sono vincolanti i seguenti principi:

- una proposta frontend deve integrarsi con modelli, servizi, revisioni, autorizzazioni e workflow backend già implementati;
- quando il backend offre già una capacità utile, il client deve sfruttarla invece di duplicarne la logica;
- il progetto deve sfruttare pienamente i servizi backend rilevanti disponibili;
- la business logic autorevole rimane nel backend quando appartiene al dominio ArtAround;
- se l'architettura frontend ideale mette in evidenza un limite reale del backend, deve essere valutata esplicitamente una modifica backend;
- se una modifica backend produce una soluzione complessivamente più semplice, coerente, riutilizzabile o predisposta alle estensioni future, deve essere preferita a workaround frontend;
- ogni nuova progettazione deve includere una verifica di compatibilità backend e, quando necessario, l'indicazione dei cambiamenti backend richiesti.

Questo principio vale sia per Navigator sia per Marketplace/Editor.

# Principi generali

- Un solo repository per il progetto.
- Un solo backend Node/Express condiviso da Navigator e Marketplace/Editor.
- Nessun backend separato per ciascun client.
- Lo scheletro 18–24 deve essere progettato conoscendo già i requisiti 18–27 e 18–33, senza implementarli prematuramente.
- Le estensioni future devono entrare principalmente come nuove capability, provider, action family o trasporti, non come riscritture del nucleo del Navigator.
- La generalità di ArtAround è prioritaria: il frontend non deve hardcodare semantiche specifiche di un museo.
- Non viene trattata come problema architetturale da risolvere la differenza terminologica tra la definizione di Item nelle specifiche e il modello Item attuale del progetto.

# Tecnologie dei client

## Navigator

- Vue.
- Vite.
- TypeScript.
- Vue Router.
- Pinia per lo stato applicativo condiviso.

Pinia rimane principalmente uno state container. Business logic e orchestrazione non devono essere concentrate negli store.

## Marketplace/Editor

- Vanilla JavaScript con ES Modules.
- Web Components per componenti riutilizzabili.
- Nessun framework UI come Vue, React o Svelte.

Marketplace/Editor rimane tecnologicamente indipendente dal Navigator.

# Codice condiviso

È ammesso un livello `shared/` tra i due client con vincoli rigidi:

- nessuna dipendenza da Vue;
- nessuna dipendenza dai Web Components specifici del Marketplace;
- nessun componente UI condiviso;
- solo codice framework-agnostic, contratti, primitive HTTP, schemi di configurazione e concetti realmente comuni.

I due client non devono essere obbligati ad avere lo stesso modello interno soltanto perché utilizzano lo stesso backend.

Quando opportuno lo stesso backend DTO può essere adattato separatamente:

```text
backend DTO
  -> Navigator adapter -> Navigator model
  -> Marketplace adapter -> Marketplace model
```

# Organizzazione logica del Navigator

È approvata una separazione concettuale leggera ispirata a `domain / application / capabilities / infrastructure / UI`, senza imporre una Clean Architecture pesante.

## Domain

Contiene concetti puri del Navigator e non dipende da Vue, Pinia, fetch, WebSocket, Web Speech API, QR scanner, geolocation o LLM.

## Application

Contiene use case e orchestrazione applicativa. La UI esprime intenzioni all'application layer; l'application layer coordina domain, repository, capability, adapter e aggiornamento degli store.

## Capabilities

Descrivono cosa il Navigator sa fare indipendentemente dalla tecnologia concreta. Esempi concettuali:

- command/intent resolution;
- visit control;
- location;
- speech output;
- realtime;
- content resolution;
- translation/generation future.

## Infrastructure

Contiene implementazioni concrete verso il mondo esterno: HTTP, browser storage, Web Speech API, camera, QR, geolocation e futuro realtime.

## UI

Views e components si occupano principalmente di rendering e interazione. Non contengono business logic di dominio e non dipendono direttamente dalla forma grezza delle risposte backend.

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

Non deve esistere un unico gigantesco `ApiService` chiamato direttamente dalle view. Sono preferibili repository/port specifici per responsabilità.

# Sistema Action

## Protocollo

È scartata l'idea di un enum globale di canonical commands come `AUTHOR`, `STYLE`, `TOILET`, ecc.

Il protocollo approvato è:

```text
ActionDefinition
  -> AvailableAction
  -> ActionRequest
  -> ActionResult
  -> InteractionEvent
```

ArtAround è museum-defined: relation types, presentation aspects, place types e vocabolari possono essere definiti dal singolo museo.

## Action families

Le action family descrivono meccanismi strutturali relativamente stabili, mentre la semantica concreta rimane dinamica.

Esempi:

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

Una nuova relation o un nuovo place type museum-defined non richiede nuovo codice nel Navigator. Una nuova classe fondamentale di comportamento ArtAround può invece introdurre una nuova family e il relativo handler.

Le family hanno contratti tipizzati; non è approvato un modello indiscriminato `parameters: any`.

## ActionDefinition

Descrive una capacità esistente nel dominio. Può essere derivata da vocabolario, relation types, place types/layout, runtime della visita, capability della piattaforma e future estensioni.

Le Domain ActionDefinition sono autorevoli nel backend e non devono necessariamente essere persistite in una collection Mongo dedicata: possono essere derivate dinamicamente dai dati già autorevoli.

## AvailableAction

`ActionDefinition` significa che la capacità esiste; `AvailableAction` significa che è concretamente disponibile nel contesto corrente.

La availability può dipendere da utente, sessione, entry corrente, presentation, posizione, modalità di controllo, dati del museo e future condizioni sincronizzate.

Il Navigator riceve principalmente `AvailableAction[]`, non il catalogo completo delle ActionDefinition. `AvailableAction[]` è parte integrante e versionata del `NavigatorRuntimeState`.

## Identità delle azioni

Ogni AvailableAction usa due identità:

- `definitionKey`: identità semantica relativamente stabile, utile per logging, analytics ed eventi;
- `availableActionId`: identità contestuale dell'azione disponibile nel runtime corrente.

L'`ActionRequest` usa principalmente `availableActionId`. Il backend ricostruisce o verifica definizione autorevole, availability, autorizzazione e contesto.

## ActionRequest

Contiene concettualmente almeno:

- `availableActionId`;
- `expectedRuntimeVersion`;
- eventuali input realmente necessari e non già ricavabili dalla sessione.

Il client invia meno contesto duplicato possibile.

## ActionResult e RuntimeUpdate

`ActionResult` rappresenta il risultato semantico dell'azione ed è distinto dal `RuntimeUpdate`, che rappresenta gli effetti sul runtime. Non ogni ActionRequest deve necessariamente incrementare `runtimeVersion`.

## InteractionEvent

Sono scartati eventi semanticamente hardcoded come `AUTHOR_REQUESTED` o `STYLE_REQUESTED`.

Si distinguono:

- platform events strutturali e relativamente stabili;
- interaction events generici che referenziano action e binding dinamici.

Questo consente al futuro monitoraggio docente di osservare qualsiasi museo senza conoscerne in anticipo l'ontologia.

## Domain Action, Client Action e UIIntent

- **Domain Action**: azione applicativa/domain autorevole lato backend.
- **Client Action**: azione significativa per l'esperienza ma realmente locale al dispositivo quando appropriato.
- **UIIntent**: comportamento puramente grafico come aprire un pannello, chiudere una modale o cambiare tab.

Gli UIIntent non vengono trasformati artificiosamente in ActionDefinition.

È approvato un modello ibrido: backend autorevole per Domain ActionDefinition; Navigator può possedere Client ActionDefinition per capability realmente locali; l'application layer unifica le azioni disponibili per la UI.

# Action Gateway del Navigator

È approvato un Action Gateway limitato al runtime delle `visit-session`, non un mega-endpoint globale:

```text
POST /api/visit-sessions/:sessionId/actions
```

Marketplace/Editor continua a usare endpoint specifici per CRUD, editing e amministrazione.

Il gateway delega a dispatcher e handler tipizzati che riusano i servizi backend esistenti:

```text
Action Gateway
  -> Action Dispatcher
     -> RelationQueryHandler
     -> PlaceNavigationHandler
     -> PresentationAdjustmentHandler
     -> VisitMoveHandler
     -> ...
```

Il gateway non contiene business logic di dominio e non deve diventare un God service. In futuro gli stessi ActionRequest potranno essere trasportati anche via realtime.

# Pausa e resume

La pausa rimane un vero stato persistente della VisitSession:

```text
active -> paused -> active
```

Pause/resume sono Domain Action strutturali del runtime e i relativi handler riusano i servizi backend già esistenti. La decisione di non creare `/sessions/:id/paused` riguarda soltanto Vue Router.

# NavigatorRuntimeState

È una projection autonoma, minima e autorevole del runtime, non la serializzazione della `VisitSession`.

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

È distinta dalle versioni di piano, vocabolario, layout e altre revisioni. Serve per ordinamento update, rilevazione di update vecchi, gap, resync e futura sincronizzazione realtime.

## session

Projection minima: identità, status e source type. Non include tutto lo storico di observations, events o learning.

## control

Esiste già concettualmente nel 18–24 con modalità `individual` ed è predisposto per il futuro controllo sincronizzato 18–27. Non duplica le AvailableAction con booleani `canX`.

## plan

Contiene soltanto riferimenti e posizione essenziale rispetto al piano.

## currentEntry

Rappresenta dove si trova logicamente la sessione nella sequenza e non incorpora l'intero Item.

## currentPresentation

Contiene la presentation effettivamente scelta dal server, compreso il testo. UI e TTS usano la stessa `currentPresentation`.

## location

Posizione logica normalizzata, ad esempio `placeId`, source e status. Dati grezzi GPS, QR o sensori rimangono fuori dal runtime. L'osservazione può nascere sul client, ma la posizione logica accettata è autorevole lato backend/runtime.

## availableActions

Sono parte integrante e versionata del runtime.

# VisitPlanProjection

Il piano completo rimane separato dal RuntimeState.

`VisitPlanProjection` contiene ciò che il Navigator necessita della revisione corrente del piano, ad esempio plan revision id, version, entries necessarie e route/timing summary utili.

Se il RuntimeState passa a una nuova plan revision, il client invalida o aggiorna la projection del piano.

# Navigation

La navigazione è stato runtime persistente minimo, non soltanto ActionResult effimero.

Nel runtime rimane concettualmente:

```text
navigation
  status
  routeId
  routeVersion
  destinationPlaceId
  currentLegIndex
```

La route completa rimane in una `NavigationProjection` separata con route id/version, layout revision, origin, destination, legs, instructions e warnings.

Se una route viene ricalcolata mantenendo la stessa destinazione, si mantiene lo stesso `routeId` incrementando `routeVersion`.

# Stato Pinia

Sono approvati sei store concettuali principali:

- `authStore`;
- `runtimeStore`;
- `planStore`;
- `navigationStore`;
- `museumStore`;
- `uiStore`.

Non si creano preventivamente store separati per speech, TTS, camera, GPS o altre capability device. Si parte da composable/capability locali e si promuove lo stato a store soltanto in presenza di un reale bisogno condiviso.

`runtimeStore` installa snapshot e applica RuntimeUpdate versionati, rilevando gap e resync. Non esegue business logic delle Action.

`planStore` mantiene la `VisitPlanProjection` corrente.

`navigationStore` mantiene la `NavigationProjection` corrente.

`museumStore` contiene il contesto relativamente statico necessario al Navigator senza diventare una copia indiscriminata di Museum, Vocabulary, Layout e Items.

`uiStore` contiene esclusivamente stato grafico condiviso e non autorevole.

Gli store non si orchestrano direttamente tra loro: l'orchestrazione passa dall'application layer.

# Routing del Navigator

È approvato il modello **routing per lifecycle + VisitShellView per il runtime attivo**.

Regola:

> Una route rappresenta un cambio di lifecycle, identità primaria o workflow dell'utente; non ogni variazione visiva o capability della stessa visita.

## Visit vs VisitSession

```text
/visits/:visitId
```

rappresenta la visita prima dell'esecuzione, mentre:

```text
/sessions/:sessionId
```

rappresenta la sessione runtime concreta dell'utente.

Durante la visita l'identità primaria è la VisitSession.

## VisitShellView

`/sessions/:sessionId` è la shell del runtime attivo. Mappa, presentation, navigation UI, speech, AvailableAction, pausa e variazioni della presentation non diventano route separate.

La VisitShell è un composition root UI, non un componente monolitico.

## Pausa

La pausa non crea una route Vue `/paused`: la URL rimane `/sessions/:sessionId` mentre `runtime.session.status` passa ad `paused`.

## Summary

La conclusione definitiva della visita rappresenta un cambio di lifecycle e usa concettualmente:

```text
/sessions/:sessionId/summary
```

`route_completed` rimane invece uno stato della VisitShell finché la sessione non è realmente completata.

## Preparazione visita

Non viene introdotta automaticamente `/visits/:visitId/start`. La preparazione 18–24 rimane leggera e integrata nel dettaglio visita finché una futura necessità UX non giustificherà una route distinta.

## Bootstrap e resume

Il bootstrap di `/sessions/:sessionId` passa da un application use case come `ResumeVisitSession`, non da fetch/business logic nei router guard. Un refresh deve ricostruire l'esperienza dal backend autorevole usando `sessionId`.

## Predisposizione 18–27

Il normale participant/student runtime continua a usare `/sessions/:sessionId`; modalità sincronizzata e possibilità operative derivano da `control` e AvailableAction. Nuovi workflow realmente distinti potranno aggiungere route come join o teacher control.

## Predisposizione 18–33

LLM, QR, geolocation e translation non ottengono automaticamente nuove route: sono capability/provider dentro il runtime esistente. La generazione di una visita, essendo invece un workflow pre-visita autonomo, può avere route dedicate.

# Realtime futuro

HTTP e futuro realtime trasportano lo stesso modello applicativo di RuntimeUpdate. `runtimeStore` non possiede semantiche diverse a seconda del trasporto.

# Flusso Navigator 18–24

## Configurazione del museo

Il Navigator è una singola applicazione generica specializzata per un museo tramite **file di configurazione statico**.

La configurazione contiene almeno `museumId` e branding/configurazione visuale realmente necessari. Non duplica dominio, layout, vocabulary, visits o contents, che continuano a provenire dal backend.

Non viene introdotta una schermata generica di scelta museo nel Navigator.

## Library come landing operativa

La landing del Navigator è una **Library personale**, non una copia del catalogo Marketplace.

Route concettuale:

```text
/library
```

La Library mostra:

- eventuali sessioni riprendibili;
- visite acquisite/abilitate per l'utente;
- visite personali utilizzabili;
- accesso alla generazione di una nuova visita;
- un'azione per aprire il Marketplace e trovare/acquistare altre visite.

Poiché la Library è personale, l'autenticazione è un gate normale del Navigator operativo.

## Marketplace separato

Il catalogo pubblico non viene duplicato nel Navigator. L'azione “Apri Marketplace” porta al client Marketplace/Editor, eventualmente contestualizzato sul museo configurato.

Responsabilità:

```text
Navigator
= ciò che possiedo / eseguo / genero

Marketplace/Editor
= ciò che scopro / acquisto / creo / modifico / pubblico
```

## Visit entitlement / accesso autorevole

Il backend deve introdurre un concetto autorevole di accesso dell'utente a una Visit. Il Navigator non determina localmente cosa è stato acquistato.

Il modello esatto è ancora aperto, ma deve poter rappresentare almeno relazione utente-visita, origine dell'accesso/acquisizione e stato. La Library deve essere alimentata da una projection/read API backend dedicata o equivalente.

Entitlement commerciale, ownership/editorial permission e visibility non sono lo stesso concetto.

## Preparazione leggera della visita

Prima dello start non viene introdotto un wizard tecnico obbligatorio. Il dettaglio visita sfrutta:

- presentation preference e preference options;
- navigation/accessibility preference;
- adaptive learning consent quando richiesto;
- logistics plan personalizzato.

La configurazione avanzata usa progressive disclosure.

## Logistics plan autorevole

Il `logistics-plan` backend è la fonte autorevole per preview di percorso, tempi, warning, movimento e osservazione. Il frontend non replica o approssima routing, timing o adattamento già disponibili nel backend.

## Navigator Runtime Projection service

È approvata l'introduzione backend di un servizio dedicato alla costruzione del `NavigatorRuntimeState` e di un endpoint concettuale:

```text
GET /visit-sessions/:sessionId/runtime
```

Start e resume convergono sullo stesso modello runtime. Il runtime projector riusa servizi e dati autorevoli esistenti.

## Cursor corrente vs progresso eseguito

È approvato un refactoring backend:

```text
currentEntryIndex
= entry attualmente selezionata/presentata

executedThroughEntryIndex
= massimo prefisso della visita già eseguito
```

Il planner e la validazione del prefisso eseguito usano `executedThroughEntryIndex`; runtime/UI usa `currentEntryIndex` come cursore corrente. Questa separazione rende corretto il comando obbligatorio `Precedente`.

## visit.move

La action family `visit.move` supporta almeno `next` e `previous`. Il relativo handler backend verifica stato sessione, piano, bounds, control mode e availability.

Nel futuro 18–27 la limitazione dello studente deriva dall'assenza della relativa AvailableAction, non da codice speciale nella UI.

## Riuso dei servizi runtime esistenti

Presentation adjustment, relation query, facility/place navigation e pause/resume vengono esposti tramite Action Handler che riusano i servizi backend già disponibili. L'Action Gateway uniforma il protocollo runtime ma non sostituisce i servizi di dominio.

## Telemetria affidabile

Il Navigator usa learning/telemetria backend soltanto quando il segnale è realmente osservabile e affidabile. Nel 18–24 possono essere appropriati content experience e interaction events; non vengono inventate movement/transition observations senza positioning o altro segnale affidabile.

## PlanChangeProposal

Il runtime adaptive planning esistente viene integrato nella VisitShell secondo il workflow:

```text
proposal
  -> preview
  -> accept / reject
```

La UI non applica silenziosamente una proposta. `route_completed` può offrire conclusione oppure estensione tramite il meccanismo di plan adaptation esistente.

## Completion summary persistente

Il backend deve rendere il completion summary aggregato recuperabile dopo refresh o riapertura, separandolo dalla telemetria raw e offrendo una read API della sessione completata.

## Discovery delle sessioni riprendibili

Il backend deve offrire una read API per le sessioni ancora riprendibili, per esempio `active`, `paused` o `route_completed`. `localStorage` non è fonte autorevole per determinare se esiste una visita in corso.

## Hard time budget

`timeBudgetSeconds` viene esposto come vincolo hard configurabile dal Navigator soltanto quando il backend garantisce che influenzi realmente il piano iniziale preservando i core e adattando recommended/optional content.

# Generazione di visite nel Navigator

La generazione è un vero workflow pre-visita e usa il generatore backend già esistente; non viene reimplementata nel client.

Route concettuali:

```text
/generate
/generated-plans/:planId
```

Il form traduce bisogni umani in `GenerationRequest` strutturato senza esporre direttamente la complessità tecnica del modello.

Il backend mantiene il proprio ruolo autorevole per semantic goals, relation goals, time budget, audience, knowledge, preferenze di presentazione, movimento, routing requirements, observation, visit density, discovery e altri parametri supportati.

## Preview, accept e start

Il flusso riusa i servizi backend esistenti:

```text
GenerateVisitView
  -> GeneratedVisitPlan proposed
  -> preview
  -> accept
  -> start
  -> VisitSession
  -> VisitShellView
```

Una sessione originata da `GeneratedVisitPlan` usa la stessa VisitShell delle visite editoriali.

## Salvataggio di una visita generata

“Salva nelle mie visite” materializza il generated plan come una vera `Visit` community dell'utente con normale `VisitRevision`.

Il `GeneratedVisitPlan` rimane un piano runtime concreto, non diventa il nuovo formato editoriale.

La materializzazione conserva la struttura editoriale riutilizzabile, ma non congela impropriamente representation, physical route, timing o altri dettagli runtime specifici dell'utente e della revisione di layout corrente.

La visita materializzata viene successivamente modificata nel Marketplace/Editor usando i normali servizi delle community Visit.

Le visite generate salvate nascono di default come **community Visit private**.

## Futuro LLM 18–33

Il futuro LLM non sostituisce il generatore. Produce lo stesso `GenerationRequest` strutturato già usato dal form del Navigator:

```text
form ───────────────┐
                    ├─> GenerationRequest -> generator
LLM / NL future ────┘
```

# Workflow revisionale delle Visit

Le Visit possiedono già un sistema draft/revisionale analogo agli Item.

`Visit` è l'identità stabile e mantiene:

```text
publishedRevisionId
workingRevisionId
```

`VisitRevision.status` usa:

```text
draft
in_review
changes_requested
published
superseded
```

Le visite official usano il workflow di review manageriale; le community Visit mantengono comunque working revision, consistency check e publication ma non la review manageriale.

La nuova visibility NON sostituisce questo workflow.

# Visibility delle Visit

È approvato un asse di visibility stabile sulla `Visit`, separato dagli stati delle `VisitRevision`.

```text
Visit.visibility
  public
  unlisted
  private
```

La visibility appartiene alla Visit, non alla singola revisione.

## Separazione degli assi

Il modello distingue almeno quattro concetti indipendenti:

```text
EDITORIAL REVISION STATUS
  draft | in_review | changes_requested | published | superseded

VISIBILITY
  public | unlisted | private

LIFECYCLE
  active | trashed

ACCESS / RIGHTS
  ownership | entitlement | share access
```

Una Visit può quindi avere contemporaneamente una `publishedRevision` stabile e una nuova `workingRevision` draft. Gli utenti autorizzati all'esecuzione vedono la published revision, non il draft in lavorazione.

## Public

Una Visit `public`:

- può comparire nei listing/search del Marketplace;
- è scopribile da tutti;
- può essere acquistabile quando l'offerta commerciale lo consente;
- richiede comunque una `publishedRevisionId` valida per essere esposta/eseguita pubblicamente.

## Private

Una Visit `private`:

- non compare nel Marketplace;
- non è raggiungibile da altri tramite share link;
- è accessibile soltanto al proprietario o ad altri gestori esplicitamente autorizzati dal dominio;
- può comunque avere una revisione `published` ed essere completamente eseguibile dal proprietario.

Questo è il default delle visite generate materializzate.

## Unlisted

Una Visit `unlisted`:

- non compare nei listing/search del Marketplace;
- è visibile al creatore;
- può essere raggiunta da altre persone tramite un meccanismo di condivisione esplicito.

Per la prima implementazione si preferisce un **opaque share token** invece di usare `visitId` come segreto.

Concetto backend:

```text
VisitShareLink
  visitId
  tokenHash
  createdBy
  createdAt
  expiresAt?   // opzionale
  revokedAt?   // opzionale
```

La forma esatta dell'API e del token rimane da progettare.

Non viene introdotta subito una ACL nominativa completa se il link condivisibile risolve il requisito iniziale; una condivisione nominativa può essere aggiunta in futuro se necessaria.

## Share access, entitlement ed editing

Sono concetti distinti:

- share access: permette di scoprire/raggiungere una Visit unlisted;
- entitlement: determina se l'utente possiede il diritto commerciale/applicativo di eseguire la visita;
- ownership/editorial permission: determina chi può modificarla.

Possedere un share link non equivale automaticamente ad avere un entitlement permanente, soprattutto per visite a pagamento.

# UX del Navigator già approvata a livello strutturale

Le view principali previste sono:

- `LibraryView`;
- `VisitDetailView`;
- `AuthView` per login/register con `returnTo`;
- `GenerateVisitView`;
- `GeneratedPlanView`;
- `VisitShellView`;
- `SessionSummaryView`;
- `NotFoundView`.

Il bootstrap di configurazione museo + auth avviene a livello app, non tramite una view dedicata.

`VisitDetailView` contiene preparazione leggera e progressive disclosure delle preferenze; non esiste per ora una route `/start` separata.

`VisitShellView` è una composition shell reattiva al `NavigatorRuntimeState`, con regioni specializzate per presentation, speech, AvailableActions, map, navigation, plan proposal e runtime overlays.

`PresentationRegion` usa esclusivamente `currentPresentation` come fonte autorevole del contenuto; testo a schermo e TTS derivano dallo stesso testo.

Bottoni accessibili e voce selezionano le stesse `AvailableAction`; non esistono due logiche parallele.

Map e navigation sono panel/region interni. Chiudere un pannello è un UIIntent e non modifica automaticamente lo stato domain corrispondente.

`paused`, `route_completed` e plan proposal sono stati/overlay della VisitShell; soltanto `completed` porta alla Summary route.

Loading ed errori distinguono bootstrap, singola operazione, transport failure, stale runtime, auth e not-found. Una Action pending non deve bloccare inutilmente l'intera view.

`SessionSummaryView` è recuperabile dal backend e non dipende dallo stato locale lasciato dalla VisitShell.

# Decisioni volutamente ancora aperte

Non sono ancora fissati in modo definitivo:

- schema TypeScript finale di `ActionDefinition`, `AvailableAction`, `ActionRequest`, `ActionResult` e `InteractionEvent`;
- generazione/forma esatta di `availableActionId`;
- rappresentazione esatta del `RuntimeUpdate` incrementale;
- nomi definitivi di tutte le action family oltre a quelle già approvate concettualmente;
- forma esatta degli status della navigation;
- schema finale di `NavigationProjection`;
- comportamento UX preciso delle relation query rispetto a `currentPresentation`;
- struttura finale dei componenti Vue;
- routing e flussi dettagliati del Marketplace/Editor;
- forma esatta dei DTO/API dell'Action Gateway, NavigatorRuntimeState, completion summary e session discovery;
- schema esatto del file di configurazione museo e della relativa validazione/bootstrap;
- dettagli di implementazione del refactoring `currentEntryIndex` / `executedThroughEntryIndex`;
- schema definitivo del modello entitlement/acquisto e del relativo pricing/licensing;
- forma esatta delle API Library;
- forma esatta del servizio che materializza `GeneratedVisitPlan` in `Visit`/`VisitRevision`;
- forma esatta di `VisitShareLink`, share token e relativa API;
- eventuale futura ACL nominativa per le Visit unlisted.

Questi punti devono essere progettati e approvati prima dell'implementazione corrispondente.
