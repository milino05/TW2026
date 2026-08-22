# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali **approvate** per Navigator e Marketplace/Editor. Le decisioni più recenti sostituiscono formulazioni precedenti incompatibili. I temi non ancora riesaminati rispetto al Domain Model v2 sono **pending** e non costituiscono contratto definitivo.

# Principi generali confermati

- Un solo backend Node/Express condiviso.
- Navigator: Vue, Vite, TypeScript, Vue Router, Pinia.
- Marketplace/Editor: vanilla JavaScript, ES Modules, Web Components.
- Navigator organizzato in `domain / application / capabilities / infrastructure / UI`.
- Repository/adapter specifici; nessun God `ApiService`.
- Business logic, authorization, routing e timing autorevoli nel backend.
- Protocollo Action: `ActionDefinition -> AvailableAction -> ActionRequest -> ActionResult -> InteractionEvent`.
- `AvailableAction[]` condivise fra voce e bottoni; `currentPresentation` è unica fonte per UI e TTS.
- Routing per lifecycle con `VisitShellView`; pause/resume sulla stessa session route.
- Runtime server-side separato da `VisitPlanProjection` e `NavigationProjection`.
- Visit e GeneratedVisitPlan convergono sulla stessa VisitSession/VisitShell.
- 18–27/18–33 devono entrare come capability/provider senza riscrivere il core client.

# Punto 1/30 — Separazione dei contesti di dominio

I client non assumono un aggregate tecnico universale “museo”.

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

Il backend compone gli assi; i client non ricostruiscono autonomamente tali relazioni. Le Domain Action derivano dalle rispettive fonti autorevoli editoriali, fisiche e runtime.

# Punto 2/30 — Configurazione statica del Navigator

```text
NavigatorStaticConfig
  schemaVersion
  venueId
  branding
```

Il file non contiene Organization, EditorialContext, ContentSpace, Namespace, VenueRelease, LayoutRevision, Item o Visit. `Venue.primaryEditorialContextId` resta backend. `venueId` identifica la Venue primaria di bootstrap/contesto iniziale ma non limita Visit/Session multi-Venue. API URL e Marketplace URL appartengono alla configurazione di deployment.

# Punto 3/30 — Configured Venue state

`museumStore` è sostituito da `configuredVenueStore`.

```text
authStore
configuredVenueStore
runtimeStore
planStore
navigationStore
uiStore
```

`configuredVenueStore` contiene solo una projection minima della Venue configurata. Non contiene EditorialContext, graph, Item, Visit, VenueRelease/LayoutRevision completi o altre Venue della Session. Branding statico resta nella config applicativa. Nessun `organizationStore` o `editorialContextStore` preventivo.

# Punto 4/30 — Navigator → Marketplace

Il Navigator apre l’unica applicazione Marketplace tramite link resolver application/infrastructure. La Venue configurata viene trasferita come selezione fisica iniziale:

```text
selectedVenueIds = [configuredVenueId]
```

La selezione è modificabile, non è authorization, non limita permanentemente il catalogo e non determina implicitamente Organization, ContentSpace, EditorialContext o Namespace. Nessun Marketplace specifico per Venue. Nessun token/credenziale nel launch context.

# Punto 5/30 — Ownership delle Visit

`Visit.kind = official | community` è superato e non viene sostituito da un enum equivalente.

```text
ownerType = user | organization
ownerId
```

Ownership, provenance, authorization e workflow restano distinti. Library e Visit Detail non fanno branch su `kind`. Marketplace/Editor crea Visit rispetto a un owner principal autorizzato. Review/publication/editing vengono esposte tramite operazioni/capability backend, non dedotte dal solo `ownerType`.

# Punto 6/30 — Entitlement Marketplace v2

`VisitEntitlement` specializzato è superato. Si usa l’`Entitlement` generico capability-based:

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

Per Visit almeno `visit.execute` e `visit.copy_detached`, distinti fra loro. `MarketplaceAcquisition` è evento commerciale immutabile; `Entitlement` è diritto applicativo. Navigator non interpreta documenti Acquisition/Entitlement grezzi e non introduce un `entitlementStore`. Anche un Offer gratuito richiede Acquisition esplicita per produrre i grant previsti.

# Punto 7/30 — Visit execution access v2

Il diritto di avviare una VisitSession viene risolto backend-side sulla capability `visit.execute`.

```text
A. resource owner authority
B. Entitlement visit.execute valido
```

L’actor viene risolto nei principal per cui può agire: User e, se autorizzato, Organization. Per Visit user-owned il proprietario ha owner authority senza Entitlement artificiale. Per Visit organization-owned, nel modello iniziale `operator` e `manager` possono agire come Organization owner per l’esecuzione. La membership serve alla principal resolution e non è un entitlement commerciale.

Gli Entitlement Organization-scoped non vengono copiati sui membri. Principal resolution, ownership, Entitlement, capability, version scope e status vanno centralizzati in un `CapabilityAuthorizationService` o equivalente. `VisitExecutionAccessService` resta boundary application-specific per `visit.execute`.

Navigator non riceve dettagli interni come entitlementId, role o sourceAcquisitionId solo per sapere se può iniziare. `startSession()` rivalida sempre l’authorization. `can execute != must appear in Library`. Per 18–27, `visit.execute` autorizza l’avvio della Session, non la partecipazione dello studente.

# Punto 8/30 — Version policy dell’esecuzione

`visit.execute` può autorizzare una lineage `Visit` con `follow_current` oppure una snapshot `VisitRevision` pinned. Un grant `pin_at_acquisition` su Visit live viene risolto all’acquisizione nella VisitRevision corrente e produce un diritto pinned.

Prima di Library Detail/preparation/start il backend risolve sempre una specifica revisione eseguibile:

```text
ResolvedVisitExecutionSource
  visitId
  visitRevisionId
  authorization
  versionResolution
```

Il Navigator non deduce la revisione da `Visit.publishedRevisionId`. Per owner authority e `follow_current`, una nuova preparation risolve normalmente la published revision corrente. Una volta iniziata la preparation, la revisione resta stabile; `startSession()` rivalida la stessa revisione attesa e non la sostituisce silenziosamente.

Una Session avviata pinna definitivamente la VisitRevision e le dipendenze editoriali necessarie. La VisitRevision pinned non congela implicitamente un vecchio stato fisico: VenueRelease/LayoutRevision coerenti vengono risolte allo start e poi pinzate nella Session.

# Punto 9/30 — Discoverability e distribuzione delle Visit

`Visit.visibility = public | unlisted | private` e `VisitShareLink` sono rimossi dall’architettura approvata e non vengono sostituiti da un nuovo asse di visibility.

Una Visit può avere una VisitRevision published ed essere eseguibile dal proprio owner senza essere pubblicamente distribuita. Gli assi restano separati:

```text
EDITORIAL             VisitRevision.status
LIFECYCLE             Visit.lifecycleStatus
DISCOVERY             MarketplaceListing.status
COMMERCIAL AVAILABILITY MarketplaceOffer.status
ACCESS                owner authority | Entitlement | future explicit grant | session participation
```

La discoverability nel Marketplace è determinata da `MarketplaceListing`; le condizioni di acquisizione da `MarketplaceOffer`; il diritto applicativo da ownership/authority o `Entitlement`. L’assenza di Listing rappresenta naturalmente una Visit non pubblicata nel catalogo. Il withdrawal di un Listing non modifica lifecycle/publication editoriale e non revoca automaticamente Entitlement validi.

Non viene implementato nel percorso corrente un meccanismo `unlisted` basato su share token. Eventuali future condivisioni dirette devono essere modellate come access grant/invitation coerenti con il `CapabilityAuthorizationService`, oppure come session participation nei flussi 18–27.

# Punto 10/30 — Navigator Visit Library v2

Il Navigator usa una projection backend dedicata, concettualmente:

```text
GET /navigator/visit-library?venueId=:configuredVenueId
```

La Venue configurata è contesto fisico di discovery/applicabilità, non authorization e non limite del PhysicalScope.

La Library personale include normalmente:

```text
1. Visit owned direttamente dal current User
2. Visit / VisitRevision coperte da Entitlement diretto visit.execute del current User
```

L’authority derivata da Organization membership o da Entitlement Organization-scoped può autorizzare l’esecuzione ma non popola automaticamente la Library personale. Authorization e Library membership restano distinti; non viene introdotto un `LibraryMembership` persistente.

Per ogni candidate il backend risolve prima una specifica `ResolvedVisitExecutionSource`, quindi deriva il PhysicalScope da `VisitAnchor -> VenueTarget -> Venue`. Una Visit è applicabile alla Library se la configured Venue appartiene al PhysicalScope della revisione risolta. Visit multi-Venue rimangono supportate.

La normale Library mostra soltanto Visit il cui intero PhysicalScope è attualmente coerente per la preparazione. La logica `VisitAnchor -> VenueTarget -> VenueRelease` deve essere centralizzata in un resolver fisico riusabile da integrity, Library, Visit Detail e `startSession()`.

Forma concettuale minima:

```text
NavigatorVisitLibraryProjection
  context.venue { id, name }
  visits[]
    visitId
    resolvedRevisionId
    title
    description?
    owner? { type, id, displayName }
    physicalScope
      venues[] { id, name }
      isMultiVenue
```

La projection non espone `kind`, `visibility`, `museumIds`, acquisition type, documenti Entitlement/Marketplace, VisitRevision grezza o strutture fisiche complete. `resolvedRevisionId` garantisce consistenza della singola risposta Library ma non prenota quella revisione per la successiva Detail. Le sessioni riprendibili restano un contratto separato.

# Punto 11/30 — Navigator Visit Detail v2

Il Navigator usa una read API dedicata, autenticata e composita, concettualmente:

```text
GET /navigator/visits/:visitId?venueId=:configuredVenueId
```

La configured Venue è contesto fisico di preparazione, non limite del PhysicalScope. Il backend autentica l’actor, risolve una specifica `ResolvedVisitExecutionSource`, verifica l’applicabilità fisica alla Venue configurata e costruisce tutte le sotto-projection rispetto alla stessa `VisitRevision`.

Pipeline concettuale:

```text
request
  -> authentication
  -> configured Venue context
  -> resolveVisitExecutionSource()
  -> specific VisitRevision R
  -> physical applicability
  -> preparation composition
  -> NavigatorVisitDetailProjection
```

La response è strutturata nei boundary:

```text
NavigatorVisitDetailProjection
  context
    venue
    source
      visitId
      visitRevisionId
    preparationHandle?       # forma pending Punto 18

  visit
    id
    revisionId
    title
    description?
    owner?
    physicalScope
      venues[]
      isMultiVenue

  preVisit
    venues[]
    visitNotes[]

  preparation
    presentation             # Punti 12–13
    navigation               # Punti 14–15
    adaptiveLearning

  logistics                  # Punto 17

  readiness
    canStart
    blockers[]
```

`visit` espone summary della revisione risolta, owner user-facing e PhysicalScope in forma di Venue leggibili. Non espone `kind`, `visibility`, review/integrity internals, `editorialSources`, `contentEntries`, `VisitAnchor`, `VenueTarget`, `VenueRelease` o `LayoutRevision` grezzi.

`preVisit` preserva la provenienza distinguendo le informazioni strutturali delle `VenueRelease` dalle note specifiche della `VisitRevision`; la semantica dettagliata viene definita al Punto 16.

La normale response non contiene `access.basis`, acquisition type o dettagli Entitlement: l’authorization avviene prima della projection. `readiness` rappresenta invece la possibilità applicativa di iniziare nel contesto corrente e può esporre blocker user-facing. Unauthorized normalmente produce `403`; una Visit non applicabile alla configured Venue produce un domain outcome dedicato; una Visit autorizzata/applicabile ma temporaneamente non startable può restituire la Detail con `readiness.canStart = false` quando una projection coerente è comunque producibile.

L’ingresso nella Detail usa una singola GET composita. Il read model non è un write model generico: gli update della preparation passano da command/use case specifici o dal preparation draft definito successivamente. I contenuti completi della Visit non vengono riversati nella fase pre-visita. Per 18–27 la Detail rimane il workflow di chi avvia la Session; gli studenti possono entrare direttamente nel lifecycle della Session tramite il futuro join flow.

# Punto 12/30 — Presentation preparation unificata

Navigator e backend non distinguono presentation logic in base a `Visit.kind`, `ownerType` o provenienza della Visit. Tutte le Visit usano lo stesso presentation domain.

La preference iniziale è namespace-neutral e usa gli assi astratti:

```text
depthPreference: 0..1
languageComplexityPreference: 0..1
locale?
```

La precedence viene applicata campo per campo:

```text
ItemRevision.defaultPresentation
  < VisitRevision.presentationBaseline
  < User.defaultPresentationPreference
  < preparation override
```

`ItemRevision.defaultPresentation` rimane il fallback concreto del singolo contenuto. `VisitRevision.presentationBaseline`, default utente e override di preparation esprimono invece preferenze astratte.

Il backend traduce tali preferenze nelle `Representation` concrete usando la `NamespaceRevision` pertinente a ciascuna ContentEntry. Il client non utilizza `durationKey`, `languageLevelKey` o una tassonomia Namespace globale: una Visit può combinare contenuti provenienti da Namespace differenti, con proprie definizioni di durata e livello linguistico.

`PresentationVariant` e `Representation` restano distinti. La selezione della Variant appartiene alla logica semantica/adaptive/planning; depth, language complexity e locale adattano la Representation all’interno della Variant risolta. Il normale Navigator non espone `variantId`, `representationId`, `durationTypeDefinitionId` o `languageLevelDefinitionId` nella preparation.

`NavigatorVisitDetailProjection.preparation.presentation` espone la preference astratta effettiva e i controlli user-facing realmente supportati dal backend, concettualmente:

```text
preparation.presentation
  effectivePreference
    depthPreference?
    languageComplexityPreference?
    locale?
  availableControls
    depth
    languageComplexity
    locale
```

I nomi JSON esatti possono essere raffinati. Un campo può restare assente quando nessun layer globale lo specifica; non si inventa automaticamente un valore neutro se il singolo Item dispone già del proprio default concreto.

Le locale realmente utilizzabili vengono risolte backend-side; Vue non analizza tutte le Representation per calcolarle. Il futuro translation provider 18–33 potrà ampliare le opzioni senza cambiare il contratto concettuale.

La Visit Detail non riceve il presentation plan completo per tutte le ContentEntry. Preparation e runtime usano lo stesso resolver: le Action runtime `presentation.adjust` modificano la concrete presentation senza introdurre una pipeline parallela. `currentPresentation.text` rimane l’unica fonte sia per il testo visualizzato sia per il TTS.

Il servizio v2 esistente di presentation resolution è il nucleo da riusare/rifattorizzare, non da duplicare in resolver separati per Visit user-owned/organization-owned o per vecchie categorie official/community.

# Punto 13/30 — Preparation override temporaneo

ArtAround non introduce preference persistenti per la coppia User–Visit. Le responsabilità restano separate:

```text
EDITORIAL DEFAULT
VisitRevision.presentationBaseline
        ↓
USER GLOBAL DEFAULT
User.defaultPresentationPreference
User.defaultNavigationPreference
        ↓
CURRENT PREPARATION DRAFT
session-specific override
```

Le modifiche effettuate nella Visit Detail appartengono a un `PreparationDraft` temporaneo relativo alla futura Session, non alla Visit e non al profilo permanente dell’utente.

Concettualmente:

```text
PreparationDraft
  source
    visitId
    visitRevisionId
  presentationOverride?
  navigationOverride?
  futureStartOptions?
```

Il draft è application state, non un nuovo aggregate editoriale/commerciale e non richiede inizialmente una collection Mongo dedicata. Parte senza override espliciti: il backend calcola comunque i valori effettivi da baseline e default globali. Le projection devono poter distinguere `effectivePreference` dall’override esplicito scelto nella preparation corrente.

Presentation e navigation applicano gli override campo per campo sopra i rispettivi default. Non vengono introdotti `UserVisitPreference`, `VisitPreference` o endpoint il cui significato sia salvare permanentemente preference User–Visit.

Ogni modifica che influenza presentation, routing o timing viene rivalutata backend-side e produce una nuova preparation/logistics preview; Vue non modifica autonomamente tempi o percorso.

`startSession()` usa la stessa preparation corrente e materializza il risultato nel `VisitSession` / `SessionPlan`. Avviare una Session non modifica automaticamente i default globali dell’utente. Un eventuale comando “usa come default” è un use case esplicito e distinto che aggiorna il profilo globale.

La persistenza tecnica temporanea del draft — route/application state, `sessionStorage` o backend preparation handle — resta da definire al Punto 18. Qualunque soluzione venga scelta, `temporary preparation state != durable User preference != Visit domain state`.

I consent/preference di adaptive learning mantengono la propria semantica globale e non vengono automaticamente assimilati agli override occasionali della preparation.

# Runtime/UX confermati

- `NavigatorRuntimeState` resta projection minima e autorevole.
- `runtimeStore` applica snapshot/RuntimeUpdate versionati; niente business logic Action negli store.
- Nessun `libraryStore` iniziale salvo reale necessità futura.
- Route concettuali: `/`, auth, `/library`, `/visits/:visitId`, `/generate`, `/generated-plans/:planId`, `/sessions/:sessionId`, summary, 404.
- `currentEntryIndex` e `executedThroughEntryIndex` restano distinti.
- GeneratedPlan deve essere `accepted` prima dello start.
- LLM futuro produce lo stesso request model strutturato del form di generazione.

# Legacy esplicitamente superseded

Non devono più essere usati come contratto definitivo:

- `museumId` come aggregate universale;
- `museumStore`;
- `Visit.kind = official | community`;
- `VisitEntitlement` specializzato;
- `acquisitionType` come semantica centrale dell’execution access;
- Organization membership trattata direttamente come entitlement commerciale;
- Marketplace specifico per museo/Venue;
- `Venue.primaryEditorialContextId` duplicato nella config Navigator;
- assunzione `visitId -> latest published revision` valida per ogni accesso;
- `Visit.visibility = public | unlisted | private`;
- `VisitShareLink` come meccanismo corrente;
- `museumIds[]` come filtro fisico della Library;
- `access.basis` / `acquisitionType` nella Library o Visit Detail Navigator;
- uso del DTO editoriale grezzo `GET /visits/:visitId` come read model principale del Navigator;
- presentation pipeline separate `official/community`;
- preference globali basate su `durationKey` / `languageLevelKey` di un singolo Namespace;
- preference persistenti User–Visit per presentation/navigation.

# Punti 14–30 ancora da riesaminare

14. `NavigationPreparationResolver` su VenueRelease/LayoutRevision;
15. navigation multi-Venue e `canonicalKey`;
16. pre-visit information da VenueRelease + Visit notes;
17. `LogisticsPreview` v2;
18. execution/preparation context e pin dipendenze;
19. navigation destination tipizzata;
20. runtime location VenueTarget/anchor-centric;
21. mappe basate su VenueTarget placement;
22. Action derivation completa dai source v2;
23. `GenerationOptionsProjection` scope/authorization-aware;
24. materializzazione GeneratedPlan -> user-owned Visit v2;
25. workflow Visit user/organization-owned;
26. consumer/creator Marketplace projections;
27. reference/import/copy/fork;
28. Item authoring Subject/Edition/Revision/VenueTarget;
29. mapping UX “museo” -> Venue selection;
30. pulizia finale residui legacy e decisioni aperte.

Restano inoltre da fissare gli schemi TypeScript/JSON esatti di Action, RuntimeUpdate, completion summary e session discovery senza riaprire la semantica già approvata.
