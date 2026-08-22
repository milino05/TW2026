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
EDITORIAL
VisitRevision.status

LIFECYCLE
Visit.lifecycleStatus

DISCOVERY / DISTRIBUTION
MarketplaceListing.status

COMMERCIAL AVAILABILITY
MarketplaceOffer.status

ACCESS
owner authority | Entitlement | future explicit grant | session participation
```

La discoverability nel Marketplace è determinata da `MarketplaceListing`; le condizioni di acquisizione da `MarketplaceOffer`; il diritto applicativo da ownership/authority o `Entitlement`. L’assenza di Listing rappresenta naturalmente una Visit non pubblicata nel catalogo. Il withdrawal di un Listing non modifica lifecycle/publication editoriale e non revoca automaticamente Entitlement validi.

Non viene implementato nel percorso corrente un meccanismo `unlisted` basato su share token. Eventuali future condivisioni dirette devono essere modellate come access grant/invitation coerenti con il `CapabilityAuthorizationService`, oppure come session participation nei flussi 18–27.

Le Visit/contenuti privati richiesti dal 18–27 possono essere owned e published per l’esecuzione senza MarketplaceListing; gli studenti accedono alla Session sincronizzata tramite il relativo meccanismo di partecipazione.

# Runtime/UX confermati

- `NavigatorRuntimeState` resta projection minima e autorevole.
- `runtimeStore` applica snapshot/RuntimeUpdate versionati; niente business logic Action negli store.
- Nessun `libraryStore` iniziale salvo reale necessità futura.
- Route concettuali: `/`, auth, `/library`, `/visits/:visitId`, `/generate`, `/generated-plans/:planId`, `/sessions/:sessionId`, summary, 404.
- `currentEntryIndex` e `executedThroughEntryIndex` restano distinti.
- GeneratedPlan deve essere `accepted` prima dello start.
- LLM futuro produce lo stesso request model strutturato del form di generazione.

# Boundary già approvati ma con schema v2 pending

## Library
Landing personale, distinta dal Marketplace, basata su projection backend. Sessioni riprendibili e Visit disponibili restano contratti distinti. Forma definitiva pending Punto 10.

## Navigator Visit Detail
Projection dedicata, autenticata, access-first e composita. Authorization prima di preparation/logistics; backend recomputation; una singola revisione eseguibile coerente per request; `startSession()` boundary finale. Forma definitiva pending Punti 11–18.

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
- `VisitShareLink` come meccanismo corrente.

# Punti 10–30 ancora da riesaminare

10. `VisitLibraryProjection` Venue-aware e capability-aware;
11. `NavigatorVisitDetailProjection` v2;
12. presentation preparation unificata;
13. preparation override non persistente;
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