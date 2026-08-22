# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali e strutturali **approvate** per Navigator e Marketplace/Editor.

L'obiettivo è completare correttamente la fascia 18–24 predisponendo il sistema per 18–27 e 18–33 senza implementare prematuramente le estensioni e senza introdurre scelte che richiedano riscritture future.

## Regola di manutenzione

Questo file è un registro architetturale vivo. Ogni nuova decisione approvata relativa ai client, ai loro contratti con il backend o alle predisposizioni 18–27/18–33 deve essere aggiunta qui. Le proposte non ancora approvate non devono essere presentate come definitive. Le decisioni più recenti sostituiscono formulazioni precedenti incompatibili.

Quando una decisione legacy non è ancora stata riesaminata rispetto al Domain Model v2, viene indicata esplicitamente come **pending** e non deve essere usata come contratto definitivo.

# 1. Principio fondamentale: integrazione con il backend

Ogni proposta frontend o architetturale deve essere verificata rispetto al **backend reale su `main`** prima di essere approvata.

- Il client deve integrarsi con modelli, servizi, revisioni, autorizzazioni e workflow backend realmente implementati.
- Quando il backend offre già una capacità utile, il client deve sfruttarla invece di duplicarne la logica.
- La business logic autorevole rimane nel backend quando appartiene al dominio ArtAround.
- Se una soluzione frontend mette in evidenza un limite reale del backend, va proposta una modifica backend quando produce un sistema complessivamente migliore.
- Sono da preferire refactoring coordinati a workaround frontend.
- Questo principio vale sia per Navigator sia per Marketplace/Editor.

# 2. Principi generali e tecnologie

- Un solo repository e un solo backend Node/Express condiviso.
- Nessun backend separato per Navigator e Marketplace/Editor.
- Architettura 18–24 predisposta per 18–27 e 18–33.
- ArtAround rimane generico rispetto a musei, gallerie ed esposizioni.
- Navigator: Vue, Vite, TypeScript, Vue Router, Pinia.
- Marketplace/Editor: vanilla JavaScript con ES Modules e Web Components; nessun framework UI come Vue/React/Svelte.
- `shared/` può contenere soltanto codice framework-agnostic, contratti, primitive HTTP e schemi realmente comuni; nessuna UI condivisa fra Vue e Web Components.
- Lo stesso backend DTO può essere adattato separatamente nei due client.

# 3. Separazione dei contesti di dominio — approvato, Punto 1/30

Il Navigator e il Marketplace non assumono che una singola entità “museo” possieda contemporaneamente contenuti, semantica e infrastruttura fisica. I client rispettano la separazione del Domain Model v2 fra ownership/authority, EditorialScope e PhysicalScope.

```text
Ownership / authority
  User | Organization

Editorial scope
  EditorialRelease[]
    -> EditorialContext
    -> NamespaceRevision
    -> SemanticGraph
    -> Subject
    -> ItemEdition / ItemRevision

Physical scope
  Venue / VenueRelease[]
    -> VenueTarget
    -> LayoutRevision
    -> Place / routing
```

Un `Venue` non è il proprietario implicito della semantica/editorialità e un `EditorialContext` non implica disponibilità fisica in una Venue. I backend projection/service compongono questi assi quando serve; i client non ne ricostruiscono autonomamente le relazioni.

La parola “museo” può rimanere nella UX quando è il termine comprensibile per l'utente; non deve però tornare a essere un aggregate tecnico universale che contiene implicitamente ownership, contenuti, graph, layout, permission e Marketplace.

## Fonti delle Domain Action

Il protocollo Action rimane:

```text
ActionDefinition
  -> AvailableAction
  -> ActionRequest
  -> ActionResult
  -> InteractionEvent
```

Le Domain `ActionDefinition` vengono risolte dalle fonti autorevoli pertinenti:

- semantica/editorialità: `EditorialRelease`, `NamespaceRevision`, `SemanticGraph`, `Subject`;
- presentazione: `ItemRevision`, `NamespaceRevision`;
- capacità fisiche: `VenueRelease`, `LayoutRevision`, `VenueTarget`;
- controllo visita: `VisitSession`, `SessionPlanRevision`, `ContentEntry`, `VisitAnchor`.

Il client non carica questi aggregate per dedurre autonomamente le azioni disponibili. Il backend compone il contesto e restituisce `AvailableAction[]`.

# 4. Organizzazione logica del Navigator

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

# 5. Sistema Action

È scartato un enum globale di comandi semanticamente hardcoded (`AUTHOR`, `STYLE`, `TOILET`, ecc.). ArtAround deriva le capacità dal dominio e dai dati autorevoli pertinenti.

Action family concettualmente approvate:

```text
relation.query
place.navigate
visit.move
presentation.adjust
```

Le family hanno contratti tipizzati; non è approvato un generico `parameters: any`.

`ActionDefinition` rappresenta una capacità esistente nel dominio. `AvailableAction` rappresenta una capacità concretamente disponibile per quell'utente e quel contesto ed è parte versionata del runtime Navigator.

Ogni `AvailableAction` usa almeno:

- `definitionKey`: identità semantica relativamente stabile per eventi/analytics/diagnostica;
- `availableActionId`: identità contestuale dell'azione disponibile ora.

L'`ActionRequest` contiene almeno `availableActionId`, `expectedRuntimeVersion` ed eventuali input realmente necessari. Il backend ricostruisce e rivalida semantica, availability, authorization e contesto.

`ActionResult` descrive il risultato semantico; `RuntimeUpdate` descrive gli effetti sul runtime. Sono concetti distinti.

Si distinguono:

- **Domain Action**: azione applicativa/domain autorevole lato backend;
- **Client Action**: azione significativa ma realmente locale al device;
- **UIIntent**: comportamento puramente grafico.

Gli UIIntent non diventano artificialmente `ActionDefinition`.

## Action Gateway runtime

È approvato un gateway limitato alle VisitSession, concettualmente:

```text
POST /api/visit-sessions/:sessionId/actions
```

Marketplace/Editor continua a usare endpoint resource-specific.

Il gateway delega a dispatcher e handler tipizzati che riusano i servizi backend esistenti. Non contiene business logic di dominio e non diventa un God service. In futuro gli stessi `ActionRequest` potranno essere trasportati via realtime.

# 6. Pausa, runtime e routing Navigator

La pausa rimane uno stato persistente della VisitSession:

```text
active -> paused -> active
```

Pause/resume sono Domain Action del runtime e riusano i servizi backend esistenti. Non esiste una route Vue `/paused`: l'URL rimane `/sessions/:sessionId` e cambia il runtime autorevole.

`NavigatorRuntimeState` rimane una projection autonoma, minima e autorevole del runtime, non una serializzazione completa della VisitSession.

Sono confermate le separazioni fra:

- runtime corrente;
- `VisitPlanProjection` completa;
- `NavigationProjection` completa;
- stato UI locale.

La forma esatta di `location`, `navigation` e delle destination è **pending** perché verrà riesaminata nei Punti 19–21.

## Store Pinia

Store concettuali approvati:

```text
authStore
configuredVenueStore
runtimeStore
planStore
navigationStore
uiStore
```

Non si creano preventivamente store per speech/TTS/camera/GPS. Si parte da capability/composable locali.

`runtimeStore` installa snapshot e applica `RuntimeUpdate` versionati, rilevando gap/resync; non contiene business logic delle Action. Gli store non si orchestrano direttamente: l'orchestrazione passa dall'application layer.

Non viene introdotto inizialmente un `libraryStore`: la Library può vivere nello stato route/application finché non emerge un reale bisogno di condivisione o caching globale.

## Routing del Navigator

Modello approvato: routing per lifecycle + `VisitShellView` per runtime attivo.

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

`VisitShellView` è la shell del runtime attivo. Mappa, presentation, navigation UI, speech, AvailableAction e pausa non sono route separate. Il bootstrap di una sessione passa dall'application layer e ricostruisce il runtime dal backend autorevole.

18–27: participant/student continua a usare la stessa session route. 18–33: LLM, QR, geolocation e translation restano capability/provider; la generazione visita rimane un workflow pre-visita autonomo.

# 7. Configurazione Venue del Navigator — approvato, Punto 2/30

Navigator è una singola applicazione generica specializzata tramite **file di configurazione statico**. Nel Domain Model v2 l'identificatore canonico di specializzazione è `venueId`, non un generico `museumId`.

Forma concettuale approvata:

```text
NavigatorStaticConfig
  schemaVersion
  venueId
  branding
    title
    shortTitle?
    logo?
      src
      alt
    hero?
      src
      alt
```

Il file contiene soltanto l'identità della Venue configurata e presentation branding statico. Non contiene `Organization`, `EditorialContext`, `ContentSpace`, `Namespace`, `VenueRelease`, `LayoutRevision`, `Item` o `Visit`.

`Venue.primaryEditorialContextId` rimane dominio backend e non viene duplicato nel file statico.

Il `venueId` configurato identifica la Venue primaria dell'istanza Navigator per bootstrap, Library e contesto iniziale, ma non limita una Visit o Session a quella sola Venue. Eventuali ulteriori Venue vengono determinate esplicitamente dalla Visit e dal relativo PhysicalScope.

Non esiste una schermata generica di selezione Venue nel Navigator.

Configurazione di deployment come API URL o URL del Marketplace rimane separata dal file di specializzazione Venue.

# 8. Configured Venue state — approvato, Punto 3/30

Il precedente `museumStore` è sostituito da `configuredVenueStore`.

`configuredVenueStore` rappresenta esclusivamente la Venue primaria determinata dal file statico di configurazione e conserva una projection minima dell'identità e dei dati user-facing realmente necessari globalmente.

Non è un aggregate frontend del dominio e non contiene:

- `EditorialContext` / `EditorialRelease`;
- `Namespace` / `SemanticGraph`;
- `Item` / `Visit`;
- `VenueRelease` / `LayoutRevision` completi;
- le altre Venue coinvolte da una VisitSession.

Il branding statico appartiene alla configurazione dell'applicazione, non al `configuredVenueStore`.

Le Venue aggiuntive di una Visit o Session multi-Venue appartengono a plan/runtime/navigation.

Non vengono introdotti preventivamente `organizationStore`, `editorialContextStore` o altri store globali: nuovi store vengono creati soltanto quando emerge uno stato condiviso con lifecycle applicativo proprio.

# 9. Passaggio Navigator → Marketplace — approvato, Punto 4/30

Il Navigator apre l'unica applicazione Marketplace tramite un application/infrastructure link resolver, senza URL hardcoded nei componenti.

La Venue configurata viene trasferita come **selezione fisica iniziale** del Marketplace, concettualmente:

```text
selectedVenueIds = [configuredVenueId]
```

La scelta di una forma plurale è coerente con il pannello Marketplace multi-Venue richiesto dalle specifiche.

La selezione ricevuta dal Navigator:

- è modificabile dall'utente;
- non costituisce authorization;
- non è un limite permanente del catalogo;
- non determina implicitamente `Organization`, `ContentSpace`, `EditorialContext`, `Namespace` o altri elementi dell'EditorialScope.

Le relazioni fra Venue e asset Marketplace vengono risolte da backend/read model appropriati. Il client non ricostruisce autonomamente relazioni editoriali a partire da `Venue.primaryEditorialContextId`.

Non esistono Marketplace specifici per Venue.

Il destination URL appartiene alla configurazione di deployment, non al `NavigatorStaticConfig`.

Il launch context non contiene credenziali o token. Navigator e Marketplace riusano il normale sistema di autenticazione/sessione del backend condiviso.

# 10. Ownership delle Visit — approvato, Punto 5/30

La precedente distinzione client:

```text
Visit.kind = official | community
```

è **superata** e non viene sostituita da un nuovo enum equivalente.

Una Visit possiede un principal tramite:

```text
ownerType = user | organization
ownerId
```

Ownership, provenance, authorization e workflow rimangono concetti distinti.

Navigator Library e Visit Detail non effettuano branch funzionali su un `kind`. Possono mostrare una owner projection user-facing quando utile, ma l'eseguibilità viene determinata dall'execution access autorevole.

Nel Marketplace/Editor la creazione di una Visit avviene rispetto a un owner principal per cui l'utente possiede authority (`User` o `Organization`), non tramite workflow separati “official” e “community”.

Editing, review, publication e altre operazioni non vengono dedotte nel client dal solo `ownerType`: il backend restituisce le operazioni/capability editoriali disponibili per il contesto e il ruolo corrente.

Generated Visit, copie e fork mantengono ownership e provenance come assi distinti; la loro origine non diventa un `kind` della Visit.

# 11. Entitlement Marketplace v2 — approvato, Punto 6/30

La precedente entità proposta `VisitEntitlement` è **superata**.

ArtAround utilizza il modello Marketplace v2 di `Entitlement` generico, capability-based e applicabile a beneficiari `User | Organization`.

Forma concettuale:

```text
Entitlement
  beneficiaryType: user | organization
  beneficiaryId
  sourceAcquisitionId?
  resourceType
  resourceId
  capability
  versionPolicy: pinned | follow_current
  baselineSnapshotRef?
  validFrom
  validUntil?
  status: active | expired | revoked
```

Per le Visit le capability rilevanti sono almeno:

```text
visit.execute
visit.copy_detached
```

`visit.execute` e `visit.copy_detached` sono diritti distinti; nessuno implica automaticamente l'altro.

`MarketplaceAcquisition` rappresenta l'evento commerciale immutabile; `Entitlement` rappresenta il diritto applicativo enforceable.

Il Navigator non interpreta Acquisition o documenti Entitlement grezzi e non introduce un `entitlementStore`. Library, Visit Detail e Session start usano risultati di authorization già risolti dal backend.

Il fatto che un Offer sia gratuito non concede implicitamente accesso: anche l'acquisizione gratuita produce una `MarketplaceAcquisition` e gli Entitlement previsti dai suoi grant.

Un entitlement su una risorsa composita concede il technical read/access alle dipendenze immutabili necessarie all'esercizio della capability nei limiti della dependency policy, senza concedere automaticamente capability autonome sulle dipendenze.

L'attuale implementazione `visitExecutionAccessV2.service.js`, limitata a ownership e Organization membership, è considerata transitoria fino all'introduzione del commercial authorization core v2 e non costituisce il contratto client definitivo.

# 12. Visit execution access v2 — approvato, Punto 7/30

Il diritto di avviare una VisitSession viene risolto backend-side sulla capability:

```text
visit.execute
```

L'accesso può derivare da due famiglie di authority:

```text
A. resource owner authority
B. Entitlement visit.execute valido
```

## Principal resolution

L'actor autenticato viene risolto rispetto ai principal per cui può agire:

```text
actor User
  -> User principal
  -> eventuali Organization principal autorizzati
```

Per Visit user-owned il proprietario possiede owner authority senza Entitlement artificiale.

Per Visit organization-owned un utente con ruolo organizzativo sufficiente può agire come Organization owner. Nel modello iniziale `operator` e `manager` sono entrambi idonei all'esecuzione.

La membership non è un diritto Marketplace autonomo: serve alla principal/authority resolution.

Gli Entitlement possono avere beneficiary `user` o `organization`. Un Entitlement Organization-scoped non viene trasformato in Entitlement personali dei membri; viene esercitato da utenti autorizzati ad agire come quel principal.

## Authorization service

La logica comune di:

- principal resolution;
- ownership/authority;
- Entitlement;
- capability;
- version scope;
- status/expiry/revocation;

va centralizzata in un `CapabilityAuthorizationService` o equivalente.

`VisitExecutionAccessService` rimane un boundary application-specific che richiede `visit.execute` e applica gli invarianti specifici dell'esecuzione della Visit.

## Contratto verso Navigator

Navigator non interpreta membership, Entitlement o Acquisition.

Le projection autorizzate espongono soltanto lo stato user-facing necessario. Un accesso negato produce un errore stabile come:

```text
VISIT_EXECUTION_ACCESS_REQUIRED
```

Il Navigator non deve ricevere, solo per decidere se può iniziare una visita, dettagli interni come `entitlementId`, Organization role, `sourceAcquisitionId` o principal-resolution internals.

`startSession()` rivalida sempre l'authorization e non si fida di una precedente Library o Visit Detail autorizzata.

## Authorization vs Library discovery

```text
can execute
!= must appear in Library
```

L'authorization risponde alla domanda “posso avviare questa Visit?”. La Library projection decide separatamente quali Visit è utile mostrare all'utente. La forma definitiva della Library viene riesaminata al Punto 10/30.

## Predisposizione 18–27

`visit.execute` autorizza l'avvio di una VisitSession dalla Visit. Non viene riusato come diritto di partecipazione alle future sessioni sincronizzate 18–27.

Lo studente che entra in una sessione tramite il meccanismo didattico previsto non deve necessariamente possedere un Entitlement personale `visit.execute`; la session participation authority è un concetto separato.

# 13. Decisioni runtime/client ancora confermate

Restano approvate e non vengono riaperte salvo conflitto esplicito con i successivi punti:

- Vue/Vite/TypeScript/Vue Router/Pinia per Navigator;
- vanilla JS/ESM/Web Components per Marketplace/Editor;
- architettura Navigator `domain/application/capabilities/infrastructure/UI`;
- API adapter/repository specifici, nessun God `ApiService`;
- protocollo Action e principio dell'Action Gateway;
- `AvailableAction[]` condivise fra voce e bottoni;
- `currentPresentation` come unica fonte per testo a schermo e TTS;
- routing per lifecycle e `VisitShellView`;
- pause/resume nella stessa session route;
- server authoritative refresh/resume;
- distinzione `currentEntryIndex` / `executedThroughEntryIndex`;
- runtime projection ridotta e separazione runtime/plan/navigation;
- nessun routing/timing autorevole ricalcolato nel client;
- Visit e GeneratedPlan convergono sulla stessa VisitSession/VisitShell;
- future capability LLM/QR/geolocation/translation non richiedono una riscrittura del routing principale.

# 14. Boundary Navigator già approvati ma con schema v2 pending

Rimangono approvati come responsabilità, ma i DTO esatti verranno aggiornati nei successivi punti:

## Library

- landing operativa personale del Navigator;
- distinta dal Marketplace;
- usa projection backend dedicate, non documenti Mongo grezzi;
- sessioni riprendibili e Visit disponibili sono contratti distinti;
- la Venue configurata è contesto iniziale, non aggregate universale.

La forma definitiva di `VisitLibraryProjection` è **pending Punto 10/30**.

## Navigator Visit Detail

Rimane approvata una projection Navigator dedicata, autenticata, composita e access-first. Il client non deve usare il DTO editoriale grezzo della Visit come read model principale.

Rimangono approvati:

- authorization prima di dati personali/preparation/logistics;
- projection ridotta per preparazione;
- backend recomputation delle stime;
- una singola revisione eseguibile coerente per request;
- `startSession()` come boundary finale che rivalida accesso e consistenza.

La forma definitiva della Visit Detail è **pending Punti 8, 11–18/30**.

# 15. Generazione e UX Navigator ancora approvate

Il workflow di generazione rimane distinto:

```text
/generate
/generated-plans/:planId
```

Il client usa il generator backend esistente e non implementa scoring/planning.

`GenerateVisitView` usa un form strutturato e generico, non una chat. Il futuro LLM produce lo stesso request model strutturato invece di creare un percorso applicativo parallelo.

`GeneratedPlanView` è una preview recuperabile del piano, non l'esposizione del documento Mongo grezzo.

Visit editoriali e GeneratedVisitPlan convergono sulla stessa VisitSession e sulla stessa VisitShell.

La materializzazione `GeneratedVisitPlan -> Visit` è **pending Punto 24/30**; i vecchi concetti `kind = community` e `visibility = private` non sono più validi come contratto definitivo.

# 16. Decisioni legacy esplicitamente superseded

Le seguenti formulazioni non devono più essere usate come contratto definitivo:

- `museumId` come aggregate tecnico universale;
- `museumStore`;
- `Visit.kind = official | community`;
- `VisitEntitlement` specializzato;
- `acquisitionType` come semantica centrale dell'execution access;
- Organization membership trattata direttamente come entitlement commerciale;
- Marketplace specifico per museo/Venue;
- `Venue.primaryEditorialContextId` duplicato nella config Navigator.

Ulteriori concetti legacy saranno eliminati o adattati man mano che vengono approvati i Punti 8–30.

# 17. Punti ancora da riesaminare — non definitivi

La seguente lista rappresenta il lavoro architetturale ancora aperto. Le vecchie formulazioni del documento precedente relative a questi temi non sono definitive se confliggono con Domain Model v2 / Marketplace Domain v2.

8. version policy dell'esecuzione (`follow_current`, pinned snapshot, Visit/VisitRevision);
9. rimozione della vecchia `Visit.visibility` e degli share link dal percorso 18–24 corrente;
10. `VisitLibraryProjection` Venue-aware e capability-aware;
11. `NavigatorVisitDetailProjection` v2;
12. unificazione della presentation preparation senza official/community;
13. preparation override non persistente e rimozione della vecchia per-Visit preference persistita;
14. `NavigationPreparationResolver` su VenueRelease/LayoutRevision;
15. navigation multi-Venue e `canonicalKey`;
16. pre-visit information da VenueRelease + Visit notes;
17. `LogisticsPreview` v2;
18. execution/preparation context coerente e pin delle dipendenze;
19. navigation destination tipizzata;
20. runtime location VenueTarget/anchor-centric;
21. mappe basate su VenueTarget placement;
22. Action derivation aggiornata per tutti i source v2;
23. `GenerationOptionsProjection` scope-aware e authorization-aware;
24. materializzazione GeneratedPlan -> user-owned Visit v2;
25. workflow Visit user/organization-owned;
26. consumer/creator Marketplace projections sul commercial domain v2;
27. authoring/acquisition con reference/import/copy/fork distinti;
28. Item authoring Subject/ItemEdition/Revision/VenueTarget;
29. mapping UX “museo” -> selezione Venue fisica;
30. pulizia finale delle decisioni aperte e dei residui legacy.

Restano inoltre da fissare gli schemi TypeScript/JSON esatti di `ActionDefinition`, `AvailableAction`, `ActionRequest`, `ActionResult`, `InteractionEvent`, `RuntimeUpdate`, completion summary e session discovery, senza riaprire la semantica già approvata.