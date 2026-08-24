# ArtAround — Decisioni architetturali dei client

Questo documento raccoglie le decisioni architetturali **approvate** per Navigator e Marketplace/Editor. Le decisioni più recenti sostituiscono formulazioni precedenti incompatibili.

# Principi generali confermati

- Un solo backend Node/Express condiviso.
- Navigator: Vue, Vite, TypeScript, Vue Router, Pinia.
- Marketplace/Editor: vanilla JavaScript, ES Modules, Web Components.
- Navigator organizzato in `domain / application / capabilities / infrastructure / UI`.
- Repository/adapter specifici; nessun God `ApiService`.
- Business logic, authorization, routing e timing autorevoli nel backend.
- Protocollo Action: `ActionDefinition -> AvailableAction -> ActionRequest -> ActionDispatcher -> ActionResult -> InteractionEvent`.
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

# Punto 16/30 — Pre-visit information v2

Le informazioni logistiche pre-visita mantengono provenance e lifecycle distinti. `VenueRelease.preVisitInformation[]` contiene informazioni operative/strutturali proprie della Venue e riutilizzabili fra Visit; `VisitRevision.logistics.preVisitNotes[]` contiene note specifiche della Visit. Le indicazioni logistiche non sono Item e non vengono trasformate in ContentEntry/Representation.

`NavigatorVisitDetailProjection.preVisit` espone separatamente `visitNotes[]` e `venues[]`, dove ogni Venue include identity user-facing e `information[]`. Le Venue sono ordinate secondo la prima comparsa nell’itinerario della VisitRevision e ogni array mantiene il proprio ordine editoriale. Le due sorgenti non vengono concatenate, deduplicate o trattate con una precedence/override implicita.

Con il modello corrente `preVisitNotes[]` è visit-wide. Non vengono introdotti scope Venue/Anchor o categorie strutturate finché non esiste un requisito concreto; eventuali future esigenze di override/scoping richiederanno un modello tipizzato e non convenzioni codificate nelle stringhe.

Le note della Visit vengono risolte dalla stessa `VisitRevision` fissata dalla `ResolvedVisitExecutionSource`; le informazioni delle Venue vengono risolte dalle stesse `VenueRelease` usate dalla preparation fisica/navigation/logistics. Il Punto 18 dovrà garantire consistency e staleness handling fra queste dipendenze.

`SessionPlan.explanation.preVisitNotes` non è fonte autorevole e il Navigator non deve dipenderne. La projection pre-visita deve essere composta esplicitamente dalle vere sorgenti versionate.

# Punto 17/30 — LogisticsPreview v2

La Visit Detail espone una `LogisticsPreview` user-facing derivata dalla stessa computation backend usata per preparare il futuro SessionPlan. Non viene introdotto un secondo logistics/routing planner: il calcolo pre-start produce un candidato non persistito, poi proiettato nella preview e riusato allo start secondo le regole di consistency del Punto 18.

La preview contiene durata totale stimata, breakdown fra content/observation/travel, eventuale reserve separata e un route summary con numero di tappe fisiche, leg, Venue e trasferimenti inter-Venue. Le tappe sono VisitAnchor fisici, non ContentEntry. `reservedSeconds` non viene sommato implicitamente al totale e mantiene semantica separata di margine.

Warning non bloccanti appartengono alla LogisticsPreview e vengono proiettati con code stabile e messaggio user-facing; condizioni che impediscono una preparation valida appartengono invece a `readiness.blockers`. Non vengono introdotti range/confidence finché il backend non dispone di un modello statistico aggregato che li giustifichi.

La preview non espone route path, connection ID, VisitAnchor/VenueTarget/Place grezzi, VenueRelease/LayoutRevision ID, speed fisica, preference penalty o presentation plan completo. Tali informazioni rimangono nel dominio backend/Session. La stessa projection è riusabile per Visit e GeneratedVisitPlan.

La `LogisticsPreview` è una stima relativa alla preparation corrente e non un attributo immutabile della VisitRevision. Non viene introdotto un `VisitRevision.estimatedDuration` autorevole: presentation, movement pace, routing requirements, stato fisico corrente e profili di osservazione possono modificare la stima.

# Punto 18/30 — Execution Preparation Context

La fase fra Navigator Visit Detail e `VisitSession` viene modellata tramite un `ExecutionPreparation` transitorio backend, identificato al client da un handle opaco e una `version`. Non è Visit state, User preference, Marketplace resource o Session ed è eliminabile tramite TTL.

La preparation fissa una specifica execution source (`VisitRevision` oppure `GeneratedVisitPlan`), il `PreparationDraft`, le preference effettive, l'adaptive policy version, lo snapshot fisico atteso (`VenueRelease/LayoutRevision` per Venue) e il `preparedPlanCandidate` che ha prodotto la `LogisticsPreview`.

Una nuova `VisitRevision` pubblicata non sostituisce la revision già risolta dalla preparation. L'authorization non viene invece congelata: `startSession()` rivalida sempre il diritto di esecuzione sulla stessa source.

Lo snapshot fisico della preparation è un optimistic consistency boundary, non il pin definitivo della Session. Allo start Venue, target e current `publishedReleaseId` vengono rivalidati. Se lo stato fisico è cambiato, lo start non usa né la vecchia release né quella nuova silenziosamente: restituisce un outcome `PREPARATION_PHYSICAL_STATE_CHANGED` e richiede una nuova preparation.

Gli update della preparation usano optimistic concurrency (`preparationId + expectedVersion`) e ricalcolano backend-side presentation, navigation, logistics e readiness. Default utente modificati successivamente non cambiano una preparation già costruita.

Uno start valido persiste direttamente il `preparedPlanCandidate` come SessionPlan iniziale, anziché ricalcolarlo. `VisitSession` diventa il vero snapshot runtime definitivo con VisitRevision, VenueRelease/LayoutRevision, navigation snapshot, movement speed, adaptive policy e piano concreto pinzati. Dopo uno start riuscito la preparation può essere marcata `consumed` con riferimento alla Session, permettendo comportamento idempotente su richieste duplicate.

Visit e GeneratedVisitPlan utilizzano lo stesso execution-preparation boundary. La normale richiesta di start è quindi preparation-centric (`preparationId`, `expectedPreparationVersion`) e non ricostruisce source/preference da un nuovo payload `visitId + preferences`.

# Punto 19/30 — NavigationDestination v2

Il runtime non usa un `destinationId` generico né un aggregate Location universale. Le destinazioni sono una union tipizzata almeno fra `VisitAnchorDestination` e `VenuePlaceDestination`.

Una tappa pianificata della Visit è identificata dal `visitAnchorId`, con `venueTargetId` e `venueId` associati. `VisitAnchor` identifica l'occorrenza nell’itinerario e non può essere sostituito dal solo VenueTarget, perché lo stesso target può comparire più volte nella Visit. Il `Place` materializzato dalla Session serve al routing ma non sostituisce l'identità semantica dell'Anchor/Target.

I luoghi logistici indipendenti dalla Visit sono `Place` della `LayoutRevision` e vengono proiettati come `VenuePlaceDestination { venueId, placeId, label, resolvedForIntent }`. Gli intenti `FIND_*` sono globali e distinti dalla destination concreta; `PlaceType` e relative key restano Venue-local.

`NEXT/PREVIOUS` operano sulla sequenza di contenuti e non implicano necessariamente uno spostamento: una nuova destination fisica esiste solo quando cambia il VisitAnchor effettivo. Le leg inter-Venue sono route legs, non destination type.

Gli intenti logistici vengono normalmente risolti nella Venue corrente. Comandi come “ci sono ostacoli?” non rappresentano destination request e restano query/action di accessibility/navigation separate.

Le API runtime non espongono raw Place, path/connection ID, VenueRelease/LayoutRevision ID o preference penalty come contratto Navigator. Tali dati vengono trasformati in una `NavigationProjection` user-facing; la composizione mappa viene definita al Punto 21. QR/geolocation 18–33 cambiano il modo in cui viene determinata l'origine della navigazione, non la tipologia delle destinazioni.

# Punto 20/30 — Runtime location v2

Il runtime distingue rigorosamente execution progress e physical user location. `currentEntryIndex` e il relativo `logicalVisitAnchor` rappresentano la posizione logica nella sequenza della Session e non costituiscono prova della posizione fisica dell'utente.

Nel 18–24 non esiste una physical location observation automatica. Il routing può usare il logical VisitAnchor come origine di fallback, ma questa viene qualificata come `logical_anchor` e non viene presentata come “you are here”. L'API Navigator non accetta normalmente `fromPlaceId`/`venueId` grezzi: un `NavigationOriginResolver` backend determina l'origine da reference tipizzate e dallo stato runtime.

Le future localizzazioni 18–33 entrano tramite `LocationProvider`. QR, georeferenziazione/orientamento e teletrasporto sono provider differenti che convergono su una `LocationObservation`, preferibilmente `VenueTarget`-centric quando viene identificato un oggetto fisico. Coordinate e dettagli provider-specific non contaminano il core runtime.

Una location observation ha provenance, timestamp ed eventuale confidence; non modifica automaticamente `currentEntryIndex` o il SessionPlan. Discrepanze fra logical Anchor e observed VenueTarget vengono trattate esplicitamente dall'application/action layer.

L'origine della navigazione segue concettualmente `explicit one-shot origin > fresh physical observation > logical Anchor fallback`. Un eventuale Place usato dal routing resta un dettaglio della LayoutRevision pinzata e non diventa una pseudo-posizione persistente dell'utente.

`venueTargetObservations[]` esistenti restano dati di learning sui tempi di osservazione e non vengono riutilizzati come location state. La mappa 18–24 può mostrare tappa corrente, prossima destination e route, ma non un marker automatico della posizione utente.

# Punto 21/30 — Map projection v2

Il Navigator non riceve né interpreta il `LayoutRevision` grezzo. Un backend Map Projector costruisce la cartografia user-facing dallo snapshot fisico della `ExecutionPreparation` o della `VisitSession`; durante una Session usa esclusivamente le VenueRelease/LayoutRevision pinzate.

I floor espongono label, map asset e coordinate normalizzate. Le tappe della Visit vengono proiettate da `VisitAnchor -> VenueTarget -> VenueTargetPlacement -> Place.position` e mantengono `visitAnchorId`/`venueTargetId` come identità semantica; il Place sottostante è dettaglio fisico del layout. Le facility vengono invece proiettate da Place/PlaceType tramite intenti globali user-facing.

Non vengono inviati al Navigator tutti i Place, le Connection, routing attributes o `path[]` tecnici. Le route vengono trasformate backend-side in overlay geometrici per floor, con punti normalizzati e transition esplicite fra piani. I trasferimenti inter-Venue restano transition logistiche e non vengono disegnati come linee fra floor map differenti.

`MapProjection` contiene la base relativamente stabile della mappa; `NavigationProjection` contiene destination, route overlay, instructions e warning dinamici. Il `navigationStore` può inizialmente gestire entrambe senza introdurre un map store dedicato.

Le floor map appartengono al Physical Domain e non alla `NavigatorStaticConfig`. Un floor senza map asset non invalida universalmente il Layout domain, ma deve emergere come problema di Navigator readiness quando impedisce la visualizzazione cartografica richiesta per una Visit 18–24. Non viene generata implicitamente una falsa mappa schematica dal routing graph.

Nel 18–24 la tappa logica corrente può essere evidenziata, ma non viene mostrato un marker automatico “you are here”. Le future `LocationObservation` 18–33 aggiungono overlay di localizzazione senza modificare la struttura fondamentale della `MapProjection`.

# Punto 22/30 — Action protocol v2

Le interazioni applicative runtime del Navigator convergono sul protocollo `ActionDefinition -> AvailableAction -> ActionRequest -> ActionDispatcher -> ActionResult -> InteractionEvent`. Bottoni accessibili, vocabolario vocale controllato e futuro natural-language adapter sono adapter differenti dello stesso protocollo e non chiamano business logic parallela. Il contratto pubblico può convergere su un endpoint runtime Action unico, mentre gli use case interni restano servizi specializzati; preparation/start e telemetry/observation non vengono forzati dentro il protocollo Action.

`AvailableAction` è una capability runtime concreta derivata backend-side da Session status, actor/participant authority, SessionPlan, current presentation, snapshot editoriali e fisici pinzati, location e capability/provider disponibili. Le Action parametrizzate vengono materializzate in opzioni concrete user-facing invece di lasciare al client la costruzione di intent o ID tecnici. Nel 18–27 uno studente non riceve `NEXT/PREVIOUS`, mentre può ricevere le Action di approfondimento consentite; il client non implementa questa policy con branch sul ruolo.

Le Action di presentation distinguono profondità da complessità linguistica: gli attuali `PRESENTATION_LANGUAGE_UP/DOWN` vengono semanticamente sostituiti da complexity increase/decrease, lasciando locale/traduzione a una capability distinta. Destination request logistiche come toilette/uscita/bar/shop vengono materializzate soltanto quando l'intento è risolvibile; query di accessibility come “ci sono ostacoli?” restano Action differenti dalle destination request.

L'esplorazione semantica non introduce un catalogo globale obbligatorio di relazioni come autore, stile, periodo o tecnica. I tipi di relazione appartengono ai Namespace e il backend deriva dinamicamente gli approfondimenti dal SemanticGraph e dagli Item utilizzabili nello snapshot editoriale della Session. Label o voice alias come “Chi è l'autore?” o “Qual è lo stile?” possono essere esposti quando il Namespace/graph corrente rende disponibile quella semantica, ma non diventano invarianti del core ArtAround. Un approfondimento può anche derivare da un altro Item sullo stesso Subject senza richiedere una SemanticEdge; curiosità/aneddoti/approcci editoriali non vengono forzati a diventare relation type o nuovi Subject se non rappresentano davvero concetti semanticamente autonomi.

`ActionRequest` riferisce una `AvailableAction` corrente e il backend ne rivalida disponibilità e authorization prima dell'esecuzione; il canale `button | controlled_voice | natural_language` è provenance/telemetry, non authorization. Ogni Action produce projection/backend update autorevoli e un `InteractionEvent` semantico. Le risposte testuali mostrate e pronunciate attraversano lo stesso presentation channel. Nel 18–33 la LLM può esclusivamente selezionare/mappare una delle `AvailableAction` correnti e non può bypassare authorization, action policy o domain services.

# Punto 23/30 — GenerationOptionsProjection v2

Il Navigator non costruisce autonomamente le opzioni del generator interrogando Venue, ContentSpace, EditorialContext, Namespace o Marketplace separatamente. Un backend projection boundary restituisce le Venue utilizzabili come PhysicalScope e le sorgenti editoriali effettivamente autorizzate per l'actor.

PhysicalScope ed EditorialScope restano indipendenti. La selezione di una Venue non restringe le sorgenti editoriali a Context appartenenti alla sua Organization e non concede implicitamente diritti sulle sorgenti. `Venue.primaryEditorialContextId` è un default/endorsement: può essere scelto automaticamente solo quando la relativa source è utilizzabile con `context.generate`. La policy temporanea che considera il primary Context automaticamente autorizzato viene superseded.

Le source editoriali sono proiettate user-facing raggruppandole per ContentSpace/curator, ma il source tecnico del generator è `EditorialContext` live oppure `EditorialRelease` pinned. Una selezione ContentSpace è soltanto una shortcut UX verso i Context autorizzati contenuti nel gruppo. Se l'utente specifica source, vengono usate esattamente quelle; l'assenza di selezione può applicare i default autorizzati delle Venue.

L'authorization usa owner authority oppure capability `context.generate` e viene rivalidata al momento della generazione. Acquisition/Entitlement e access basis non vengono esposti al Navigator. La request deve evolvere dall'attuale solo-`editorialContextIds[]` a source ref tipizzate per poter rappresentare correttamente sia `follow_current` sia `EditorialRelease` pinned.

Le opzioni semantiche vengono derivate dai Namespace/SemanticGraph delle source selezionate e non da una tassonomia globale museale. Subject, Item o VenueTarget numerosi vengono cercati tramite query backend scope-aware/paginate invece di essere riversati integralmente nella projection. Presentation e navigation controls riusano le projection già definite e non espongono requirement/routing internals.

La stessa structured generation request è usata dal form e dalle future capability 18–33; eventuale LLM non introduce un secondo contratto di generazione né un'interfaccia a prompt.

# Punto 24/30 — Materializzazione GeneratedPlan -> Visit v2

`accept` e `materialize as Visit` sono use case distinti. Un `GeneratedVisitPlan` accettato può essere eseguito direttamente oppure materializzato, tramite un comando idempotente separato, come una nuova Visit `ownerType=user` del current User. Il GeneratedPlan resta come artifact di provenance/generazione e mantiene un riferimento alla Visit materializzata.

La materializzazione crea una normale VisitRevision usando gli stessi snapshot editoriali del piano: preserva EditorialRelease, Item, ItemEdition, ItemRevision, role, ordine delle ContentEntry e VenueTarget degli Anchor. Nuovi VisitAnchor vengono creati e i `deliveryAnchorId` vengono rimappati. In presenza di provenance multipla su una generated ContentEntry viene scelta deterministicamente una EditorialSource canonica compatibile con la Edition/Revision, senza cambiare il modello Visit a source multiple; il GeneratedPlan conserva la provenance completa.

Le Representation concrete, i Place, VenueRelease/LayoutRevision fisiche, route indoor/path, timing, observation estimate, movement/navigation snapshot, adaptive policy, score e generation diagnostics non vengono copiati nella Visit. Le eventuali preference astratte `depthPreference`, `languageComplexityPreference` e `locale` possono diventare `presentationBaseline`.

Le sole informazioni del piano fisico convertibili in logistica persistente sono quelle semanticamente necessarie per trasferimenti inter-Venue, in particolare `estimatedTransferSeconds`, rimappate come RouteHint fra i nuovi Anchor. I percorsi indoor vengono sempre ricalcolati contro la VenueRelease/LayoutRevision corrente nelle future preparation/Session.

La nuova Visit personale viene sottoposta al normale integrity check e pubblicata come VisitRevision eseguibile; questo non crea un MarketplaceListing e quindi non la rende pubblicamente discoverable. Successive modifiche passano dal normale workflow revisionale Visit. La materializzazione è applicativamente atomica/idempotente: richieste duplicate restituiscono la Visit già creata invece di duplicarla.

La materializzazione non copia o trasferisce ownership di Item, EditorialContext, Namespace o graph: conserva riferimenti a dipendenze immutabili legittimamente usate dal GeneratedPlan. Provenance commerciale/Adoption resta responsabilità del Marketplace domain. Il legame persistente GeneratedPlan -> Visit è obbligatorio; l'eventuale generalizzazione futura in un modello unico di Visit provenance viene valutata insieme a reference/import/copy/fork.

# Punto 25/30 — Workflow Visit user/organization-owned

Ownership e workflow delle Visit dipendono da `ownerType`, senza reintrodurre `official/community`. Una Visit user-owned è gestita direttamente dal proprietario: può creare/modificare la working revision, eseguire integrity check e pubblicare direttamente una revision valida. Non possiede managerial review e la publication personale non produce review/approval metadata fittizi.

Per una Visit organization-owned, `operator` e `manager` possono creare, modificare, controllare e inviare/ritirare una working revision dalla review. Solo il `manager` può richiedere modifiche, pubblicare, trashare o ripristinare. La publication organizzativa richiede una revision `in_review` valida; il percorso diretto `draft -> published` viene rimosso. Non viene imposto che autore e reviewer siano utenti differenti.

Una working revision `in_review` non è modificabile; deve essere withdrawn oppure ricevere changes requested. La precedente published revision resta immutabile ed eseguibile mentre una nuova working revision viene preparata.

`VisitRevision.status=published` significa snapshot editoriale immutabile/eseguibile e non pubblicazione nel catalogo Marketplace. `MarketplaceListing`, `MarketplaceOffer`, Acquisition ed Entitlement rimangono lifecycle distinti. Una Visit personale o organizzativa può quindi avere una published revision senza Listing. La pubblicazione commerciale non viene attivata automaticamente dal publish editoriale.

Contenuti/release non discoverable possono essere referenziati da Visit pubblicate quando l'actor possiede i diritti necessari; ciò consente le Visit personali/private della docente 18–27 senza introdurre una nuova `Visit.visibility`. La partecipazione degli studenti resta authority di Session separata.

L'Organization proprietaria della Visit non limita PhysicalScope o EditorialScope alle risorse possedute dalla stessa Organization. Il Marketplace/Editor riceve dal backend le operazioni correntemente disponibili invece di dedurre authorization da `ownerType` e ruolo client-side.

# Punto 26/30 — Marketplace Catalog e Creator Workspace

Marketplace ed Editor restano un'unica applicazione generica, ma Catalog consumer e Creator Workspace utilizzano read model distinti. Non esistono account type globali visitor/author: lo stesso actor può consumare, creare e vendere in funzione di ownership, principal authority ed Entitlement.

Il Catalog è Listing-centric e server-side searchable/paginated. Le card/detail proiettano asset, publisher, metadata user-facing, license summary, Offer/prezzo, usi concessi dalle capability, version behaviour ed eventuali external requirements, senza esporre documenti Listing/Offer/Entitlement/Acquisition grezzi. Gli effective rights già posseduti vengono aggregati per asset; la cronologia Acquisition resta separata.

L'acquisizione concede Entitlement ma non importa, copia, collega o adotta automaticamente una risorsa. Adoption nasce soltanto dall'effettivo uso creator dell'asset.

Il Creator Workspace è principal-scoped e distingue risorse possedute/gestibili da risorse esterne utilizzabili tramite capability. Può contenere anche entità non marketable come ContentSpace, Subject o working revisions. Ogni resource projection espone `availableOperations[]` backend-authoritative invece di far dedurre authorization al client.

Le API/domain service esistenti di ContentSpace, ItemEdition, EditorialContext, Namespace, Visit e Venue vengono riusate; le liste raw non diventano automaticamente contratti del Marketplace. Catalog e Workspace adottano search, pagination e projection sintetiche server-side. In particolare l'attuale `GET /items` non rappresenta il catalogo commerciale e deve essere sostituito nelle browse UX da una projection sull'asset marketable appropriato.

Vendite e adozioni hanno projection/dashboard dedicate, con statistiche aggregate e history paginata quando necessaria. User e Organization possono essere buyer/seller/creator principal soltanto fra i principal che il backend autorizza per l'actor.

La selezione UX del museo è un filtro/contesto del catalogo unico e non crea Marketplace separati; il mapping preciso verso Venue viene definito al Punto 29.

# Punto 27/30 — Reference, import snapshot, copy detached e fork

Reference, import snapshot, copy detached e fork sono operazioni distinte e non vengono rappresentate da una generica “copy”. Una reference incorpora una risorsa/snapshot esterna in un proprio aggregate senza crearne una nuova lineage o trasferirne ownership. Le revision/release persistenti pinano sempre snapshot immutabili, anche quando il diritto sorgente è `follow_current`.

`content.use_in_editorial_release` e `context.compose_visit` sono reference capabilities. `ContentSpaceMembership` non modifica ownership e non costituisce prova del diritto commerciale; l'uso effettivo di una risorsa esterna viene rivalidato tramite `CapabilityAuthorizationService`.

Un fork crea una nuova lineage indipendente dello stesso dominio editoriale e registra provenance verso la snapshot sorgente. Item fork mantiene normalmente gli stessi Subject globali ma crea un nuovo Item/Edition/Revision e non copia VenueTarget. Namespace fork crea una nuova Namespace lineage, rigenera le definition identity e non copia automaticamente Subject, Item o SemanticGraph.

`visit.copy_detached` crea una nuova Visit lineage e nuovi ID strutturali, mantenendo riferimenti alle stesse immutable editorial dependencies e agli stessi VenueTarget. “Detached” indica indipendenza dalla futura evoluzione della Visit sorgente, non deep-copy delle dependency; non concede implicitamente diritti di fork/import/resale sulle dipendenze.

`context.import_snapshot` materializza da una precisa EditorialRelease una nuova EditorialContext lineage owned dal destination principal, normalmente in un proprio ContentSpace. L'import preserva la snapshot editoriale/semantica e la provenance, ma non duplica automaticamente Subject, Item o Namespace e non trasforma le dependency esterne in asset owned. Nuove operazioni sulle dependency continuano a richiedere le relative capability (`namespace.author`, `content.fork`, ecc.).

Subject rimane identità globale condivisa attraverso reference, import e fork e non viene duplicato per creare ownership locale. Analogamente le operazioni editoriali non creano o duplicano VenueTarget.

Acquisition non crea Adoption. Adoption viene registrata quando una risorsa esterna viene effettivamente incorporata in un processo creator (`content_link`, `content_fork`, `namespace_use`, `namespace_fork`, `context_reference`, `context_import`, `context_venue_primary`, `visit_copy`). Fruizione pura come `visit.execute`, `content.consume` o una generazione temporanea non è automaticamente Adoption. Provenance dell'asset e Adoption restano concetti separati.

Gli attuali Item fork, Namespace fork e Visit detached copy vengono mantenuti come base strutturale; i loro authorization boundary owner-only temporanei vengono sostituiti dal sistema capability-based. Non viene introdotto un universal provenance aggregate soltanto per uniformare asset differenti; le projection possono fornire un `provenanceSummary` comune sopra provenance tipizzate per dominio.

# Punto 28/30 — Item authoring v2

L'authoring editoriale parte dal `Subject` e non dalla Venue. L'autore cerca e riusa un Subject esistente oppure ne crea uno nuovo; gli exact external reference identificano senza ambiguità entità già note e non vengono duplicati. Subject è identità semantica globale e non possiede owner editoriale, ContentSpace o Venue.

Un `Item` è una lineage editoriale owned da User/Organization su un `primarySubjectId`; più Item indipendenti possono riferirsi allo stesso Subject. `ItemEdition` lega la lineage a un Namespace e resta unica per coppia Item/Namespace. `ItemRevision` contiene metadati e presentation content versionato; `PresentationVariant` rappresenta alternative semantico/editoriali mentre `Representation` concretizza durata, livello linguistico, locale e testo. Author e license restano requisiti di publish integrity.

La terminologia interna non viene deformata per replicare letteralmente l'“Item = testo” della specifica. Catalog ed Editor forniscono però projection user-facing in cui i testi/Representation mostrano chiaramente durata, linguaggio, autore, licenza e contenuto, rendendo esplicita la conformità funzionale.

`ContentSpaceMembership` organizza e autorizza l'inclusione dell'Item in un workspace ma non modifica ownership. Una EditorialRelease può includere soltanto Item member del ContentSpace del Context, Edition appartenenti allo stesso Namespace e ItemRevision immutabili/coerenti. Item publication, Context release e Marketplace listing restano lifecycle distinti.

`VenueTarget` appartiene esclusivamente al Physical Domain ed è una occorrenza `Venue + Subject`. Item/Edition/Revision non contengono `venueTargetId`, `venueId`, coordinate o placement. Un Item relativo a un Subject non fisico non richiede alcun VenueTarget; una Visit può consegnarlo presso l'Anchor di un altro Subject fisico.

Recognition media della specifica viene separata da media editoriale: `ItemRevision.illustrativeMedia` accompagna il contenuto, mentre `VenueRelease.targetBindings.recognitionMedia` serve a riconoscere l'occorrenza fisica. Un wizard può orchestrare Subject, Item e VenueTarget per comodità UX ma non li fonde nel dominio e rispetta authority separate.

`relatedSubjectIds` e semantic focus non generano automaticamente SemanticGraph edge. Le relazioni del graph restano curate esplicitamente. Il consistency check Item deve inoltre verificare l'esistenza dei Subject referenziati prima della publication.

Il Marketplace/Editor usa una `ItemAuthoringProjection` con Subject, lineage, Namespace/Edition, revision/presentation controls, workspace membership, publication state e `availableOperations[]`; non espone al Web Component una composizione di documenti Mongo grezzi da interpretare.

# Punto 29/30 — Marketplace Venue selection v2

Il termine user-facing “museo” della specifica viene mappato sul `Venue` come unità atomica della selezione fisica. `Organization` rappresenta invece l’istituzione/owner e può raggruppare più Venue nel pannello; un eventuale “seleziona tutte le sedi” è una shortcut che produce comunque `selectedVenueIds[]`, non un nuovo scope Organization.

Il Marketplace usa una projection dedicata per il selector, con Organization summary e Venue user-facing, senza esporre primary Context/release o richiedere lookup client-side. La selezione è multipla, modificabile e costituisce search/filter context transitorio; non è authorization, ownership, EditorialScope o domain state persistente. Se aperto dal Navigator parte da `selectedVenueIds=[configuredVenueId]` ma resta l’unico Marketplace generico.

Più Venue selezionate usano inizialmente semantica union/OR. Le Visit vengono filtrate tramite PhysicalScope derivato da `VisitAnchor -> VenueTarget -> Venue`, senza introdurre `Visit.museumIds[]`; le card espongono l’intero PhysicalScope così una Visit che include anche Venue non selezionate non viene presentata in modo ambiguo.

I contenuti editoriali non “appartengono” alla Venue. Un backend `VenueCatalogRelevanceResolver` deriva invece la pertinenza usando evidenze del dominio, inizialmente Subject materializzati da VenueTarget, associazioni esplicite dei contenuti e endorsement tramite `Venue.primaryEditorialContextId`. EditorialContext esterni possono risultare pertinenti quando il loro corpus contiene contenuti rilevanti. `primaryEditorialContextId` è un segnale/default, non un filtro esclusivo o authorization.

Il SemanticGraph e l’EditorialScope non vengono filtrati dalla Venue. Subject non fisici e contenuti cross-museum rimangono pienamente validi; eventuale graph relevance può contribuire in futuro al ranking senza trasformare il PhysicalScope nel confine semantico. Asset intrinsecamente venue-neutral, come Namespace, non ricevono `venueIds[]` artificiali.

Nell’Editor la selezione Venue restringe browse/search e target picker ma non viene persistita nella Visit: il PhysicalScope reale resta derivato dagli Anchor effettivamente presenti. Cambiare il selector non aggiunge o rimuove automaticamente tappe.

Search e relevance sono backend-side e scalabili. Eventuali `venueRelevance` denormalizzate appartengono a un indice/projection ricostruibile e non diventano source of truth nei modelli editoriali.

Per la demo obbligatoria, le tre Visit da almeno dieci opere vengono mantenute interamente sulla stessa Venue reale, lasciando l’eventuale multi-Venue come dimostrazione aggiuntiva di generalità.

# Punto 30/30 — Final architecture audit e cleanup boundary

I Punti 1–29 costituiscono l’architettura client-v2 canonica di ArtAround. Modelli, servizi, API, documenti o script incompatibili sono implementazione legacy/transitoria da eliminare o rifattorizzare e non costituiscono motivazione per mantenere retrocompatibilità o riaprire il Domain Model v2.

Le fondamenta Domain v2 correnti vengono preservate. Il completamento richiede invece di portare i boundary applicativi alla nuova architettura: Marketplace capability-based con Listing/Offer/Acquisition/Entitlement/Adoption e `CapabilityAuthorizationService`; execution source/version policy; `ExecutionPreparation`; Action protocol; GeneratedPlan materialization; workflow publication corretto; client-facing projection per Navigator, generator, Marketplace e Venue search.

Le policy pre-Marketplace basate esclusivamente su ownership/membership e il bypass `Venue.primaryEditorialContextId -> context.generate` vengono rimossi quando il capability core viene introdotto. I runtime endpoint specifici/string action, `visitId -> publishedRevisionId` implicito, client-supplied routing origin/technical intent e l’ambiguità `presentation language = complexity` sono contratti transitori da sostituire.

La priorità di consegna 18–24 è la realizzazione effettiva dei due client richiesti dalle specifiche: Navigator Vue/Vite/TypeScript e Marketplace/Editor vanilla JavaScript con Web Components, seguiti dai flussi end-to-end, mappa, TTS, vocabolario controllato, bottoni accessibili, authoring/catalogo e dati dimostrativi. Le capability 18–27/18–33 restano predisposte architetturalmente ma non vengono implementate anticipatamente salvo scelta esplicita del livello esteso.

Repository e documentazione vengono ripuliti insieme al codice: README e revision-workflow legacy vengono riscritti, script npm morti eliminati, legacy/hygiene checker ampliati, CI estesa ai client e seed completato con Venue reale, contenuti e tre Visit di almeno dieci opere sulla stessa Venue. Il deploy finale deve inoltre soddisfare i container e gli artifact di consegna richiesti dalle specifiche.

Gli schemi wire esatti di `Action`, `RuntimeUpdate`, completion summary e session discovery sono contratti di implementazione da fissare durante la costruzione dei client; possono evolvere tecnicamente senza contraddire o riaprire la semantica approvata nei Punti 1–29.

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
- default globali basati su local routing attribute o preset Venue-specific;
- logistica pre-visita trasformata in Item/ContentEntry o concatenata senza provenance;
- durata della Visit trattata come proprietà statica/autorevole della VisitRevision;
- start della Session che rilegge silenziosamente latest VisitRevision/default utente/stato fisico invece di consumare una preparation versionata;
- destination runtime appiattita su un ID ambiguo o su un generico aggregate Location;
- `currentEntryIndex`, `VisitAnchor.placeId` o un `fromPlaceId` client-supplied trattati come posizione fisica certa dell'utente;
- `LayoutRevision`, routing graph o `connectionId[]` esposti al Navigator come contratto cartografico da interpretare client-side;
- `availableActions` come mere stringhe con business logic duplicata fra endpoint, bottoni e voce;
- relazioni semantiche museali come `author/style` imposte come catalogo platform-level obbligatorio;
- `Venue.primaryEditorialContextId` usato come bypass implicito di `context.generate`;
- client che costruisce l'universo delle source del generator leggendo direttamente modelli editoriali/commerciali;
- `acceptGeneratedPlan` usato implicitamente come creazione di una Visit;
- materializzazione di un GeneratedPlan che congela VenueRelease/LayoutRevision, Place, path indoor, timing o Representation concrete dentro la VisitRevision;
- publication di una Visit organization-owned direttamente da `draft` senza passare per managerial review;
- publication personale che scrive review/approval metadata fittizi;
- Catalog Marketplace costruito da liste raw di Item/Context/Visit o dal dump di documenti commerciali;
- acquisition che importa/copia/adotta automaticamente un asset o account type globali `visitor/author` usati come authorization;
- operazione generica “copy” che confonde reference, import snapshot, Visit detached copy e fork;
- fork/import che duplica Subject o VenueTarget per creare ownership locale;
- Item/Edition/Revision che incorporano `venueId`, `venueTargetId`, coordinate o placement fisico;
- creazione contenuto che richiede sempre una Venue/occurrence fisica o che trasforma automaticamente `relatedSubjectIds` in graph edge;
- selector “museo” implementato come `Organization` o come `museumIds[]` persistenti nei modelli editoriali/Visit;
- filtro Venue che limita automaticamente EditorialScope/SemanticGraph o tratta `primaryEditorialContextId` come unico corpus valido.

# Audit 1–30 completato

L’audit architetturale client-v2 è concluso. Le decisioni 1–30 sono il contratto di riferimento per l’implementazione. I dettagli wire ancora non fissati (`Action`, `RuntimeUpdate`, completion summary, session discovery) vengono definiti durante i vertical slice senza riaprire la semantica approvata.

# Marketplace/Editor UX — IA novice-first e progressive disclosure

Decisione approvata per il redesign del Marketplace/Editor:

- la navigazione user-facing converge su cinque aree: **Catalogo**, **Le mie risorse**, **Crea**, **Licenze e vendite**, **Account e organizzazioni**;
- Catalog consumer e Creator Workspace restano read model distinti come stabilito al Punto 26: la nuova IA non introduce account type `visitor/author` né modalità applicative che alterano authorization;
- il `principal` resta un concetto backend/domain. Nel creator UX viene presentato come contesto persistente **“Stai lavorando per”**; actor autenticato, working principal, beneficiary, seller e owner restano concetti distinti e vengono etichettati in base al task (`Acquista per`, `Pubblica come`, ecc.);
- la terminologia tecnica interna non viene rinominata nei modelli o nelle API soltanto per semplificare l'interfaccia. La UI usa invece label user-facing (`Risorsa`, `Contenuto`, `Spazio editoriale`, `Raccolta editoriale`, `Regole editoriali`, `Sede`, `Oggetto della sede`, `Scheda nel catalogo`) e mantiene termini/ID tecnici disponibili tramite progressive disclosure;
- `availableOperations[]` resta backend-authoritative. Il client può ordinarne, raggrupparne e tradurne la presentazione, ma non deduce permessi o transizioni da tipo risorsa, owner o ruolo quando tali decisioni appartengono al backend;
- le projection del Creator Workspace distinguono la risorsa gestita nel Marketplace dalla destinazione di authoring. Una risorsa owned può quindi esporre un `authoringRef { resourceType, resourceId }` separato da `resourceId`, `sourceRef`, `snapshotRef` e `publishedSnapshotRef`. In particolare un `ItemEdition` usa `authoringRef -> Item`, evitando reverse lookup o converter frontend permanenti per aprire l'Item editor;
- `authoringRef` è una navigation/application projection e non modifica ownership, marketability o il Domain Model. Per Visit, Namespace ed EditorialContext può puntare allo stesso aggregate live quando quello è già la corretta destinazione di authoring;
- la UX è **novice-first, expert-capable**: azione primaria, stato, blocker e campi necessari restano immediatamente visibili; capability code, version policy, mapping semantici, ID, PresentationVariant/Representation avanzate, routing attributes/preset e JSON strutturati rimangono accessibili in sezioni avanzate senza essere eliminati;
- un workflow non deve far creare dati inutilmente quando il backend può già sapere che manca un prerequisito indispensabile. I creator flow introdurranno quindi preflight/prerequisite projection backend-authoritative, iniziando dal requisito Namespace per completare un ItemEdition;
- la nuova IA deve mantenere **feature parity completa** con Catalog, acquisizioni, Workspace, authoring Item/Visit, EditorialRelease, commerce, account, Organization, Namespace e Venue. La semplificazione della UI non giustifica la perdita di operazioni avanzate;
- feedback, error recovery, dirty state, conferme distruttive, empty state, focus/keyboard/ARIA e responsive behavior devono convergere su primitive di design comuni invece di essere implementati diversamente in ogni view;
- l'implementazione è incrementale: prima shell/design primitives e contratti mancanti, poi Le mie risorse e hub Crea, quindi authoring, Catalog/acquisition, commerce, account/Organization e infine gli editor avanzati Namespace/Venue. Ogni slice mantiene il dominio e i contratti già approvati e viene verificata per regressioni e accessibilità.

# Marketplace/Editor UX — Visit authoring workflow

Decisione approvata per l'authoring delle Visit nel Marketplace/Editor:

- il flusso user-facing è **Informazioni principali → Contenuti → Tappe → Impostazioni → Logistica → Riepilogo e pubblicazione**; i nomi tecnici `ContentEntry`, `EditorialSource`, `VisitAnchor`, `VenueTarget` e `VisitRevision` restano disponibili tramite progressive disclosure ma non strutturano la navigazione principale;
- scelta dei contenuti e definizione delle tappe sono due decisioni distinte. Aggiungere un contenuto crea o riusa soltanto il riferimento editoriale necessario e aggiunge una `ContentEntry` con `deliveryAnchorId = null`; non crea implicitamente un `VisitAnchor` e non modifica il PhysicalScope come side effect;
- `Item.primarySubjectId` può essere incluso nella `VisitAuthoringProjection` per suggerire `VenueTarget` con lo stesso Subject. Tale corrispondenza è un aiuto di authoring e non un'invariante: l'autore decide esplicitamente quali VenueTarget diventano VisitAnchor;
- una ContentEntry può restare senza tappa specifica oppure essere associata a qualunque VisitAnchor valido della Visit. Questo permette di presentare contenuti su autore, stile, periodo o altri Subject non fisici presso la tappa di un'opera senza introdurre relazioni fisiche artificiali;
- il PhysicalScope della Visit continua a derivare esclusivamente dai VisitAnchor effettivamente presenti. Il selector di Venue serve a cercare VenueTarget candidati e non viene persistito come scope della Visit né aggiunge/rimuove tappe automaticamente;
- l'ordine di fruizione resta l'ordine delle `ContentEntry`; non viene introdotto un secondo ordinamento artificiale degli Anchor. La rimozione di un Anchor è impedita quando è ancora referenziato da ContentEntry o RouteHint, invece di riparare silenziosamente il grafo nel frontend;
- la logistica è presentata come quinto passaggio dello stesso wizard per continuità UX ma resta un dominio distinto: `preVisitNotes` e `routeHints` non sono Item né ContentEntry, e il routing indoor resta responsabilità del Physical Domain. Il precedente componente logistico separato viene eliminato per evitare due UI concorrenti sulla stessa VisitRevision;
- `presentationBaseline` rimane namespace-neutral e viene presentata come impostazione facoltativa di profondità, complessità linguistica e locale; il mapping verso Representation concrete resta backend-side;
- integrity e workflow restano backend-authoritative. Il riepilogo può spiegare blocker e stato, ma soltanto `availableOperations[]` determina check, review, richiesta modifiche e publication; la publication editoriale della Visit continua a essere distinta dalla creazione di un MarketplaceListing;
- modificare una Visit pubblicata usa il normale boundary backend che crea una nuova working revision al primo write; il client non clona revisioni e non muta snapshot pubblicati;
- il redesign deve preservare ricerca/paginazione server-side dei contenuti, ruoli `core | recommended | optional`, riordino/rimozione, multi-Venue, logistica strutturata e capability autorizzate, esponendole con microcopy novice-first e controlli accessibili.