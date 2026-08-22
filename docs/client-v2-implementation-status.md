# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Slice corrente

**Slice 5 — Marketplace Catalog e Creator Workspace**

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

## Stato della verifica automatica

La repository configura GitHub Actions per backend checks, build/check dei due client, test Node/Mongo e audit dipendenze. Il container dell'assistente continua a non risolvere `github.com`, quindi non può clonare `main` per eseguire localmente la suite completa. Il connector GitHub sui commit correnti non espone i workflow push; per questo codice e test sono versionati, ma l'esito CI non viene dichiarato green senza evidenza osservabile.

## Prossimo incremento

Slice 5 porta Marketplace da Catalog Visit minimo a Marketplace+Editor multi-asset:

1. completare la capability matrix per ItemEdition/Revision, EditorialContext/Release, Namespace/Revision e Visit/Revision;
2. Catalog search/pagination e Asset Detail projection multi-asset;
3. Creator Workspace principal-scoped e `availableOperations` backend-authoritative;
4. acquisition history, Distribution dashboard e Adoption;
5. migrare gli authorization boundary creator alle capability approvate;
6. implementare nel client Marketplace Catalog multi-asset, Workspace User/Organization e resource editor routing.
