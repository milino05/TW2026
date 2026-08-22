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

I client non assumono un aggregate tecnico universale “museo”. Ownership/authority (`User | Organization`), editorial scope (`EditorialRelease -> EditorialContext -> NamespaceRevision -> Subject/Item`) e physical scope (`Venue/VenueRelease -> VenueTarget -> LayoutRevision`) restano distinti. Il backend compone gli assi; i client non ricostruiscono autonomamente tali relazioni.

# Punto 2/30 — Configurazione statica del Navigator

`NavigatorStaticConfig` contiene soltanto `schemaVersion`, `venueId` e branding. Non contiene Organization, EditorialContext, ContentSpace, Namespace, VenueRelease, LayoutRevision, Item o Visit. `venueId` identifica la Venue primaria di bootstrap/contesto iniziale ma non limita Visit/Session multi-Venue. API URL e Marketplace URL appartengono alla configurazione di deployment.

# Punto 3/30 — Configured Venue state

`museumStore` è sostituito da `configuredVenueStore`. Store concettuali: `authStore`, `configuredVenueStore`, `runtimeStore`, `planStore`, `navigationStore`, `uiStore`. `configuredVenueStore` contiene solo una projection minima della Venue configurata; branding statico resta nella config applicativa. Nessun `organizationStore` o `editorialContextStore` preventivo.

# Punto 4/30 — Navigator → Marketplace

Il Navigator apre l’unica applicazione Marketplace tramite link resolver application/infrastructure e passa `selectedVenueIds=[configuredVenueId]` come selezione fisica iniziale modificabile. Non è authorization, non limita permanentemente il catalogo e non determina implicitamente Organization, ContentSpace, EditorialContext o Namespace. Nessun token/credenziale nel launch context.

# Punto 5/30 — Ownership delle Visit

`Visit.kind = official | community` è superato e non viene sostituito da un enum equivalente. La Visit usa `ownerType = user | organization` e `ownerId`; ownership, provenance, authorization e workflow restano distinti. Library/Detail non fanno branch su `kind`; review/publication/editing vengono esposte tramite operazioni/capability backend.

# Punto 6/30 — Entitlement Marketplace v2

`VisitEntitlement` specializzato è superato. Si usa l’`Entitlement` generico capability-based con beneficiary user/organization, resource, capability, version policy, validity e status. Per Visit almeno `visit.execute` e `visit.copy_detached`, distinti. `MarketplaceAcquisition` è evento commerciale immutabile; `Entitlement` è diritto applicativo. Navigator non interpreta documenti Acquisition/Entitlement grezzi e non introduce un `entitlementStore`.

# Punto 7/30 — Visit execution access v2

L’avvio di una VisitSession richiede `visit.execute`, risolto backend-side tramite owner authority oppure Entitlement valido. L’actor viene risolto nei principal User e Organization per cui può agire; per Visit organization-owned, inizialmente `operator` e `manager` possono eseguire come Organization owner. Membership è principal resolution, non entitlement commerciale. La logica comune va centralizzata in `CapabilityAuthorizationService`; `VisitExecutionAccessService` resta boundary application-specific. `startSession()` rivalida sempre. `can execute != must appear in Library`. Nel 18–27 la partecipazione dello studente è authority di Session separata da `visit.execute`.

# Punto 8/30 — Version policy dell’esecuzione

`visit.execute` può autorizzare una Visit live `follow_current` oppure una `VisitRevision` pinned. Un grant `pin_at_acquisition` su Visit live viene risolto all’acquisizione nella revision corrente e produce un diritto pinned. Prima di Library Detail/preparation/start il backend risolve una specifica `ResolvedVisitExecutionSource { visitId, visitRevisionId, ... }`; Navigator non deduce la revision da `Visit.publishedRevisionId`.

Per owner authority e `follow_current`, una nuova preparation risolve normalmente la published revision corrente; una volta iniziata, la revision resta stabile e `startSession()` rivalida la stessa revision attesa. La Session pinna definitivamente VisitRevision e dipendenze editoriali. VenueRelease/LayoutRevision vengono invece risolte come stato fisico coerente allo start e poi pinzate nella Session: una VisitRevision pinned non congela implicitamente un vecchio layout.

# Punto 9/30 — Discoverability e distribuzione delle Visit

`Visit.visibility = public | unlisted | private` e `VisitShareLink` sono rimossi. Gli assi restano separati: publication editoriale (`VisitRevision.status`), lifecycle (`Visit.lifecycleStatus`), discoverability (`MarketplaceListing.status`), disponibilità commerciale (`MarketplaceOffer.status`) e accesso (owner authority, Entitlement, future grant, session participation).

L’assenza di Listing rappresenta naturalmente una Visit non pubblicata nel catalogo. Il withdrawal di un Listing non modifica lifecycle/publication editoriale e non revoca automaticamente Entitlement validi. Nessun share token `unlisted` nel percorso corrente; future condivisioni dirette dovranno integrarsi con authorization oppure con session participation 18–27.

# Punto 10/30 — Navigator Visit Library v2

Il Navigator usa una projection backend dedicata, concettualmente `GET /navigator/visit-library?venueId=:configuredVenueId`. La configured Venue è contesto fisico di discovery/applicabilità, non authorization e non limite del PhysicalScope.

La Library personale include normalmente Visit owned direttamente dal current User e Visit/VisitRevision coperte da Entitlement diretto `visit.execute` del current User. Organization authority/Entitlement organization-scoped possono autorizzare l’esecuzione ma non popolano automaticamente la Library personale.

Per ogni candidate il backend risolve prima una `ResolvedVisitExecutionSource`, poi deriva il PhysicalScope da `VisitAnchor -> VenueTarget -> Venue`. La Visit è applicabile se la configured Venue appartiene al PhysicalScope e l’intero scope è attualmente coerente. La logica fisica va centralizzata in un resolver riusabile da integrity, Library, Detail e startSession. La card espone summary user-facing, `visitId`, `resolvedRevisionId`, owner summary e Venue coinvolte; non espone kind/visibility/museumIds/acquisition/Entitlement o strutture fisiche grezze. Sessioni riprendibili restano un contratto separato.

# Punto 11/30 — Navigator Visit Detail v2

Il Navigator usa una read API dedicata, autenticata e composita, concettualmente `GET /navigator/visits/:visitId?venueId=:configuredVenueId`. Il backend autentica, risolve la `ResolvedVisitExecutionSource`, verifica applicabilità fisica e costruisce tutte le sotto-projection rispetto alla stessa VisitRevision.

Boundary concettuali: `context`, `visit`, `preVisit`, `preparation`, `logistics`, `readiness`. `visit` contiene summary, owner user-facing e PhysicalScope; non espone VisitRevision/contentEntries/anchors/target/release/layout grezzi. `preVisit` distingue informazioni VenueRelease da note VisitRevision. L’authorization precede la projection; la response normale non espone `access.basis` o dettagli Entitlement. `readiness` rappresenta invece eventuali blocker applicativi. Una sola GET iniziale compone la Detail; il read model non è un write model generico.

# Punto 12/30 — Presentation preparation unificata

Tutte le Visit usano lo stesso presentation domain, indipendentemente da owner/provenance. La preference iniziale è namespace-neutral: `depthPreference:0..1`, `languageComplexityPreference:0..1`, `locale?`. Precedence campo per campo: `ItemRevision.defaultPresentation < VisitRevision.presentationBaseline < User.defaultPresentationPreference < preparation override`.

Il backend traduce le preference astratte nelle Representation concrete usando la NamespaceRevision pertinente a ciascuna ContentEntry; il client non usa una tassonomia globale `durationKey/languageLevelKey` di un singolo Namespace. PresentationVariant (semantica/adaptive planning) e Representation (depth/language/locale/text) restano distinte. La Detail espone preference effettiva e controlli user-facing, non gli ID editoriali o il presentation plan completo. Preparation e runtime riusano lo stesso resolver; `currentPresentation.text` è unica fonte per UI e TTS.

# Punto 13/30 — Preparation override temporaneo

ArtAround non introduce preference persistenti User–Visit. `VisitRevision` contiene baseline editoriali, `User` contiene default globali e la Detail usa un `PreparationDraft` temporaneo con eventuali `presentationOverride`, `navigationOverride` e future start options.

Il draft parte senza override espliciti; le projection distinguono valore effettivo e override corrente. Ogni modifica che influenza presentation/routing/timing viene rivalutata backend-side. `startSession()` usa la stessa preparation e materializza il risultato in VisitSession/SessionPlan. Avviare una Session non aggiorna automaticamente i default globali; un eventuale “usa come default” è un use case separato. La persistenza tecnica temporanea del draft resta al Punto 18 e non deve trasformarlo in durable User preference o Visit domain state.

# Punto 14/30 — Navigation preparation v2

Il Navigator non interpreta `LayoutRevision` o il grafo di routing grezzi. Un `NavigationPreparationResolver` backend, o equivalente, costruisce `preparation.navigation` rispetto alla `ResolvedVisitExecutionSource`, alle `VenueRelease` correnti, alle relative `LayoutRevision`, ai default globali dell’utente e al `PreparationDraft`.

La navigation preference distingue `movementPacePreference` astratta e routing requirements. Il client non manipola velocità fisica, connections, Dijkstra o path. I `routingPresets` del Layout sono la principale interfaccia user-facing; eventuali routing attribute configurabili vengono proiettati soltanto con label/descrizione/input comprensibili, non come requirement tecnici grezzi.

Preset e local attribute key non diventano preference globali persistenti. Le preference globali devono restare semanticamente riutilizzabili e il mapping verso attributi locali, incluso `canonicalKey`, resta backend-side. Requirement `required` non supportati o route incompatibili producono blocker/readiness outcome; preference non supportate producono warning quando l’esecuzione resta possibile. Il client non elimina silenziosamente vincoli e non calcola percorsi alternativi.

Il resolver riusa le primitive fisiche/routing esistenti (`resolveSessionVenuePins`, requirement translation, movement speed, route resolver) e non introduce un secondo routing engine. Nella fascia 18–24 opera senza posizionamento automatico dell’utente; QR/geolocation/orientation restano capability 18–33 che potranno alimentare lo stesso dominio di navigation.

# Punto 15/30 — Navigation multi-Venue e canonical routing

Le navigation preference persistenti/globali usano esclusivamente requirement riferiti al catalogo canonico platform-level. Local routing attribute e routing preset appartengono alle rispettive `LayoutRevision` e non diventano default globali. `UserPreferenceService` deve validare `attributeKey`, operator e value dei default persistenti contro `GLOBAL_ROUTING_ATTRIBUTE_CATALOG`.

Il backend traduce ogni canonical requirement separatamente contro la `LayoutRevision` corrente di ciascuna Venue. Un requirement globale `required` deve essere supportato e soddisfatto in tutte le Venue/segmenti applicabili; l’assenza di supporto produce un readiness blocker. Un `preferred` viene applicato dove supportato e produce warning per le Venue in cui non può essere applicato.

I routing preset restano Venue-scoped e in una Visit multi-Venue non vengono unificati per key/label. Il `PreparationDraft` distingue override globali da selezioni locali per Venue. I global required non possono essere indeboliti da preset locali; conflitti hard vengono rifiutati invece di essere risolti silenziosamente. All’interno di una `LayoutRevision`, una stessa `canonicalKey` può essere implementata al massimo da un routing attribute locale, così la traduzione resta non ambigua.

Le leg `inter_venue` non appartengono a una `LayoutRevision`. Finché non esiste un provider inter-Venue capace di verificare canonical routing constraints, un requirement `required` rilevante ma non verificabile sul trasferimento produce blocker; un `preferred` produce warning. Non vengono aggiunti campi ad hoc al RouteHint per simulare un routing provider. `movementPacePreference` influenza il routing indoor; le stime manuali dei trasferimenti inter-Venue non vengono scalate arbitrariamente dal pace.

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

- `museumId` come aggregate universale e `museumStore`;
- `Visit.kind = official | community`;
- `VisitEntitlement` specializzato e `acquisitionType` come semantica dell’execution access;
- Organization membership trattata direttamente come entitlement commerciale;
- Marketplace specifico per museo/Venue;
- `Venue.primaryEditorialContextId` duplicato nella config Navigator;
- assunzione `visitId -> latest published revision` valida per ogni accesso;
- `Visit.visibility`, `VisitShareLink`, `museumIds[]` come filtro fisico;
- `access.basis` / `acquisitionType` nelle projection Navigator;
- DTO editoriale grezzo `GET /visits/:visitId` come read model principale del Navigator;
- presentation pipeline separate per provenienza/owner;
- preference globali basate su taxonomy key di un singolo Namespace;
- preference persistenti User–Visit per presentation/navigation;
- routing graph/requirements tecnici interpretati direttamente da Vue;
- default globali basati su local routing attribute o preset Venue-specific.

# Punti 16–30 ancora da riesaminare

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