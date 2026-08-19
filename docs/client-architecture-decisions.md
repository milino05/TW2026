# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali e strutturali **approvate** per Navigator e Marketplace/Editor.

L'obiettivo è completare correttamente la fascia 18–24 predisponendo il sistema per 18–27 e 18–33 senza implementare prematuramente le estensioni e senza introdurre scelte che richiedano riscritture future.

## Regola di manutenzione

Questo file è un registro architetturale vivo. Ogni nuova decisione approvata relativa ai client, ai loro contratti con il backend o alle predisposizioni 18–27/18–33 deve essere aggiunta qui. Le proposte non ancora approvate non devono essere presentate come definitive. Le decisioni più recenti sostituiscono eventuali formulazioni precedenti incompatibili.

# Principio fondamentale: integrazione con il backend

Ogni proposta frontend o architetturale deve essere verificata rispetto al **backend reale su `main`** prima di essere approvata.

- Il client deve integrarsi con modelli, servizi, revisioni, autorizzazioni e workflow backend già implementati.
- Quando il backend offre già una capacità utile, il client deve sfruttarla invece di duplicarne la logica.
- La business logic autorevole rimane nel backend quando appartiene al dominio ArtAround.
- Se una soluzione frontend mette in evidenza un limite reale del backend, va proposta una modifica backend quando produce un sistema complessivamente migliore.
- Sono da preferire refactoring coordinati a workaround frontend.
- Questo principio vale sia per Navigator sia per Marketplace/Editor.

# Principi generali e tecnologie

- Un solo repository e un solo backend Node/Express condiviso.
- Nessun backend separato per i due client.
- Architettura 18–24 predisposta per 18–27 e 18–33.
- ArtAround rimane generico rispetto ai musei; il frontend non hardcoda ontologie museali.
- Navigator: Vue, Vite, TypeScript, Vue Router, Pinia.
- Marketplace/Editor: vanilla JavaScript con ES Modules e Web Components; nessun framework UI come Vue/React/Svelte.
- `shared/` può contenere solo codice framework-agnostic, contratti, primitive HTTP e schemi realmente comuni; nessuna UI condivisa fra Vue e Web Components.
- Lo stesso backend DTO può essere adattato separatamente nei due client.

# Organizzazione logica del Navigator

Separazione concettuale leggera:

```text
domain / application / capabilities / infrastructure / UI
```

- **Domain**: concetti puri; nessuna dipendenza da Vue, Pinia, fetch, WebSocket, Web Speech, QR, geolocation o LLM.
- **Application**: use case e orchestrazione.
- **Capabilities**: contratti per command/intent resolution, visit control, location, speech, realtime, content, future translation/generation.
- **Infrastructure**: HTTP, browser storage, Web Speech, camera, QR, geolocation, futuro realtime.
- **UI**: rendering/interazione; niente business logic di dominio e niente dipendenza dai DTO HTTP grezzi.

## API adapter layer

```text
UI
  -> Application
  -> Port / Repository
  -> API Adapter
  -> HTTP Client
  -> Express API
```

Non deve esistere un unico gigantesco `ApiService`. Sono preferibili repository/port specifici per responsabilità.

# Sistema Action

È scartato un enum globale di comandi semanticamente hardcoded (`AUTHOR`, `STYLE`, `TOILET`, ecc.). ArtAround è museum-defined.

Protocollo:

```text
ActionDefinition
  -> AvailableAction
  -> ActionRequest
  -> ActionResult
  -> InteractionEvent
```

## Action family

Le family descrivono meccanismi strutturali relativamente stabili; i valori museali rimangono dinamici.

Esempi approvati concettualmente:

```text
relation.query
place.navigate
visit.move
presentation.adjust
```

Le family hanno contratti tipizzati; non è approvato un generico `parameters: any`.

## ActionDefinition e AvailableAction

`ActionDefinition` = capacità esistente nel dominio. Può essere derivata da vocabulary, relation types, place types/layout, visita, sessione e capability della piattaforma. Le Domain ActionDefinition sono autorevoli nel backend e non richiedono necessariamente una collection Mongo dedicata.

`AvailableAction` = capacità concretamente disponibile per quell'utente e quel contesto. Il Navigator riceve principalmente `AvailableAction[]`, che è parte versionata del `NavigatorRuntimeState`.

Ogni AvailableAction usa:

- `definitionKey`: identità semantica relativamente stabile per eventi/analytics/diagnostica;
- `availableActionId`: identità contestuale dell'azione disponibile ora.

L'ActionRequest contiene almeno `availableActionId`, `expectedRuntimeVersion` ed eventuali input realmente necessari. Il backend ricostruisce e rivalida semantica, availability, autorizzazione e contesto.

`ActionResult` descrive il risultato semantico; `RuntimeUpdate` descrive gli effetti sul runtime. Sono concetti distinti.

## Eventi

Sono scartati eventi museum-specific hardcoded come `AUTHOR_REQUESTED`. Si distinguono platform event strutturali e `InteractionEvent` generici che referenziano action e binding dinamici.

## Domain Action, Client Action e UIIntent

- Domain Action: azione applicativa/domain autorevole lato backend.
- Client Action: azione significativa ma realmente locale al device.
- UIIntent: comportamento puramente grafico, per esempio aprire/chiudere un pannello.

Gli UIIntent non diventano artificialmente ActionDefinition.

# Action Gateway runtime

È approvato un gateway limitato alle `visit-session`, concettualmente:

```text
POST /api/visit-sessions/:sessionId/actions
```

Marketplace/Editor continua a usare endpoint resource-specific.

Il gateway delega a dispatcher e handler tipizzati che **riusano i servizi backend esistenti**, per esempio RelationQueryHandler, PlaceNavigationHandler, PresentationAdjustmentHandler e VisitMoveHandler. Non contiene business logic di dominio e non diventa un God service. In futuro gli stessi ActionRequest potranno essere trasportati via realtime.

# Pausa e resume

La pausa rimane uno stato persistente della VisitSession:

```text
active -> paused -> active
```

Pause/resume sono Domain Action del runtime e riusano i servizi backend esistenti. Non esiste una route Vue `/paused`: l'URL rimane `/sessions/:sessionId` e cambia il runtime autorevole.

# NavigatorRuntimeState

Projection autonoma, minima e autorevole del runtime; non serializzazione completa di `VisitSession`.

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

- `runtimeVersion` è distinta da versioni di piano/vocabulary/layout e serve a stale detection, gap detection, resync e futuro realtime.
- `session` è una projection minima di identità/status/source type.
- `control` parte da modalità `individual` ed è predisposto per 18–27; non duplica AvailableAction con `canX`.
- `plan` contiene solo riferimenti e posizione essenziale.
- `currentEntry` rappresenta la posizione logica nella sequenza, non l'intero Item.
- `currentPresentation` contiene la presentation selezionata dal server, incluso il testo; UI e TTS usano la stessa fonte.
- `location` è posizione logica normalizzata; dati grezzi GPS/QR/sensori restano nei provider.
- `availableActions` è parte integrante e versionata del runtime.

## VisitPlanProjection

Il piano completo resta separato dal runtime e contiene ciò che serve al Navigator: plan revision/version, entries necessarie, route/timing summary utili. Un cambio di plan revision invalida/aggiorna la projection.

## Navigation

La navigazione è stato runtime persistente minimo. Concettualmente:

```text
navigation
  status
  routeId
  routeVersion
  destinationPlaceId
  currentLegIndex
```

La route completa vive in `NavigationProjection`, separata, con route id/version, layout revision, origin, destination, legs, instructions e warnings. Un ricalcolo verso la stessa destinazione mantiene `routeId` e incrementa `routeVersion`.

# Stato Pinia

Sei store concettuali:

- `authStore`;
- `runtimeStore`;
- `planStore`;
- `navigationStore`;
- `museumStore`;
- `uiStore`.

Non si creano preventivamente store per speech/TTS/camera/GPS. Si parte da capability/composable locali.

`runtimeStore` installa snapshot e applica RuntimeUpdate versionati, rilevando gap/resync; non contiene business logic delle Action. Gli store non si orchestrano direttamente: l'orchestrazione passa dall'application layer.

Non viene introdotto inizialmente un `libraryStore`: la Library può vivere nello stato route/application finché non emerge un reale bisogno di condivisione o caching globale.

# Routing del Navigator

Modello approvato: **routing per lifecycle + VisitShellView per runtime attivo**.

> Una route rappresenta un cambio di lifecycle, identità primaria o workflow, non ogni variazione visiva della stessa visita.

Route concettuali approvate:

```text
/
/auth/login
/auth/register
/library
/visits/:visitId
/generate
/generated-plans/:planId
/sessions/:sessionId
/sessions/:sessionId/summary
404
```

`/` effettua bootstrap e porta l'utente autenticato a `/library`, quello non autenticato al login.

`/visits/:visitId` rappresenta una Visit prima dell'esecuzione; `/sessions/:sessionId` rappresenta la VisitSession concreta.

`VisitShellView` è la shell del runtime attivo: mappa, presentation, navigation UI, speech, AvailableAction e pausa non sono route separate. `route_completed` rimane uno stato della VisitShell; solo `completed` porta alla summary.

Il bootstrap di una sessione passa da un application use case come `ResumeVisitSession`, non da fetch/business logic nei router guard. Refresh e deep link devono ricostruire il runtime dal backend autorevole.

18–27: participant/student continua a usare la stessa session route; controllo e availability derivano dal runtime. 18–33: LLM, QR, geolocation e translation restano capability/provider; la generazione visita è invece un workflow pre-visita autonomo e ha route dedicate.

# Configurazione museo

Navigator è una singola applicazione generica specializzata tramite **file di configurazione statico** con almeno `museumId` e branding necessario. Il file non duplica dominio, vocabulary, layout, Visit o Item. Non esiste una schermata generica di scelta museo nel Navigator.

# Library del Navigator

La landing operativa è `LibraryView`, non una copia del Marketplace.

La Library mostra per il museo configurato:

- sessioni riprendibili;
- Visit realmente eseguibili dall'utente;
- visite personali utilizzabili;
- accesso alla generazione;
- azione per aprire il Marketplace.

La Library è personale, quindi autenticazione è un gate normale.

Un `GeneratedVisitPlan` non entra nella Library finché non viene materializzato come Visit. Una sua sessione attiva può invece comparire fra le sessioni riprendibili.

## Marketplace separato

```text
Navigator
= ciò che possiedo / eseguo / genero

Marketplace/Editor
= ciò che scopro / acquisto / creo / modifico / pubblico
```

“Apri Marketplace” porta all'altra applicazione, possibilmente mantenendo il contesto del museo configurato. Il link viene risolto dall'application/infrastructure layer, non hardcodato nei componenti.

I link di condivisione `unlisted` vengono risolti dal Marketplace: lì l'utente scopre la visita e, se necessario, acquisisce l'entitlement; solo dopo la Visit entra nella Library.

# Visit entitlement e diritto di esecuzione

È approvato un modello backend separato per il diritto corrente di esecuzione di una Visit.

## VisitEntitlement

`VisitEntitlement` è un'entità distinta da `User`, `Visit` e dal futuro storico commerciale.

Non viene inizialmente generalizzata in un'entità polimorfica Item/Visit: il dominio commerciale degli Item verrà progettato separatamente prima di decidere se una generalizzazione sia realmente corretta.

Struttura concettuale minima:

```text
VisitEntitlement
  userId
  visitId

  acquisitionType
    purchase
    free_acquisition
    grant

  status
    active
    revoked

  acquiredAt
  revokedAt?
  revokedBy?
```

La relazione `userId + visitId` è unica dal punto di vista del diritto corrente: non devono esistere più entitlement concorrenti attivi per la stessa coppia.

`VisitEntitlement` rappresenta **il diritto corrente**, non la transazione economica. Non contiene prezzo, currency, license snapshot, payment data, statistiche di vendita o storico economico.

Il futuro dominio Marketplace potrà avere Offer/Acquisition/Purchase/Sale o equivalenti; una acquisizione riuscita concede o aggiorna il relativo VisitEntitlement.

Anche una Visit gratuita entra nella Library tramite acquisizione esplicita (`free_acquisition`): essere gratuita non significa comparire automaticamente nella Library di tutti.

## Ownership vs entitlement

Una community Visit creata dall'utente, comprese le visite generate e materializzate, è eseguibile per **ownership** tramite `Visit.createdBy`; non viene creato un entitlement artificiale al proprietario.

I permessi editoriali museali su Visit official non producono automaticamente un diritto personale di esecuzione e non riempiono la Library dell'operatore. Un eventuale preview editoriale nel Navigator sarà un workflow distinto da progettare se necessario.

Quindi almeno due basi normali di accesso sono:

```text
ownership
entitlement
```

## VisitExecutionAccessService

È approvato un unico servizio backend autorevole, concettualmente `VisitExecutionAccessService` / `resolveVisitExecutionAccess({ userId, visitId })`, che determina se una Visit può essere eseguita e su quale base.

Questo servizio deve essere riusato da:

- Library projection;
- Navigator Visit Detail;
- `startSession()`;
- futuri boundary che richiedono il diritto di esecuzione.

La Library non è un controllo di sicurezza sufficiente: conoscere un `visitId` non deve consentire di bypassare l'acquisto o l'accesso.

`startSession()` deve quindi verificare almeno:

```text
Visit active?
publishedRevisionId presente?
execution access consentito?
```

prima di costruire snapshot/piano/sessione.

## Visibility e entitlement

Visibility e diritto di esecuzione cooperano ma rimangono concetti distinti.

- Il creatore di una community Visit può eseguire la propria Visit `public`, `unlisted` o `private`.
- Un entitlement attivo permette l'esecuzione di Visit `public` o `unlisted`.
- Un entitlement non aggira `private`: una Visit private rimane eseguibile solo dal proprietario/gestori autorizzati dal dominio.

È vietato il normale passaggio di una Visit a `private` quando esistono entitlement esterni attivi, perché ciò revocherebbe implicitamente diritti acquisiti. Il backend deve rifiutare questo cambio, per esempio con `409`; un eventuale ritiro commerciale con revoche/rimborsi richiederà un workflow esplicito futuro.

Il passaggio `public -> unlisted` è invece compatibile con entitlement esistenti: gli utenti autorizzati continuano a eseguire la Visit, che semplicemente non compare più nei listing pubblici.

Il passaggio `unlisted -> private` revoca atomicamente gli share link attivi. Gli share link non sono entitlement economici e possono quindi essere invalidati insieme al cambio di visibility.

## Entitlement e revisioni

L'entitlement è associato alla **Visit stabile** (`visitId`), non a una specifica `VisitRevision`.

Una nuova published revision della stessa Visit non richiede un nuovo acquisto. Gli utenti autorizzati continuano a ricevere la published revision corrente, mentre eventuali working draft restano invisibili all'esecuzione.

## Lifecycle e hard delete

Solo Visit `active` con una published revision valida sono eseguibili e possono entrare nella Library.

Una Visit `trashed` non è eseguibile anche se esiste un entitlement attivo. Se viene ripristinata, lo stesso entitlement può tornare applicabile.

L'hard delete della Visit deve eliminare gli entitlement correnti collegati alla Visit. Un futuro storico commerciale non deve essere confuso con l'entitlement corrente e potrà avere regole di conservazione differenti.

# VisitLibraryProjection

Il Navigator non riceve `Visit + VisitRevision + VisitEntitlement` grezzi. Il backend espone una projection minima per il museo configurato.

Forma concettuale:

```text
VisitLibraryProjection
  museumId
  visits[]

VisitLibraryEntry
  visitId
  revisionId
  title
  description?
  kind
  visibility
  museumIds[]
  estimatedTotalSeconds?
  access
    basis: ownership | entitlement
    acquisitionType?: purchase | free_acquisition | grant
```

I nomi esatti dei DTO rimangono da fissare, ma la semantica è approvata.

La projection non contiene content entries complete, VisitRevision grezza, physical route, vocabulary, layout, preferenze utente, logistics plan personalizzato, prezzo, transaction history, entitlement document completo, working revision o draft.

La Library risponde a “quali Visit posso aprire/eseguire e quale riepilogo devo mostrarne?”, non restituisce l'intero dominio.

Il filtro del museo usa la published revision e deve supportare Visit multi-museo; non si basa semplicemente su `ownerMuseumId`.

API concettuale approvata:

```text
GET /users/me/visit-library?museumId=:museumId
```

`GET /visits/mine` rimane invece il contratto Marketplace/Editor per le Visit **editorialmente gestibili** e non viene riusato per il Navigator.

Le sessioni riprendibili rimangono un contratto separato dalla VisitLibraryProjection. L'application layer della Library coordina in parallelo:

```text
VisitLibraryRepository
SessionRepository.listResumable()
```

così una failure di una sezione non deve necessariamente bloccare l'altra.

# VisitDetail e preparazione

`VisitDetailView` è operativamente accessibile per Visit che il backend riconosce come eseguibili dall'utente.

Il Navigator non deve dipendere direttamente dal DTO editoriale/pubblico grezzo `GET /visits/:visitId`. È approvata una futura **Navigator Visit Detail Projection autorizzata**, che riusa lo stesso VisitExecutionAccessService della Library e di `startSession()`.

La preparazione rimane leggera e usa progressive disclosure; non esiste per ora `/start` separato.

Riusa servizi backend per:

- presentation preferences e options;
- navigation/accessibility preferences;
- adaptive learning consent;
- logistics plan personalizzato.

Il `logistics-plan` è fonte autorevole per percorso, tempi, warning, movimento e osservazione. Il frontend non replica questi calcoli.

# Runtime backend necessario

È approvato un backend `NavigatorRuntimeProjectionService` (nome concettuale) e un endpoint concettuale:

```text
GET /visit-sessions/:sessionId/runtime
```

Start e resume convergono sullo stesso `NavigatorRuntimeState`; il projector riusa i servizi backend esistenti.

## Cursor vs progresso eseguito

Refactoring approvato:

```text
currentEntryIndex
= entry attualmente selezionata/presentata

executedThroughEntryIndex
= massimo prefisso già eseguito
```

Planner e validazione del prefisso usano `executedThroughEntryIndex`; runtime/UI usa `currentEntryIndex`. Questo rende corretto `Precedente` senza far retrocedere il progresso eseguito.

`visit.move` supporta almeno `next` e `previous` e il backend verifica stato, bounds, control mode e availability.

# Riuso dei servizi runtime

Presentation adjustment, relation query, facility/place navigation e pause/resume passano da Action Handler che riusano servizi backend esistenti. Il gateway uniforma il protocollo ma non duplica selection delle representation, semantic graph, routing o gestione pause.

# Telemetria e adaptive planning

Il Navigator usa learning/telemetria solo quando il segnale è realmente osservabile e affidabile. Nel 18–24 sono appropriati content experience e interaction events quando misurabili; non vengono inventate transition/movement observations senza positioning o altro segnale affidabile.

Le modifiche ordinarie del piano seguono:

```text
proposal -> preview -> accept/reject
```

`route_completed` può offrire complete oppure extend tramite il planning esistente.

Il completion summary aggregato deve essere persistente/recuperabile con read API separata dalla telemetria raw. Il backend deve inoltre offrire una read API per sessioni riprendibili (`active`, `paused`, `route_completed`).

`timeBudgetSeconds` viene esposto come hard constraint nel Navigator solo quando il backend garantisce che influenzi realmente il piano iniziale preservando core e adattando recommended/optional.

# Generazione di visite nel Navigator

È un workflow pre-visita distinto con:

```text
/generate
/generated-plans/:planId
```

Il client usa il generatore backend esistente e non implementa scoring/planning.

## NavigatorAppShell e VisitShell

L'esperienza pre/post-visita usa una `NavigatorAppShell` con branding, account e RouterView per Library, VisitDetail, GenerateVisit, GeneratedPlan e Summary.

La visita attiva usa invece `VisitShellView`, più immersiva e orientata all'esecuzione. Non viene forzata dentro la stessa navigazione/chrome della Library.

## GenerateVisitView

Usa un **form strutturato e generico**, non una chat, che traduce bisogni umani nel `GenerationRequest` supportato dal backend.

Il form non hardcoda interessi o ontologia del museo. È approvata una nuova `GenerationOptionsProjection` backend che deriva dalle risorse autorevoli del museo le opzioni realmente proponibili all'utente. Vue non deve fetchare vocabulary, tutti gli Item, relations e layout per dedurre autonomamente le opzioni di generazione.

Le generation preferences esistenti possono inizializzare il form, ma una generazione occasionale non le sovrascrive automaticamente.

## GeneratedPlanView

`/generated-plans/:planId` è una preview recuperabile del piano, non l'esposizione del documento Mongo grezzo.

Azioni principali:

- **Inizia**;
- **Salva nelle mie visite**;
- **Modifica criteri**.

Modificare criteri produce una nuova richiesta/un nuovo GeneratedVisitPlan invece di mutare quello precedente.

## Invariante accept/start

Backend e UI devono rispettare:

```text
proposed -> accepted -> start -> VisitSession
```

Il backend deve rifiutare lo start di un GeneratedVisitPlan ancora `proposed`; il vincolo non viene affidato solo alla UI.

## Salvataggio/materializzazione

“Salva nelle mie visite” materializza il GeneratedVisitPlan come vera `Visit` community dell'utente. `GeneratedVisitPlan` resta un piano runtime concreto e non diventa il modello editoriale.

La materializzazione conserva la struttura editoriale riutilizzabile, ma non congela impropriamente representation, physical route, timing o dettagli runtime specifici dell'utente/layout corrente.

La Visit generata salvata nasce:

```text
kind = community
visibility = private
```

con una `VisitRevision` **già editorialmente published/eseguibile**. Non nasce come semplice draft inutilizzabile, perché l'utente deve poterla ritrovare nella Library ed eseguirla immediatamente.

Quando viene poi modificata nel Marketplace, si crea una nuova working revision mentre la precedente published private revision rimane eseguibile nel Navigator fino alla pubblicazione della nuova revisione.

La stessa Visit può essere aperta direttamente nel Marketplace/Editor per la modifica usando i normali servizi delle community Visit.

## Convergenza runtime

Visit editoriali e GeneratedVisitPlan convergono sulla stessa VisitSession e sulla stessa VisitShell:

```text
Visit ──────────────┐
                    ├─> VisitSession -> VisitShellView
GeneratedPlan ──────┘
```

Non esistono `GeneratedVisitShell` o `GeneratedSessionSummary` separati.

La `SessionSummaryView` è unica e recuperabile dal backend. Se la sessione deriva da un GeneratedVisitPlan non ancora materializzato, la summary può offrire **“Salva questa visita”**.

## Futuro LLM 18–33

Il futuro LLM non sostituisce il generatore. Produce lo stesso `GenerationRequest` strutturato del form:

```text
form ───────────────┐
                    ├─> GenerationRequest -> generator
LLM / NL future ────┘
```

# Workflow revisionale delle Visit

Le Visit possiedono già un sistema revisionale analogo agli Item.

`Visit` mantiene:

```text
publishedRevisionId
workingRevisionId
```

`VisitRevision.status`:

```text
draft
in_review
changes_requested
published
superseded
```

Le official Visit usano review manageriale; le community Visit mantengono comunque working revision, consistency check e publication senza review manageriale.

# Visibility delle Visit

`Visit.visibility` è un asse stabile separato dallo stato della VisitRevision:

```text
public
unlisted
private
```

Quattro assi restano distinti:

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

Una Visit può avere published revision stabile e working draft contemporaneamente. Gli utenti autorizzati all'esecuzione vedono la published revision, non il draft.

## Public

- compare nei listing/search del Marketplace;
- è scopribile da tutti;
- può essere acquistabile quando l'offerta commerciale lo consente;
- richiede una published revision valida per esposizione/esecuzione pubblica.

## Private

- non compare nel Marketplace;
- non è raggiungibile tramite share link;
- è accessibile solo al proprietario/gestori autorizzati;
- può avere una revisione published ed essere eseguibile dal proprietario.

## Unlisted

- non compare in listing/search;
- è visibile al creatore;
- è raggiungibile tramite condivisione esplicita.

Per la prima implementazione si preferisce un opaque share token e non il semplice `visitId` come segreto.

Concetto backend:

```text
VisitShareLink
  visitId
  tokenHash
  createdBy
  createdAt
  expiresAt?
  revokedAt?
```

Non si introduce subito una ACL nominativa completa se il link risolve il requisito iniziale.

Share access, entitlement ed editing restano distinti: un share link consente di raggiungere la Visit unlisted, ma non equivale automaticamente a entitlement permanente o diritto di modifica.

# UX del Navigator approvata

View principali:

- `LibraryView`;
- `VisitDetailView`;
- `AuthView` login/register con `returnTo`;
- `GenerateVisitView`;
- `GeneratedPlanView`;
- `VisitShellView`;
- `SessionSummaryView`;
- `NotFoundView`.

Il bootstrap config museo + auth avviene a livello app, non tramite view dedicata.

`PresentationRegion` usa esclusivamente `currentPresentation`; testo a schermo e TTS derivano dalla stessa fonte.

Bottoni accessibili e voce selezionano le stesse AvailableAction; non esistono logiche parallele button-vs-voice.

Map e navigation sono panel/region interni; chiudere un pannello è UIIntent e non modifica automaticamente lo stato domain corrispondente.

`paused`, `route_completed` e plan proposal sono stati/overlay della VisitShell; solo `completed` porta alla Summary route.

Loading/error distinguono bootstrap, singola operazione, transport failure, stale runtime, auth, domain outcome e not-found. Un'Action pending non blocca inutilmente l'intera view.

Library gestisce loading, empty, ready, partial failure e auth expired. La failure di una sezione non deve necessariamente bloccare l'intera pagina.

La generazione distingue almeno editing, generating, generated, validation error, domain conflict e transport error. L'assenza di un piano compatibile con i vincoli è un normale outcome di dominio, non un crash.

# Decisioni volutamente ancora aperte

Non sono ancora fissati definitivamente:

- schema TypeScript finale di `ActionDefinition`, `AvailableAction`, `ActionRequest`, `ActionResult` e `InteractionEvent`;
- generazione/forma esatta di `availableActionId`;
- rappresentazione esatta del `RuntimeUpdate` incrementale;
- nomi definitivi di tutte le action family oltre a quelle già approvate;
- forma esatta degli status e schema finale di `NavigationProjection`;
- comportamento UX preciso delle relation query rispetto a `currentPresentation`;
- struttura finale dei componenti Vue all'interno delle view approvate;
- routing e flussi dettagliati del Marketplace/Editor;
- DTO/API esatti dell'Action Gateway, NavigatorRuntimeState, completion summary e session discovery;
- schema esatto del file di configurazione museo e della relativa validazione/bootstrap;
- dettagli di implementazione del refactoring `currentEntryIndex` / `executedThroughEntryIndex`;
- schema Mongo/API definitivo di `VisitEntitlement` e dettagli operativi di grant/revoke;
- dominio commerciale Marketplace (pricing/licensing, Offer/Acquisition/Purchase/Sale o equivalenti);
- forma TypeScript/JSON definitiva di `VisitLibraryProjection` e Navigator Visit Detail Projection;
- schema esatto di `GenerationOptionsProjection`;
- forma esatta del servizio/API di materializzazione `GeneratedVisitPlan -> Visit/VisitRevision`;
- forma esatta di `VisitShareLink`, share token e relativa API;
- eventuale futura ACL nominativa per le Visit unlisted;
- workflow esplicito futuro per ritiro commerciale/revoca/rimborso quando una Visit possiede entitlement esterni.

Questi punti devono essere progettati e approvati prima dell'implementazione corrispondente.
