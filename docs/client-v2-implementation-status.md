# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Slice corrente

**Slice 4 — Navigation, MapProjection, TTS e controlled voice**

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

- introdotto il runtime Action registry con famiglie progress, presentation, semantic, navigation e lifecycle;
- `AvailableAction` non è più un array di stringhe: ogni opzione espone `actionId`, type/family, label e controlled voice aliases;
- la semantica pubblica distingue `presentation.depth` da `presentation.complexity`; `PRESENTATION_LANGUAGE_*` è rimosso dal contratto runtime;
- `VisitSessionV2` possiede `runtimeVersion` e un `InteractionEvent` generico con actor, action, interaction channel, content/anchor/semantic context, result e timestamp;
- implementato `ActionDispatcherV2` con re-derivation dell'Action, optimistic runtime concurrency e `RUNTIME_VERSION_CONFLICT`;
- Action non disponibili producono `ACTION_NOT_AVAILABLE` senza eseguire business logic;
- introdotto `POST /v2/visit-sessions/:sessionId/actions` come unico command boundary runtime;
- rimossi dal contratto pubblico `/advance`, `/presentation-depth`, `/presentation-language`, `/route-to-intent`, `/pause`, `/resume`, `/complete` e il raw session-plan endpoint;
- telemetry/observations restano boundary distinti e non vengono forzati nel protocollo Action;
- Navigator `SessionView` rende genericamente le `AvailableAction` e invia soltanto `actionId + expectedRuntimeVersion + interactionChannel`;
- il runtime projection non espone Place/path/connection/venue pins; l'anchor user-facing conserva soltanto VisitAnchor/VenueTarget/Venue;
- navigation Action concrete vengono materializzate server-side soltanto quando l'intent è presente e raggiungibile nello snapshot fisico pinzato;
- semantic exploration deriva esclusivamente dalle EditorialRelease/GraphRevision/NamespaceRevision pinzate dalla Session;
- same-Subject content viene esposto come approfondimento senza richiedere SemanticEdge;
- related-Subject content viene derivato da relation type Namespace-local: label e voice aliases provengono dal Namespace, senza catalogo globale `author/style/period/curiosity`;
- gli Action ID semantici sono opachi e non espongono relation key o ID tecnici;
- un approfondimento semantico usa lo stesso presentation channel della Session e mantiene il currentEntryIndex/Anchor corrente, senza inventare una destinazione fisica;
- `semantic.return` ripristina il contenuto della Visit; NEXT/PREVIOUS chiudono implicitamente l'approfondimento;
- depth/complexity continuano a funzionare anche sulla presentation semantica;
- il relativo Action audit conserva Subject/Item semantico per predisporre il monitoring 18–27;
- `checkLegacyContracts.js` impedisce il ritorno di endpoint runtime paralleli, string policy client e vecchia semantica presentation-language.

Test Slice 3:

- API E2E usa soltanto `/actions` per progress;
- `ACTION_NOT_AVAILABLE` viene verificato quando un'Action non è materializzata;
- una request con `expectedRuntimeVersion` stale produce `RUNTIME_VERSION_CONFLICT`;
- un Action via `controlled_voice` registra channel e risultato nell'InteractionEvent;
- runtime physical test usa dispatcher per presentation e completion mantenendo le release fisiche pinzate;
- test semantico dedicato verifica un secondo Item sullo stesso Subject e un Subject collegato da relation type locale `Autore` con alias `chi è l'autore`;
- il test semantico verifica che l'approfondimento non avanzi la Visit e non crei una destinazione fisica.

## Stato della verifica automatica

La repository configura GitHub Actions per backend checks, build/check dei due client, test Node/Mongo e audit dipendenze. Il container dell'assistente continua a non risolvere `github.com`, quindi non può clonare `main` per eseguire localmente la suite completa. Il connector GitHub sul commit corrente restituisce `statuses: []` e non espone i workflow push. Per questo codice e test sono versionati, ma l'esito CI del commit corrente non viene dichiarato green senza evidenza osservabile.

## Prossimo incremento

Slice 4 completa il nucleo Navigator obbligatorio 18–24:

1. NavigationPreparationResolver e NavigationProjection user-facing;
2. MapProjection da VenueRelease/LayoutRevision pinzate, senza raw graph/path;
3. route overlay per floor e transition esplicite;
4. TTS sulla stessa `current.presentation.text` mostrata;
5. controlled voice adapter che seleziona esclusivamente le `AvailableAction` correnti;
6. bottoni accessibili equivalenti;
7. destination logistiche e obstacle/accessibility Action senza posizione automatica dell'utente.
