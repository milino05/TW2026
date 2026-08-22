# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Fase corrente

**Freeze finale — esecuzione completa di check/build/test/seed e prova deploy.**

## Slice 0 — Repository e client scaffold

**Stato: implementato; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- creato `clients/navigator` con Vue/Vite/TypeScript, Vue Router, Pinia, route shell, store boundary, capability boundary, `NavigatorStaticConfig` e adapter HTTP;
- creato `clients/marketplace` vanilla JavaScript con ES Modules, Web Component app shell, router application-level, adapter HTTP e build script senza framework;
- aggiunti script root `check:clients` e `build:clients`;
- CI estesa a install/check/build dei client;
- aggiornati checker legacy/hygiene e cleanup repository.

## Slice 1 — Capability core + primo flusso end-to-end

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- capability registry generico e principal resolution User/Organization;
- `MarketplaceListing`, `MarketplaceOffer`, `MarketplaceAcquisition`, `Entitlement`;
- `CapabilityAuthorizationService` e migrazione di `visit.execute` a ownership/principal authority/Entitlement;
- Catalog Visit Listing-centric e acquisizione gratuita idempotente;
- Navigator Library/Detail e Marketplace Catalog come projection dedicate;
- distinzione `can execute != appears in personal Library`;
- primo flusso client end-to-end e relativi test.

## Slice 2 — Execution source, Preparation e projections Navigator

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- `ResolvedVisitExecutionSource` per owner/principal authority, `follow_current` e pinned;
- `ExecutionPreparation` transitoria con TTL, versioning, preference, physical snapshot, candidate plan, readiness, LogisticsPreview e preVisit;
- start preparation-centric, idempotente e senza secondo planner;
- stale authorization e stale physical state rilevati prima dello start;
- Library/Detail allineate alla stessa source resolution;
- session discovery/resume minimale;
- rimosso completamente lo start diretto di VisitSession e protetto tramite checker legacy.

## Slice 3 — Action protocol v2 e runtime cleanup

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- runtime Action registry con famiglie progress, presentation, semantic, navigation e lifecycle;
- `AvailableAction` concrete con `actionId`, type/family, label e controlled voice aliases;
- `VisitSessionV2.runtimeVersion`, optimistic concurrency e `InteractionEvent` generico;
- `POST /v2/visit-sessions/:sessionId/actions` come unico command boundary runtime;
- rimossi gli endpoint runtime command-specific e il raw session-plan endpoint pubblico;
- Navigator rende le Action genericamente e invia soltanto `actionId + expectedRuntimeVersion + interactionChannel`;
- semantic exploration deriva dallo snapshot editoriale pinzato e supporta same-Subject e related-Subject senza taxonomy globale `author/style/...`;
- approfondimento semantico sullo stesso presentation channel, senza nuova destinazione fisica;
- checker legacy protegge il protocollo Action.

## Slice 4 — Navigation, MapProjection, TTS e controlled voice

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- formalizzati `NavigationPreparationResolverV2` e `NavigationOriginResolverV2` riusando il planner/routing esistente;
- l'origine 18–24 resta `logical_anchor`; il resolver è predisposto a `explicit > fresh physical observation > logical_anchor` senza aggiornare automaticamente il progress della Visit;
- unificato il catalogo globale dei routing attribute nel preesistente `routingAttributeCatalog.service.js`; eliminato il catalogo parallelo introdotto durante lo slice;
- default utente e override transienti accettano soltanto canonical routing requirements validati per tipo, operatore, priorità e valore;
- ogni `canonicalKey` può essere mappata al massimo da un routing attribute locale per LayoutRevision;
- i requirement globali vengono tradotti esclusivamente tramite `canonicalKey`, mai per coincidenza con il key locale;
- `MapProjection` backend-side da VenueRelease/LayoutRevision pinzate con floor, asset, coordinate normalizzate, Visit stop, facility, route overlay e floor/inter-Venue transitions;
- il Navigator non riceve Place ID, Connection ID, LayoutRevision ID o routing graph come contratto cartografico;
- la tappa corrente è evidenziata come stato logico della Visit, non come posizione fisica automatica dell'utente;
- una floor realmente necessaria alla Visit senza map asset produce `NAVIGATOR_MAP_ASSET_MISSING` e blocca la preparation Navigator senza invalidare la LayoutRevision come dominio fisico;
- `NavigationProjection` typed per le destination logistiche materializzate dalle Action runtime;
- `navigation.obstacles.next_route` è una Action separata, presente soltanto quando esiste un prossimo physical leg;
- obstacle checking usa esclusivamente routing metadata con canonicalKey dichiarata; in assenza di evidenza canonica restituisce stato non verificabile invece di inventare assenza di ostacoli;
- TTS browser legge esattamente `current.presentation.text`, la stessa stringa mostrata;
- controlled voice esegue exact matching locale soltanto su label/aliases delle `AvailableAction` correnti e invia lo stesso ActionRequest dei bottoni; il transcript non viene inviato al backend;
- in assenza di speech recognition restano disponibili i bottoni equivalenti;
- il Navigator mostra MapProjection, NavigationProjection e risultato della obstacle query senza ricostruire routing client-side;
- legacy checker impedisce il ritorno del catalogo routing duplicato e dei command endpoint precedenti.

Test Slice 4:

- validazione canonical routing requirements e rifiuto dei key LayoutRevision-local usati come default globale;
- un key locale uguale a un canonical key non viene interpretato globalmente senza `canonicalKey` esplicita;
- duplicate mapping della stessa `canonicalKey` viene rifiutato dall'integrità VenueRelease;
- una preparation su floor necessaria senza map asset è `blocked` con `NAVIGATOR_MAP_ASSET_MISSING`;
- MapProjection non serializza `placeId`, `connectionId` o `layoutRevisionId`;
- obstacle Action via controlled voice usa metadata canonici, incrementa `runtimeVersion` e registra l'InteractionEvent;
- NavigationOriginResolver verifica fallback logico e precedenza futura explicit/physical senza cambiare `currentEntryIndex`.

## Slice 5 — Marketplace Catalog e Creator Workspace

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- capability matrix Marketplace per ItemEdition/ItemRevision, EditorialContext/EditorialRelease, Namespace/NamespaceRevision e Visit/VisitRevision;
- Catalog multi-asset con search, pagination, Asset Detail projection, Offer selection e Acquisition;
- lifecycle Listing corretto `draft | published | withdrawn` e guardrail contro il precedente stato `active`;
- `MarketplaceOfferIntegrity` risolve la dependency closure commerciale delle snapshot e rifiuta Offer non self-contained nel primo incremento;
- l'integrità delle Offer `follow_current` viene ricontrollata anche alla nuova Acquisition, così nuove dipendenze esterne non ereditano redistribuzione implicita;
- `CreatorWorkspaceProjection` principal-scoped con User/Organization, ContentSpace, asset owned e licensed distinti e `availableOperations[]` backend-authoritative;
- le risorse licensed espongono `sourceRef` e `snapshotRef` risolti backend-side, senza richiedere al client di inferire lineage o documenti Mongo;
- Workspace resource routing e unico command boundary `POST /v2/marketplace/workspace/operations` per le operazioni autonome;
- Distribution Dashboard derivato da Listing/Offer/Acquisition/Adoption con vendite, acquisizioni gratuite, buyer, adopter e ricavi simulati per valuta;
- `Adoption` è registrata solo quando una capability esterna viene realmente utilizzata; Acquisition e Adoption restano eventi distinti;
- `content.use_in_editorial_release` verifica la ItemRevision realmente autorizzata e registra `content_link`;
- `context.compose_visit` verifica la EditorialRelease realmente autorizzata e registra `context_reference`;
- `content.fork`, `namespace.fork` e `visit.copy_detached` rispettano le snapshot pinned autorizzate e producono aggregate detached con provenance;
- `context.import_snapshot` materializza un nuovo ContentSpace/EditorialContext del beneficiary, clona il working SemanticGraph riusando i Subject globali e mantiene gli Item esterni come membership/reference senza trasferirne ownership;
- `context.use_as_venue_primary` è capability-based e una release pinned non viene trasformata in primary Context live;
- `context.generate` è capability-based; le source pinned restano intenzionalmente bloccate fino al typed source contract dello Slice 7 invece di essere sostituite con la release corrente;
- tutti i creator workflow che incorporano o producono asset owned sono principal-scoped: il beneficiary della capability deve coincidere con il principal proprietario del risultato;
- una licenza personale non può quindi essere usata implicitamente per creare Item/Namespace/EditorialContext/EditorialRelease/Visit o configurazioni Venue dell'Organization, e viceversa;
- Marketplace client vanilla/Web Components consuma Catalog, Workspace, resource route, operazioni autonome e Distribution Dashboard senza ricostruire authorization client-side;
- checker legacy protegge lifecycle Listing, capability boundary, generator authorization e Workspace dispatcher.

Test Slice 5 aggiunti:

- Offer self-contained accettata e dependency esterna rifiutata;
- Offer `follow_current` ricontrollata quando una nuova snapshot introduce dipendenze esterne;
- creator rights pinned usano la ItemRevision/NamespaceRevision acquisita anche dopo nuove publication;
- fork e altri utilizzi reali generano Adoption, mentre la sola Acquisition no;
- Context import detached riusa Subject e Item esterni senza trasferirne ownership e senza fabbricare una EditorialRelease del buyer;
- Workspace distingue asset licensed e owned prima/dopo l'import;
- un Entitlement personale non può produrre un fork Organization-owned; dopo Acquisition a beneficio dell'Organization lo stesso workflow è autorizzato e le Adoption sono Organization-scoped.

## Slice 6 — Item authoring e Venue catalog relevance

**Stato: implementato nel codice; test automatici e guardrail aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- introdotto `VenueCatalogRelevanceResolverV2`: la selezione `selectedVenueIds[]` usa semantica union/OR ed è applicata alla query Listing prima della paginazione;
- `VenueSelectorProjection` raggruppa le Venue per Organization senza esporre primary Context, release o internals fisici;
- la rilevanza editoriale deriva dai Subject dei VenueTarget attivi nella `VenueRelease` pubblicata; VenueTarget di lavoro non rendono automaticamente un contenuto pertinente alla Venue;
- `ItemEdition`/`ItemRevision` risultano pertinenti tramite `primarySubjectId`, `relatedSubjectIds`, semantic focus e knowledge requirements, senza introdurre `museumId`, `venueIds[]` o ownership-by-Venue;
- `EditorialContext`/`EditorialRelease` possono risultare pertinenti per corpus oppure per endorsement `Venue.primaryEditorialContextId`, che resta segnale/default e non authorization;
- `Namespace`/`NamespaceRevision` restano intrinsecamente Venue-neutral e il `SemanticGraph` non viene filtrato dalla Venue;
- per le Visit, il PhysicalScope deriva da `VisitAnchor -> VenueTarget -> Venue`; la Visit live segue esclusivamente la propria `publishedRevisionId` corrente, mentre una `VisitRevision` storica resta uno snapshot autonomo filtrabile;
- le card Visit mostrano sempre l'intero PhysicalScope, anche quando il match deriva da una sola Venue selezionata;
- Listing e Offer restano lifecycle separati: una Listing pubblicata rimane discoverable anche senza Offer attive e il client può mostrare correttamente “Nessuna offerta disponibile”;
- Subject search/create supporta exact external identity e rifiuta il binding duplicato della stessa identity `exact`;
- introdotta `ItemAuthoringProjection` con Subject, lineage/owner, Edition/Namespace, Revision/Presentation, ContentSpace membership, publication/integrity state e operazioni user-facing;
- il consistency check verifica anche l'esistenza dei Subject referenziati da `relatedSubjectIds`, semantic focus e knowledge requirements; riferimenti dangling producono `SUBJECT_REFERENCE_NOT_FOUND`, lasciano la revisione `needs_review` e impediscono la publication;
- il round-trip del client preserva i Subject dangling invece di cancellarli silenziosamente durante un edit;
- il wizard Marketplace implementa `Subject -> Item -> Edition -> Revision`, supporta Subject non fisici senza Venue e mantiene il principal proprietario della lineage stabile dopo la creazione dell'Item;
- `NamespaceAuthoringProjection` espone controlli user-facing per durata, complessità linguistica, aspetti e selection signal senza consegnare al client una NamespaceRevision grezza;
- l'entry point “crea contenuto per questo oggetto” usa un VenueTarget pubblicato soltanto per precompilare il Subject; non crea una relazione Item -> VenueTarget;
- `VenueRelease.targetBindings.recognitionMedia` e `ItemRevision.illustrativeMedia` restano separati; le recognition image possono essere mostrate come contesto fisico ma non vengono copiate nell'Item;
- la ContentSpace membership è modificabile dall'Editor e continua a organizzare/autorizzare il corpus senza trasferire ownership;
- introdotto `EditorialReleaseComposerV2`: propone soltanto Item member del ContentSpace, Edition dello stesso Namespace e snapshot realmente autorizzate per il principal proprietario del Context;
- il composer usa la stessa capability-source resolution del write service anche per Namespace `pinned`, quindi una licenza a una NamespaceRevision storica non viene sostituita silenziosamente dalla revision live corrente;
- il Marketplace collega gli EditorialContext owned al release composer e riusa l'endpoint/domain service di creazione EditorialRelease esistente;
- aggiunto `checkSlice6Contracts.js`, eseguito da `npm run check`, per proteggere indipendenza Subject/Item/Namespace dalla Venue, derived Venue relevance, assenza di SemanticGraph filtering, `selectedVenueIds[]`, preservation dei riferimenti Subject dangling e source resolution del composer.

Test Slice 6 aggiunti:

- exact Subject identity ricercabile e duplicazione rifiutata;
- Venue selector Organization -> Venues senza internals;
- filtro Venue A, union A+B, contenuto semanticamente correlato e Namespace venue-neutral;
- Visit A+B visibile selezionando A ma con PhysicalScope completo;
- VenueTarget non pubblicato non rende editorialmente rilevante un Item ma conserva la propria identità fisica per il PhysicalScope delle Visit;
- una Visit live non eredita rilevanza Venue da una vecchia VisitRevision superseded, mentre lo snapshot storico rimane filtrabile autonomamente;
- recognition media fisici separati dagli illustrative media editoriali;
- due Item indipendenti possono condividere lo stesso Subject non fisico senza alcuna Venue;
- `ItemAuthoringProjection` resta Venue-free e proietta correttamente membership e Presentation;
- Subject dangling nei tre punti di riferimento semantico bloccano publication;
- EditorialRelease composer esclude Item non-member e Item member privi di capability per il principal del Context;
- NamespaceRevision pinned viene rispettata dal composer anche dopo la pubblicazione di una nuova revision live.

## Slice 7 — Generator v2 UX + GeneratedPlan materialization

**Stato: implementato nel codice; test automatici e guardrail aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- `GenerationOptionsProjection` authorization/scope-aware con PhysicalScope e EditorialScope indipendenti;
- source editoriali tipizzate: `editorial_context` live/follow-current oppure `editorial_release` pinned, senza sostituzione silenziosa della snapshot autorizzata;
- `Venue.primaryEditorialContextId` usato soltanto come default autorizzato, mai come bypass di `context.generate`;
- selezione Navigator di più Venue fisiche e sorgenti ContentSpace/Context editoriali indipendente, con transfer inter-Venue espliciti;
- ricerca Subject source-scoped tramite `generationSemanticOptionsV2.service.js` e `POST /v2/navigator/generation-subjects/search`;
- gli interessi selezionati diventano `semanticGoals[]` della structured generation request; i canonical navigation requirements diventano `navigationRequirements[]` senza esporre Layout/routing internals al client;
- presentation controls per tempo, profondità, complessità linguistica, locale e ritmo di movimento;
- `GeneratedPlanProjection` user-facing con contenuti, source/version mode, PhysicalScope, stima, warnings e operations senza planner internals;
- preview, accept e direct start tramite `ExecutionPreparation` già esistente;
- “Modifica criteri” apre una nuova generazione e non muta il GeneratedPlan precedente;
- materializzazione idempotente `GeneratedPlan -> user-owned Visit`, con provenance e snapshot editoriali preservati;
- la Visit materializzata non congela Representation, Place/path indoor, VenueRelease/LayoutRevision o timing runtime; conserva soltanto durable inter-Venue route hints quando necessari;
- la Visit salvata rientra nella Library personale e usa lo stesso boundary di ExecutionPreparation delle altre Visit;
- `checkSlice7Contracts.js` protegge source tipizzate, projection/materialization, semantic search, navigation criteria e nuova generazione da criteri modificati.

Test Slice 7 versionati coprono generation source live/pinned, options/default authorization, adoption, generator, materialization e lifecycle GeneratedPlan. Il connettore non espone l'esito CI push degli ultimi commit.

## Slice 8 — Workflow editoriali e hardening commerciale

**Stato: implementato nel codice; test automatici e guardrail aggiunti; verifica CI push/Mongo completa non osservabile tramite il connector/runtime corrente.**

Completato su `main`:

- il workflow condiviso non usa più un ambiguo `markPublished`: publication diretta e approvazione manageriale sono operazioni distinte (`publishWithoutReview` e `approveReviewAndPublish`);
- la publication diretta richiede `draft + integrity valid` e non scrive `review.decision=approved`, `reviewedAt`, `reviewedBy` o review event fittizi;
- l'approvazione manageriale richiede esattamente `in_review + integrity valid` e materializza review approval + publication;
- Visit user-owned: publish diretto dopo integrity; `requestReview`/`requestChanges` non sono applicabili;
- Visit organization-owned: operator può inviare/ritirare la review; manager può richiedere modifiche o pubblicare soltanto da `in_review`; il bypass `draft -> published` è eliminato;
- la stessa distinzione è applicata agli aggregate che condividono il workflow: ItemEdition/ItemRevision, Namespace/NamespaceRevision e VenueRelease; VenueRelease resta organization-managed e richiede review prima del publish;
- introdotto `EditorialWorkflowOperationsV2`: `availableOperations[]` è proiettato backend-side in base a owner, authority, status e integrity;
- `CreatorWorkspaceProjection` include `editorialWorkflow` e operazioni `workflow.check`, `workflow.request_review`, `workflow.withdraw_review`, `workflow.request_changes`, `workflow.publish` soltanto quando realmente disponibili;
- il command boundary `POST /v2/marketplace/workspace/operations` esegue anche le operazioni editoriali per ItemEdition, Namespace e Visit, riusando i domain service esistenti;
- Item authoring projection espone operation object user-facing anziché stringhe di authorization; l'editor blocca il form quando la revisione è `in_review`;
- Marketplace Workspace e Item Editor eseguono genericamente le operazioni proiettate e richiedono un messaggio solo quando `requiresMessage` è fornito dal backend; non deducono authorization da `ownerType` o role;
- publication editoriale e Listing commerciale restano lifecycle separati: `create_listing` continua a comparire soltanto sopra snapshot già pubblicate;
- aggiunti endpoint Item review request/withdraw/changes per mantenere completo anche il boundary API specifico;
- aggiunto `checkSlice8Contracts.js`, eseguito da `npm run check:legacy`, contro ritorno di `markPublished`, fake review personale, bypass organization, vecchi bottoni hardcoded e authorization workflow ricostruita nel client.

Test Slice 8 aggiunti:

- state machine: direct publish personale senza review fittizia, approval solo da `in_review`, direct publish non consentito durante review;
- operation projection: User draft valido espone publish diretto; Organization draft espone request-review ma non publish anche per manager; solo manager `in_review` riceve decisione/publish;
- test Mongo Visit: publication personale senza `review.approved`; manager Organization respinto su draft; operator respinto al publish manageriale; publish manageriale riuscito dopo request-review;
- verifica locale isolata della logica pura del nuovo state machine/projector: 11 test passati; MongoDB non è disponibile nel runtime locale della chat e la suite repository completa resta demandata alla CI configurata.

## Slice 9 — Dataset d’esame, compliance e deploy

**Stato: implementato nel codice e documentato; test/guardrail versionati. La verifica completa clone -> install/build/test/seed e il deploy gocker restano da eseguire in un ambiente con MongoDB/rete GitHub osservabile.**

Completato su `main`:

- introdotto un dataset d'esame deterministico/idempotente sulla Venue reale `Pinacoteca Nazionale di Bologna`, con i quattro account obbligatori e password prevista dalle specifiche;
- `autore1` è manager e `autore2` operator della Organization demo senza introdurre ruoli globali autore/visitatore nel dominio;
- seed completo di Organization, Venue, 12 VenueTarget/Subject/opere, LayoutRevision, VenueRelease, mappa schematica esplicitamente non ufficiale, facility e routing;
- Namespace con definition identity UUID valide, Subject class/relation type, duration/language scales, presentation aspect e selection signal;
- 12 Item/Edition/ItemRevision con più Representation, ContentSpace, EditorialContext, SemanticGraphRevision ed EditorialRelease coerenti;
- i validator/checker reali di Namespace, Presentation, EditorialRelease, VenueRelease, Visit e Offer fanno fallire il seed se il fixture viola il Domain v2;
- tre Visit Organization-owned pubblicate, ciascuna con almeno dieci opere, tutte sulla stessa Venue demo, con presentation baseline e snapshot editoriali coerenti;
- tre Listing/Offer per le Visit, con offerte gratuite e pagamento simulato, più test E2E `Marketplace acquisition -> Entitlement visit.execute -> Navigator Library`;
- Navigator configurato sulla Venue demo e mappa didattica disponibile come asset statico;
- aggiunti `FIND_ELEVATOR` e `FIND_STAIRS` al catalogo canonico dei place intent, allineando una capacità già presente nel runtime ai requisiti di riconoscimento facility;
- verificato nel codice che TTS legge esattamente il testo mostrato e che controlled voice usa soltanto le Action correnti con bottoni equivalenti;
- Express serve backend, Navigator e Marketplace sullo stesso sito; `/navigator` e `/marketplace` hanno redirect canonico e le route SPA annidate sono compatibili con hard refresh;
- build/deploy documentati per Docker locale e procedura gocker `mongo + node-22`; README e workflow documentale legacy riallineati al Domain v2;
- durante la compliance Marketplace è stato individuato e chiuso il gap “creare/modificare una visita” richiesto dalle specifiche;
- introdotto `VisitAuthoringV2`: projection principal-scoped, source editoriali autorizzate, Venue selector e ricerca contenuti paginata server-side per EditorialRelease;
- la ricerca authoring espone metadata utente, Subject e profili di presentazione durata/linguaggio senza consegnare aggregate Mongo grezzi al client;
- Visit create/update continua a usare le API/domain service canonici `VisitV2`; il nuovo boundary Marketplace è read/projection-only e non duplica il write model;
- il Visit editor Marketplace supporta creazione, modifica di Visit pubblicate tramite nuova working revision, aggiunta/rimozione, riordino, ruoli `core | recommended | optional`, associazione Subject -> VenueTarget e contenuti associati senza target fisico;
- una Visit `in_review` non espone `visit.edit`; check/review/publish restano backend-authoritative tramite `availableOperations` e `workspace/operations`;
- le indicazioni logistiche sono editate separatamente dai contenuti: `preVisitNotes` appartiene alla Visit, i `routeHints` strutturati vengono preservati e nessuna logistica viene codificata come Item/contentEntry;
- `checkSlice9Contracts.js` protegge dataset, facility, Visit editor, separazione logistica/contenuti, TTS/voice, static hosting e deploy.

Test Slice 9 versionati:

- seed idempotente + verifier automatico del dataset obbligatorio;
- Marketplace -> Navigator E2E tramite Acquisition/Entitlement;
- regression test del catalogo facility per ascensore e scale;
- `VisitAuthoringV2` verifica projection nuova Visit, Venue/source disponibili, ricerca paginata, più presentation profile, modifica di una Visit già pubblicata tramite nuova draft, blocco editing durante `in_review` e riapertura dopo withdraw.

## Stato della verifica automatica

La repository configura GitHub Actions su push a `main` per backend checks, guardrail Slice 6/7/8/9, check/build dei due client, test Node/Mongo e audit dipendenze. Sul commit corrente il connector GitHub non espone workflow run o status check; non viene quindi dichiarata una CI green senza evidenza osservabile.

Il runtime locale della chat dispone di Node 22 ma non di MongoDB e non riesce a risolvere `github.com`, quindi non può clonare l'HEAD corrente ed eseguire la suite completa. Le modifiche e i test sono versionati su `main`, ma il criterio finale del piano `clone pulito -> install/build/test/seed -> prodotto demo funzionante` richiede ancora un ambiente eseguibile reale.

## Prossimo incremento

Non sono previsti ulteriori vertical slice architetturali nel piano corrente. Il passo successivo è il **freeze finale di consegna**:

1. su clone pulito eseguire `npm ci`, install Navigator, `npm run check`, `npm run check:clients`, `npm run build:clients` e `npm test` con MongoDB 7 disponibile;
2. eseguire `npm run seed:demo` e `npm run verify:demo`, quindi provare manualmente i quattro account e i flussi Marketplace/Navigator principali;
3. eseguire una prova del deploy gocker di dipartimento con `mongo` e `node-22`, compresi hard refresh su route annidate;
4. correggere esclusivamente regressioni emerse da queste verifiche, evitando nuovi refactoring non necessari prima della consegna;
5. congelare l'HEAD verificato e registrare l'esito della prova finale.
